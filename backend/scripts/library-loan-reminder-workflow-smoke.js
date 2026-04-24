'use strict';

const bcrypt = require('bcrypt');
const net = require('net');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const cookieLine of raw) {
      const firstPart = String(cookieLine).split(';')[0] || '';
      const idx = firstPart.indexOf('=');
      if (idx <= 0) continue;
      const key = firstPart.slice(0, idx).trim();
      const value = firstPart.slice(idx + 1).trim();
      if (key) this.cookies.set(key, value);
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false } = options;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
    return token;
  }
}

class FakeSmtpServer {
  constructor() {
    this.messages = [];
    this.server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 localhost ESMTP collectz-test\r\n');
      let buffer = '';
      let inData = false;
      let messageLines = [];

      const handleLine = (line) => {
        if (inData) {
          if (line === '.') {
            this.messages.push(messageLines.join('\n'));
            messageLines = [];
            inData = false;
            socket.write('250 queued\r\n');
            return;
          }
          messageLines.push(line);
          return;
        }
        if (/^(EHLO|HELO)\b/i.test(line)) {
          socket.write('250-localhost\r\n250 PIPELINING\r\n');
          return;
        }
        if (/^MAIL FROM:/i.test(line)) {
          socket.write('250 ok\r\n');
          return;
        }
        if (/^RCPT TO:/i.test(line)) {
          socket.write('250 ok\r\n');
          return;
        }
        if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write('354 end with <CRLF>.<CRLF>\r\n');
          return;
        }
        if (/^QUIT$/i.test(line)) {
          socket.write('221 bye\r\n');
          socket.end();
          return;
        }
        socket.write('250 ok\r\n');
      };

