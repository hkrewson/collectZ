const nodemailer = require('nodemailer');

function parseBoolean(raw, fallback = false) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function loadSmtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const password = String(process.env.SMTP_PASSWORD || '').trim();
  const from = String(process.env.SMTP_FROM || '').trim();
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    password,
    from,
    secure
  };
}

function isSmtpConfigured(config = loadSmtpConfig()) {
  return Boolean(config.host && config.port && config.from);
}

function buildTransport(config = loadSmtpConfig()) {
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

async function sendInviteEmail({ to, inviteUrl, expiresAt }) {
  const config = loadSmtpConfig();
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
  const config = loadSmtpConfig();
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

module.exports = {
  loadSmtpConfig,
  isSmtpConfigured,
  sendInviteEmail,
  sendPasswordResetEmail
};

