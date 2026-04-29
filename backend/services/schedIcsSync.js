'use strict';

const crypto = require('crypto');
const { encryptSecret, decryptSecretWithStatus } = require('./crypto');

const ICS_SOURCE_TYPE = 'sched_ics';
const MAX_ICS_BYTES = 2 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

function normalizeText(value) {
  return String(value || '').trim();
}

function unfoldIcsLines(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function splitPropertyLine(line) {
  const idx = String(line || '').indexOf(':');
  if (idx < 0) return null;
  const nameAndParams = line.slice(0, idx);
  const rawValue = line.slice(idx + 1);
  const [rawName, ...rawParams] = nameAndParams.split(';');
  const params = {};
  for (const param of rawParams) {
    const eqIdx = param.indexOf('=');
    if (eqIdx <= 0) continue;
    params[param.slice(0, eqIdx).toUpperCase()] = param.slice(eqIdx + 1).replace(/^"|"$/g, '');
  }
  return { name: rawName.toUpperCase(), params, value: rawValue };
}

function decodeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(value, params = {}) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`;
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  if (zulu || String(params.TZID || '').trim()) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
  }
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).toISOString();
}

function buildSourceRef(event) {
  const uid = normalizeText(event.uid);
  if (uid) return uid.slice(0, 255);
  const stable = [event.summary, event.startAt, event.location].map((part) => normalizeText(part).toLowerCase()).join('|');
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 64);
}

function parseIcsEvents(text) {
  const lines = unfoldIcsLines(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const property = splitPropertyLine(line);
    if (!property) continue;
    if (property.name === 'UID') current.uid = decodeIcsText(property.value);
    if (property.name === 'SUMMARY') current.summary = decodeIcsText(property.value);
    if (property.name === 'DESCRIPTION') current.description = decodeIcsText(property.value);
    if (property.name === 'LOCATION') current.location = decodeIcsText(property.value);
    if (property.name === 'URL') current.url = decodeIcsText(property.value);
    if (property.name === 'STATUS') current.status = normalizeText(property.value).toUpperCase();
    if (property.name === 'DTSTART') current.startAt = parseIcsDate(property.value, property.params);
    if (property.name === 'DTEND') current.endAt = parseIcsDate(property.value, property.params);
  }
  return events
    .filter((event) => normalizeText(event.summary))
    .map((event) => ({
      uid: normalizeText(event.uid) || null,
      sourceRef: buildSourceRef(event),
      title: normalizeText(event.summary).slice(0, 255),
      start_at: event.startAt || null,
      end_at: event.endAt || null,
      location: normalizeText(event.location).slice(0, 255) || null,
      status: event.status === 'CANCELLED' ? 'skipped' : 'planned',
      notes: [normalizeText(event.description), normalizeText(event.url)].filter(Boolean).join('\n\n').slice(0, 5000) || null
    }));
}

function serializeIcsSource(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    provider: row.provider || ICS_SOURCE_TYPE,
    has_url: Boolean(row.feed_url_encrypted),
    status: row.status || 'active',
    sync_status: row.sync_status || 'idle',
    last_synced_at: row.last_synced_at || null,
    last_success_at: row.last_success_at || null,
    last_error: row.last_error || null,
    last_item_count: Number(row.last_item_count || 0),
    last_change_summary: row.last_change_summary || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function loadPersonalIcsSource(pool, { eventId, userId }) {
  const result = await pool.query(
    `SELECT *
       FROM event_personal_ics_sources
      WHERE event_id = $1
        AND user_id = $2
        AND archived_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [eventId, userId]
  );
  return result.rows[0] || null;
}