      socket.on('data', (chunk) => {
        buffer += chunk;
        while (buffer.includes('\r\n')) {
          const index = buffer.indexOf('\r\n');
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handleLine(line);
        }
      });
    });
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind fake SMTP server');
    this.port = address.port;
    return this.port;
  }

  async stop() {
    await new Promise((resolve) => this.server.close(() => resolve()));
  }

  async waitForMessage(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.messages.length > 0) return this.messages[0];
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for captured SMTP message');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function addDays(value, days) {
  const target = new Date(`${value}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + Number(days || 0));
  return target.toISOString().slice(0, 10);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function createLoanableMedia({ title, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'book', 'Hardcover', $2, $3, $4, 'manual'
     )
     RETURNING id`,
    [title, libraryId, spaceId, userId]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function loadSmtpAppSettingsSnapshot() {
  const result = await pool.query(
    `SELECT id,
            smtp_override_enabled,
            smtp_host,
            smtp_port,
            smtp_secure,
            smtp_user,
            smtp_password_encrypted,
            smtp_from
       FROM app_settings
      WHERE id = 1
      LIMIT 1`
  );
  return result.rows[0] || null;
}

async function saveSmtpAppSettingsSnapshot(snapshot) {
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
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET smtp_override_enabled = EXCLUDED.smtp_override_enabled,
           smtp_host = EXCLUDED.smtp_host,
           smtp_port = EXCLUDED.smtp_port,
           smtp_secure = EXCLUDED.smtp_secure,
           smtp_user = EXCLUDED.smtp_user,
           smtp_password_encrypted = EXCLUDED.smtp_password_encrypted,
           smtp_from = EXCLUDED.smtp_from,
           updated_at = CURRENT_TIMESTAMP`,
    [
      snapshot?.smtp_override_enabled ?? false,
      snapshot?.smtp_host ?? null,
      snapshot?.smtp_port ?? null,
      snapshot?.smtp_secure ?? null,
      snapshot?.smtp_user ?? null,
      snapshot?.smtp_password_encrypted ?? null,
      snapshot?.smtp_from ?? null
    ]
  );
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_loan_reminders WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_loans WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_directors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_actors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function loadReminderEventsForLoan(loanId) {
  const result = await pool.query(
    `SELECT phase, trigger_source, status, delivery_window_key
       FROM media_loan_reminders
      WHERE loan_id = $1
      ORDER BY sent_at ASC, id ASC`,
    [loanId]
  );
  return result.rows || [];
}

async function main() {
  const suffix = Date.now();
  const email = `loan-reminder-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('library-loan-reminder-workflow-smoke');
  const smtpServer = new FakeSmtpServer();
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let mediaId = null;
  let smtpSnapshot = null;

  try {
    smtpSnapshot = await loadSmtpAppSettingsSnapshot();
    const smtpPort = await smtpServer.start();
    await saveSmtpAppSettingsSnapshot({
      smtp_override_enabled: true,
      smtp_host: '127.0.0.1',
      smtp_port: smtpPort,
      smtp_secure: false,
      smtp_user: null,
      smtp_password_encrypted: null,
      smtp_from: 'collectz-reminders@example.com'
    });

    userId = await createDirectUser({
      email,
      password,
      name: 'Library Loan Reminder Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for loan reminder smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    await client.fetchCsrfToken();

    mediaId = await createLoanableMedia({
      title: 'Loan Reminder Smoke Test',
      libraryId,
      spaceId,
      userId
    });
    assert(mediaId, 'Expected reminder smoke media row to be created');

    const today = new Date().toISOString().slice(0, 10);
    const created = await client.request(`/api/media/${mediaId}/loans`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        borrower_name: 'Casey Reader',
        borrower_email: 'casey.reader@example.com',
        loaned_at: addDays(today, -14),
        due_at: addDays(today, -1),
        loan_format: 'Hardcover',
        notes: 'Reminder workflow smoke loan'
      }
    });
    const loanId = Number(created.data?.id || 0) || null;
    assert(loanId, 'Expected created reminder loan to return an id');
    assert(created.data?.reminder_phase === 'overdue', 'Expected created loan to be reminder-eligible as overdue');

    const reminded = await client.request(`/api/media/loans/${loanId}/reminder`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {}
    });
    assert(reminded.data?.reminder_status === 'sent', 'Expected reminder send to persist sent status');
    assert(Boolean(reminded.data?.reminder_last_sent_at), 'Expected reminder send to persist reminder_last_sent_at');
    assert(reminded.data?.reminder_sent_today === true, 'Expected reminder send to mark sent-today state');
    assert(reminded.data?.reminder_eligible === false, 'Expected reminder send to clear immediate eligibility');

    const capturedMessage = await smtpServer.waitForMessage();
    assert(capturedMessage.includes('Loan Reminder Smoke Test'), 'Expected captured reminder email to mention the media title');
    assert(capturedMessage.includes('overdue'), 'Expected captured reminder email to mention overdue timing');

    const secondAttempt = await client.request(`/api/media/loans/${loanId}/reminder`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 409,
      body: {}
    });
    assert(
      String(secondAttempt.data?.error || '').includes('already been sent today'),
      `Expected same-day resend guard, got ${JSON.stringify(secondAttempt.data)}`
    );

    const refreshedHistory = await client.request(`/api/media/${mediaId}/loans`, {
      method: 'GET',
      expectStatus: 200
    });
    const reminderEvents = await loadReminderEventsForLoan(loanId);
    const activeLoan = refreshedHistory.data?.active_loan || null;
    assert(activeLoan?.reminder_status === 'sent', 'Expected media loan history to surface reminder status');
    assert(activeLoan?.reminder_sent_today === true, 'Expected media loan history to surface sent-today state');
    assert(reminderEvents.length === 1, `Expected one reminder history event, got ${JSON.stringify(reminderEvents)}`);
    assert(reminderEvents[0]?.status === 'sent', `Expected sent reminder history event, got ${JSON.stringify(reminderEvents)}`);
    assert(reminderEvents[0]?.phase === 'overdue', `Expected overdue reminder history event, got ${JSON.stringify(reminderEvents)}`);
    assert(reminderEvents[0]?.trigger_source === 'manual', `Expected manual reminder history event, got ${JSON.stringify(reminderEvents)}`);
    assert(String(reminderEvents[0]?.delivery_window_key || '').startsWith('overdue:'), `Expected overdue delivery window key, got ${JSON.stringify(reminderEvents)}`);

    console.log(JSON.stringify({
      created: true,
      reminderPhase: reminded.data?.reminder_phase,
      reminderStatus: reminded.data?.reminder_status,
      reminderSentToday: reminded.data?.reminder_sent_today,
      reminderEligibleAfterSend: reminded.data?.reminder_eligible,
      lastSentAtPresent: Boolean(reminded.data?.reminder_last_sent_at),
      reminderEventCount: reminderEvents.length,
      reminderEventStatus: reminderEvents[0]?.status || null,
      capturedMessageMentionsTitle: capturedMessage.includes('Loan Reminder Smoke Test'),
      secondAttemptStatus: secondAttempt.status
    }, null, 2));
  } finally {
    await saveSmtpAppSettingsSnapshot(smtpSnapshot);
    await smtpServer.stop().catch(() => {});
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
