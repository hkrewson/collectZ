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

  async waitForMessageCount(expectedCount, timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.messages.length >= expectedCount) return this.messages.slice();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expectedCount} SMTP messages`);
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
       $1, 'game', 'Blu-ray', $2, $3, $4, 'manual'
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

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `auto-loan-reminders-${suffix}@example.com`;
  const password = 'Collectz!234567890123456789';
  const client = new HttpClient('automatic-loan-reminders-smoke');
  const smtp = new FakeSmtpServer();
  const previousSmtpSettings = await loadSmtpAppSettingsSnapshot();
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    const smtpPort = await smtp.start();
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
      name: 'Automatic Reminder Smoke Admin'
    });
    const scope = await ensureUserDefaultScope(userId);
    libraryId = scope?.libraryId || null;
    spaceId = scope?.spaceId || null;
    assert(libraryId && spaceId, 'Expected default scope for automatic reminder smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      withCsrf: true,
      expectStatus: 200
    });
    await client.fetchCsrfToken();

    const dueSoonMediaId = await createLoanableMedia({
      title: 'Automatic Due Soon Reminder Test',
      libraryId,
      spaceId,
      userId
    });
    const overdueMediaId = await createLoanableMedia({
      title: 'Automatic Overdue Reminder Test',
      libraryId,
      spaceId,
      userId
    });
    assert(dueSoonMediaId && overdueMediaId, 'Expected test media rows to be created');

    const today = new Date().toISOString().slice(0, 10);
    const dueSoonLoan = await client.request(`/api/media/${dueSoonMediaId}/loans`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        borrower_name: 'Casey Due Soon',
        borrower_email: email,
        loaned_at: addDays(today, -5),
        due_at: addDays(today, 2),
        notes: 'Auto due soon test'
      }
    });
    const overdueLoan = await client.request(`/api/media/${overdueMediaId}/loans`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        borrower_name: 'Casey Overdue',
        borrower_email: email,
        loaned_at: addDays(today, -14),
        due_at: addDays(today, -1),
        notes: 'Auto overdue test'
      }
    });
    const dueSoonLoanId = Number(dueSoonLoan.data?.id || 0);
    const overdueLoanId = Number(overdueLoan.data?.id || 0);
    assert(dueSoonLoanId && overdueLoanId, 'Expected created loans to return ids');

    const firstRun = await client.request('/api/media/loan-reminders/run-auto', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {}
    });
    assert(firstRun.data?.smtpConfigured === true, `Expected automatic reminder run to see SMTP as configured, got ${JSON.stringify(firstRun.data)}`);
    assert(firstRun.data?.sent === 2, `Expected first automatic reminder run to send two reminders, got ${JSON.stringify(firstRun.data)}`);
    assert(firstRun.data?.dueSoonSent === 1, `Expected first run to send one due soon reminder, got ${JSON.stringify(firstRun.data)}`);
    assert(firstRun.data?.overdueSent === 1, `Expected first run to send one overdue reminder, got ${JSON.stringify(firstRun.data)}`);

    const messages = await smtp.waitForMessageCount(2);
    const combined = messages.join('\n---\n');
    const normalizedCombined = combined.replace(/=\r?\n/g, '').replace(/_/g, ' ');
    assert(normalizedCombined.includes('Automatic Due Soon Reminder Test'), `Expected due soon reminder email to mention the due soon title, got ${combined}`);
    assert(normalizedCombined.includes('Automatic Overdue Reminder Test'), `Expected overdue reminder email to mention the overdue title, got ${combined}`);
    assert(normalizedCombined.toLowerCase().includes('due soon'), `Expected one reminder subject/body to mention due soon timing, got ${combined}`);
    assert(normalizedCombined.toLowerCase().includes('overdue'), `Expected one reminder subject/body to mention overdue timing, got ${combined}`);

    const secondRun = await client.request('/api/media/loan-reminders/run-auto', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {}
    });
    assert(secondRun.data?.sent === 0, 'Expected second automatic reminder run to avoid duplicate sends');
    assert(Number(secondRun.data?.skippedAlreadySent || 0) >= 2, 'Expected second run to report duplicate-send skips');

    const dueSoonHistory = await client.request(`/api/media/${dueSoonMediaId}/loans`, { expectStatus: 200 });
    const overdueHistory = await client.request(`/api/media/${overdueMediaId}/loans`, { expectStatus: 200 });
    assert(Boolean(dueSoonHistory.data?.active_loan?.due_soon_reminder_last_sent_at), 'Expected due soon loan to persist phase-specific reminder tracking');
    assert(Boolean(overdueHistory.data?.active_loan?.overdue_reminder_last_sent_at), 'Expected overdue loan to persist phase-specific reminder tracking');

    console.log(JSON.stringify({
      firstRunSent: firstRun.data?.sent,
      dueSoonSent: firstRun.data?.dueSoonSent,
      overdueSent: firstRun.data?.overdueSent,
      secondRunSent: secondRun.data?.sent,
      duplicateSkips: secondRun.data?.skippedAlreadySent,
      dueSoonTracked: Boolean(dueSoonHistory.data?.active_loan?.due_soon_reminder_last_sent_at),
      overdueTracked: Boolean(overdueHistory.data?.active_loan?.overdue_reminder_last_sent_at)
    }, null, 2));
  } finally {
    await saveSmtpAppSettingsSnapshot(previousSmtpSettings);
    await smtp.stop().catch(() => {});
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