async function upsertPersonalIcsSource(pool, { eventId, userId, feedUrl }) {
  const encryptedUrl = encryptSecret(feedUrl);
  const result = await pool.query(
    `INSERT INTO event_personal_ics_sources (event_id, user_id, provider, feed_url_encrypted, status, sync_status)
     VALUES ($1, $2, $3, $4, 'active', 'idle')
     ON CONFLICT (event_id, user_id)
     WHERE archived_at IS NULL
     DO UPDATE SET feed_url_encrypted = EXCLUDED.feed_url_encrypted,
                   status = 'active',
                   sync_status = 'idle',
                   last_error = NULL,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [eventId, userId, ICS_SOURCE_TYPE, encryptedUrl]
  );
  return result.rows[0] || null;
}

async function removePersonalIcsSource(pool, { eventId, userId }) {
  const result = await pool.query(
    `UPDATE event_personal_ics_sources
        SET archived_at = CURRENT_TIMESTAMP,
            status = 'archived',
            updated_at = CURRENT_TIMESTAMP
      WHERE event_id = $1
        AND user_id = $2
        AND archived_at IS NULL
      RETURNING id`,
    [eventId, userId]
  );
  return result.rows[0] || null;
}

async function fetchIcsText(feedUrl, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(feedUrl, {
      method: 'GET',
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`ICS fetch failed with status ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_ICS_BYTES) throw new Error('ICS feed is too large');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function syncPersonalIcsSource(pool, { source, eventId, userId, fetchImpl = fetch }) {
  const sourceId = Number(source?.id || 0);
  if (!sourceId) throw new Error('Missing personal ICS source');
  const decrypted = decryptSecretWithStatus(source.feed_url_encrypted, 'event_personal_ics_sources.feed_url_encrypted');
  if (decrypted.error || !decrypted.value) {
    await pool.query(
      `UPDATE event_personal_ics_sources
          SET sync_status = 'failed', last_error = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sourceId, 'Stored ICS URL could not be decrypted']
    );
    throw new Error('Stored ICS URL could not be decrypted');
  }

  await pool.query(`UPDATE event_personal_ics_sources SET sync_status = 'running', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [sourceId]);
  try {
    const text = await fetchIcsText(decrypted.value, fetchImpl);
    const items = parseIcsEvents(text);
    const seenRefs = [];
    let created = 0;
    let updated = 0;

    for (const item of items) {
      seenRefs.push(item.sourceRef);
      const existing = await pool.query(
        `SELECT id
           FROM event_schedule_plans
          WHERE event_id = $1
            AND created_by = $2
            AND source_type = $3
            AND source_ref = $4
          LIMIT 1`,
        [eventId, userId, ICS_SOURCE_TYPE, item.sourceRef]
      );
      if (existing.rows[0]) {
        await pool.query(
          `UPDATE event_schedule_plans
              SET title = $5,
                  start_at = $6,
                  end_at = $7,
                  location = $8,
                  status = $9,
                  visibility = 'private',
                  notes = $10,
                  archived_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
              AND event_id = $2
              AND created_by = $3
              AND source_type = $4`,
          [existing.rows[0].id, eventId, userId, ICS_SOURCE_TYPE, item.title, item.start_at, item.end_at, item.location, item.status, item.notes]
        );
        updated += 1;
      } else {
        await pool.query(
          `INSERT INTO event_schedule_plans (event_id, title, start_at, end_at, location, source_type, source_ref, status, visibility, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'private', $9, $10)`,
          [eventId, item.title, item.start_at, item.end_at, item.location, ICS_SOURCE_TYPE, item.sourceRef, item.status, item.notes, userId]
        );
        created += 1;
      }
    }

    let removed = 0;
    if (seenRefs.length > 0) {
      const removedResult = await pool.query(
        `UPDATE event_schedule_plans
            SET archived_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE event_id = $1
            AND created_by = $2
            AND source_type = $3
            AND archived_at IS NULL
            AND NOT (source_ref = ANY($4::text[]))
          RETURNING id`,
        [eventId, userId, ICS_SOURCE_TYPE, seenRefs]
      );
      removed = removedResult.rowCount || 0;
    }

    const summary = { created, updated, removed, total: items.length };
    const updatedSource = await pool.query(
      `UPDATE event_personal_ics_sources
          SET sync_status = 'succeeded',
              last_synced_at = CURRENT_TIMESTAMP,
              last_success_at = CURRENT_TIMESTAMP,
              last_error = NULL,
              last_item_count = $2,
              last_change_summary = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [sourceId, items.length, JSON.stringify(summary)]
    );
    return { source: updatedSource.rows[0] || source, summary, items };
  } catch (error) {
    const safeMessage = String(error?.message || 'ICS sync failed').slice(0, 500);
    const failedSource = await pool.query(
      `UPDATE event_personal_ics_sources
          SET sync_status = 'failed',
              last_synced_at = CURRENT_TIMESTAMP,
              last_error = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [sourceId, safeMessage]
    );
    return { source: failedSource.rows[0] || source, summary: { created: 0, updated: 0, removed: 0, total: 0 }, error: safeMessage, items: [] };
  }
}

module.exports = {
  ICS_SOURCE_TYPE,
  parseIcsEvents,
  serializeIcsSource,
  loadPersonalIcsSource,
  upsertPersonalIcsSource,
  removePersonalIcsSource,
  syncPersonalIcsSource
};
