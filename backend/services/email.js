const nodemailer = require('nodemailer');
const pool = require('../db/pool');
const { encryptSecret, decryptSecretWithStatus } = require('./crypto');

function parseBoolean(raw, fallback = false) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function parsePort(raw, fallback = 587) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function maskValue(raw, { keepStart = 2, keepEnd = 0 } = {}) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length <= keepStart + keepEnd) return '••••';
  return `${value.slice(0, keepStart)}••••${keepEnd > 0 ? value.slice(-keepEnd) : ''}`;
}

function maskEmailAddress(raw) {
  const value = String(raw || '').trim();
  if (!value || !value.includes('@')) return maskValue(value, { keepStart: 2 });
  const [local, domain] = value.split('@');
  return `${maskValue(local, { keepStart: 1 })}@${domain}`;
}

function buildEnvConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = parsePort(process.env.SMTP_PORT, 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const password = String(process.env.SMTP_PASSWORD || '').trim();
  const from = String(process.env.SMTP_FROM || '').trim();
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);

  return {
    source: 'env',
    host,
    port,
    user,
    password,
    from,
    secure
  };
}

function isSmtpConfigured(config) {
  return Boolean(config?.host && config?.port && config?.from);
}

async function loadStoredSmtpOverride() {
  const result = await pool.query(
    `SELECT smtp_override_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_encrypted, smtp_from
       FROM app_settings
      WHERE id = 1
      LIMIT 1`
  );
  const row = result.rows[0] || null;
  if (!row || !row.smtp_override_enabled) {
    return { enabled: false, config: null, decryptWarning: null };
  }

  const passwordDecrypt = decryptSecretWithStatus(row.smtp_password_encrypted, 'smtp_password_encrypted');
  return {
    enabled: true,
    config: {
      source: 'app_settings',
      host: String(row.smtp_host || '').trim(),
      port: parsePort(row.smtp_port, 587),
      user: String(row.smtp_user || '').trim(),
      password: passwordDecrypt.value || '',
      from: String(row.smtp_from || '').trim(),
      secure: typeof row.smtp_secure === 'boolean' ? row.smtp_secure : parsePort(row.smtp_port, 587) === 465
    },
    decryptWarning: passwordDecrypt.error
      ? {
          field: 'smtp_password_encrypted',
          code: 'decrypt_failed',
          message: passwordDecrypt.error
        }
      : null
  };
}

async function loadSmtpConfig() {
  const envConfig = buildEnvConfig();
  const stored = await loadStoredSmtpOverride();
  if (stored.enabled && stored.config) {
    return {
      ...stored.config,
      configured: isSmtpConfigured(stored.config),
      decryptWarning: stored.decryptWarning
    };
  }
  return {
    ...envConfig,
    configured: isSmtpConfigured(envConfig),
    decryptWarning: null
  };
}

async function getSmtpStatus() {
  const config = await loadSmtpConfig();
  return {
    configured: Boolean(config.configured),
    source: config.source || 'env',
    host: config.host ? maskValue(config.host, { keepStart: 3 }) : null,
    port: config.port || null,
    secure: Boolean(config.secure),
    authConfigured: Boolean(config.user),
    user: config.user ? maskEmailAddress(config.user) : null,
    from: config.from ? maskEmailAddress(config.from) : null,
    editor: {
      host: config.source === 'app_settings' ? (config.host || '') : '',
      port: config.port || 587,
      secure: Boolean(config.secure),
      user: config.source === 'app_settings' ? (config.user || '') : '',
      from: config.source === 'app_settings' ? (config.from || '') : '',
      hasPassword: config.source === 'app_settings' ? Boolean(config.password) : false
    },
    decryptWarning: config.decryptWarning || null
  };
}

function buildTransport(config) {
  const auth = config.user
    ? { user: config.user, pass: config.password || '' }
    : undefined;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(auth ? { auth } : {})
  });
}

async function updateSmtpSettings({
  mode,
  host,
  port,
  secure,
  user,
  password,
  from
}) {
  const normalizedMode = String(mode || 'env').trim().toLowerCase();
  if (normalizedMode === 'env') {
    await pool.query(
      `UPDATE app_settings
          SET smtp_override_enabled = false,
              smtp_host = NULL,
              smtp_port = NULL,
              smtp_secure = NULL,
              smtp_user = NULL,
              smtp_password_encrypted = NULL,
              smtp_from = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = 1`
    );
    return loadSmtpConfig();
  }

  const existing = await pool.query(
    `SELECT smtp_password_encrypted
       FROM app_settings
      WHERE id = 1
      LIMIT 1`
  );
  const previousPassword = existing.rows[0]?.smtp_password_encrypted || null;
  const nextPasswordEncrypted = password === '__KEEP_EXISTING__'
    ? previousPassword
    : (String(password || '').trim() ? encryptSecret(String(password || '').trim()) : null);

  await pool.query(
    `INSERT INTO app_settings (
       id,
       smtp_override_enabled,
       smtp_host,
       smtp_port,
       smtp_secure,
       smtp_user,
       smtp_password_encrypted,
       smtp_from
     )
     VALUES (1, true, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET smtp_override_enabled = true,
           smtp_host = EXCLUDED.smtp_host,
           smtp_port = EXCLUDED.smtp_port,
           smtp_secure = EXCLUDED.smtp_secure,
           smtp_user = EXCLUDED.smtp_user,
           smtp_password_encrypted = EXCLUDED.smtp_password_encrypted,
           smtp_from = EXCLUDED.smtp_from,
           updated_at = CURRENT_TIMESTAMP`,
    [
      String(host || '').trim(),
      parsePort(port, 587),
      Boolean(secure),
      String(user || '').trim(),
      nextPasswordEncrypted,
      String(from || '').trim()
    ]
  );
  return loadSmtpConfig();
}

async function sendInviteEmail({ to, inviteUrl, expiresAt }) {
  const config = await loadSmtpConfig();
  if (!isSmtpConfigured(config)) {
    return {
      attempted: false,
      sent: false,
      reason: 'smtp_not_configured'
    };
  }
  const transporter = buildTransport(config);
  const expiryText = expiresAt ? new Date(expiresAt).toLocaleString() : '7 days';
  const text = [
    'You have been invited to join collectZ.',
    '',
    `Accept invitation: ${inviteUrl}`,
    '',
    `This invitation expires: ${expiryText}`,
    '',
    'If you were not expecting this invite, you can ignore this email.'
  ].join('\n');
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject: 'collectZ invitation',
    text
  });
  return {
    attempted: true,
    sent: true,
    messageId: info?.messageId || null
  };
}

async function sendPasswordResetEmail({ to, resetUrl, expiresAt }) {
  const config = await loadSmtpConfig();
  if (!isSmtpConfigured(config)) {
    return {
      attempted: false,
      sent: false,
      reason: 'smtp_not_configured'
    };
  }
  const transporter = buildTransport(config);
  const expiryText = expiresAt ? new Date(expiresAt).toLocaleString() : '24 hours';
  const text = [
    'A password reset was requested for your collectZ account.',
    '',
    `Reset password: ${resetUrl}`,
    '',
    `This link expires: ${expiryText}`,
    '',
    'If you did not request this reset, contact an administrator.'
  ].join('\n');
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject: 'collectZ password reset',
    text
  });
  return {
    attempted: true,
    sent: true,
    messageId: info?.messageId || null
  };
}

async function sendEmailVerificationEmail({ to, verificationUrl, expiresAt }) {
  const config = await loadSmtpConfig();
  if (!isSmtpConfigured(config)) {
    return {
      attempted: false,
      sent: false,
      reason: 'smtp_not_configured'
    };
  }
  const transporter = buildTransport(config);
  const expiryText = expiresAt ? new Date(expiresAt).toLocaleString() : '24 hours';
  const text = [
    'Welcome to collectZ.',
    '',
    `Verify your email: ${verificationUrl}`,
    '',
    `This link expires: ${expiryText}`,
    '',
    'If you did not create this account, you can ignore this email.'
  ].join('\n');
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject: 'Verify your collectZ email',
    text
  });
  return {
    attempted: true,
    sent: true,
    messageId: info?.messageId || null
  };
}

async function sendTestEmail({ to, requestedByName = '', requestedByEmail = '' }) {
  const config = await loadSmtpConfig();
  if (!isSmtpConfigured(config)) {
    return {
      attempted: false,
      sent: false,
      reason: 'smtp_not_configured'
    };
  }
  const transporter = buildTransport(config);
  const requesterLine = requestedByEmail
    ? `${requestedByName || 'An administrator'} <${requestedByEmail}>`
    : (requestedByName || 'An administrator');
  const text = [
    'This is a collectZ platform SMTP test email.',
    '',
    `Requested by: ${requesterLine}`,
    `Delivery source: ${config.source === 'app_settings' ? 'app-managed SMTP override' : 'environment defaults'}`,
    '',
    'If you received this message, the current platform email delivery path can reach your inbox.'
  ].join('\n');
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject: 'collectZ SMTP test email',
    text
  });
  return {
    attempted: true,
    sent: true,
    messageId: info?.messageId || null
  };
}

async function sendLoanReminderEmail({
  to,
  borrowerName = '',
  title = '',
  dueAt = '',
  phase = 'due_soon'
}) {
  const config = await loadSmtpConfig();
  if (!isSmtpConfigured(config)) {
    return {
      attempted: false,
      sent: false,
      reason: 'smtp_not_configured'
    };
  }

  const transporter = buildTransport(config);
  const normalizedPhase = String(phase || '').trim().toLowerCase() === 'overdue' ? 'overdue' : 'due_soon';
  const borrowerLabel = String(borrowerName || '').trim() || 'there';
  const titleLabel = String(title || '').trim() || 'your borrowed item';
  const dueLabel = String(dueAt || '').trim() || 'soon';
  const timingLine = normalizedPhase === 'overdue'
    ? `This loan is now overdue. It was due back on ${dueLabel}.`
    : `This loan is due back on ${dueLabel}.`;
  const text = [
    `Hi ${borrowerLabel},`,
    '',
    `This is a reminder about "${titleLabel}".`,
    timingLine,
    '',
    'Please return it when you can.',
    '',
    'Thanks,',
    'collectZ'
  ].join('\n');
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject: normalizedPhase === 'overdue'
      ? `Reminder: "${titleLabel}" is overdue`
      : `Reminder: "${titleLabel}" is due soon`,
    text
  });
  return {
    attempted: true,
    sent: true,
    messageId: info?.messageId || null
  };
}

module.exports = {
  loadSmtpConfig,
  getSmtpStatus,
  isSmtpConfigured,
  updateSmtpSettings,
  sendTestEmail,
  sendLoanReminderEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail
};
