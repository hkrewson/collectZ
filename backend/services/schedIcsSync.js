'use strict';

const crypto = require('crypto');
const dns = require('dns');
const { encryptSecret, decryptSecretWithStatus } = require('./crypto');
const {
  parseHttpUrl,
  isLocalhostName,
  isPrivateAddress,
  shouldAllowPrivateIcsFeeds
} = require('./outboundUrlPolicy');

const ICS_SOURCE_TYPE = 'sched_ics';
const CATALOG_ICS_SOURCE_TYPE = 'sched_catalog_ics';
const MAX_ICS_BYTES = 2 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const ICS_FETCH_USER_AGENT = 'collectZ calendar-sync (+https://github.com/hkrewson/collectZ)';
const GENERIC_CATALOG_CATEGORIES = new Set(['program', 'programs', 'programming', 'schedule', 'sched', 'session', 'sessions']);
const DEFAULT_HOST_LOOKUP = dns.promises.lookup;

async function assertPublicIcsUrl(feedUrl, { allowPrivateHosts = false, lookup = DEFAULT_HOST_LOOKUP } = {}) {
  const parsed = parseHttpUrl(feedUrl, { allowWebcal: true });
  if (!parsed) {
    throw new Error('URL must use http or https and must not include credentials');
  }

  if (allowPrivateHosts) return parsed.toString();

  const hostname = parsed.hostname;
  if (isLocalhostName(hostname)) {
    throw new Error('URL host must not be localhost');
  }
  if (isPrivateAddress(hostname)) {
    throw new Error(`URL host must not be private, loopback, or link-local: ${hostname}`);
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  const privateMatch = (resolved || []).find((entry) => isPrivateAddress(entry?.address));
  if (privateMatch) {
    throw new Error(`URL host resolves to a private, loopback, or link-local address: ${privateMatch.address}`);
  }

  return parsed.toString();
}

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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const point = parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&amp;/gi, '&')
    .trim();
}

function normalizeCategories(value) {
  return decodeIcsText(value)
    .split(',')
    .map((part) => normalizeText(decodeHtmlEntities(part)).slice(0, 100))
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index)
    .slice(0, 20);
}

function normalizeCatalogCategory(value) {
  const decoded = normalizeText(decodeHtmlEntities(decodeIcsText(value))).replace(/\s+/g, ' ');
  if (!decoded) return '';
  return decoded.replace(/^\d+\s*:\s*/, '').slice(0, 100);
}

function normalizeCatalogCategories(values = []) {
  const source = Array.isArray(values) ? values : [values];
  const normalized = [];
  for (const value of source) {
    const category = normalizeCatalogCategory(value);
    if (!category) continue;
    if (normalized.some((existing) => existing.toLowerCase() === category.toLowerCase())) continue;
    normalized.push(category);
  }
  const meaningful = normalized.filter((category) => !GENERIC_CATALOG_CATEGORIES.has(category.toLowerCase()));
  return (meaningful.length ? meaningful : normalized).slice(0, 20);
}

function inferCatalogTrack(categories = []) {
  const normalized = normalizeCatalogCategories(categories);
  return normalized.find((category) => !GENERIC_CATALOG_CATEGORIES.has(category.toLowerCase())) || normalized[0] || null;
}

function inferCatalogRoom(location) {
  const text = normalizeText(location);
  if (!text) return null;
  const firstPart = text.split(/[,·\n]/)[0].trim();
  if (!firstPart || firstPart.length > 100) return null;
  if (/^(room|hall|ballroom|theater|theatre|stage|booth|table|grand|indigo|sails|marriott|omni)\b/i.test(firstPart)) return firstPart.slice(0, 255);
  return null;
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
    if (property.name === 'CATEGORIES') current.categories = normalizeCategories(property.value);
    if (property.name === 'LOCATION') current.location = decodeIcsText(property.value);
    if (property.name === 'URL') current.url = decodeIcsText(property.value);
    if (property.name === 'STATUS') current.status = normalizeText(property.value).toUpperCase();
    if (property.name === 'SEQUENCE') current.sequence = Number(property.value);
    if (property.name === 'DTSTART') current.startAt = parseIcsDate(property.value, property.params);
    if (property.name === 'DTEND') current.endAt = parseIcsDate(property.value, property.params);
    if (property.name === 'DTSTAMP') current.sourceUpdatedAt = parseIcsDate(property.value, property.params);
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
      source_url: normalizeText(event.url).slice(0, 1000) || null,
      source_categories: Array.isArray(event.categories) ? event.categories : [],
      source_updated_at: event.sourceUpdatedAt || null,
      source_sequence: Number.isFinite(event.sequence) ? event.sequence : null,
      status: event.status === 'CANCELLED' ? 'skipped' : 'planned',
      notes: normalizeText(decodeHtmlEntities(event.description)).slice(0, 5000) || null
    }));
}

function parseIcsCatalogSessions(text) {
  return parseIcsEvents(text).map((item) => {
    const categories = normalizeCatalogCategories(item.source_categories);
    return {
      title: item.title,
      start_at: item.start_at,
      end_at: item.end_at,
      location: item.location,
      room: inferCatalogRoom(item.location),
      description: item.notes,
      track: inferCatalogTrack(categories),
      categories,
      source_type: CATALOG_ICS_SOURCE_TYPE,
      source_ref: item.sourceRef,
      source_url: item.source_url,
      source_updated_at: item.source_updated_at,
      status: item.status === 'skipped' ? 'cancelled' : 'active'
    };
  });
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

async function fetchIcsText(feedUrl, fetchImpl = fetch, options = {}) {
  const safeUrl = await assertPublicIcsUrl(feedUrl, {
    allowWebcal: true,
    allowPrivateHosts: options.allowPrivateHosts === true || shouldAllowPrivateIcsFeeds(),
    lookup: options.lookup
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(safeUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/calendar, application/calendar+json;q=0.8, text/plain;q=0.7, */*;q=0.5',
        'User-Agent': ICS_FETCH_USER_AGENT
      },
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

async function linkPersonalPlansToCatalogSessions(pool, { eventId, userId = null } = {}) {
  const normalizedEventId = Number(eventId || 0);
  if (!normalizedEventId) return { linked: 0 };
  const params = [normalizedEventId, ICS_SOURCE_TYPE, CATALOG_ICS_SOURCE_TYPE];
  let userClause = '';
  if (userId) {
    params.push(userId);
    userClause = `AND esp.created_by = $${params.length}`;
  }
  const result = await pool.query(
    `UPDATE event_schedule_plans esp
        SET source_catalog_session_id = ess.id,
            updated_at = CURRENT_TIMESTAMP
       FROM event_schedule_sessions ess
      WHERE esp.event_id = $1
        AND esp.source_type = $2
        AND ess.source_type = $3
        ${userClause}
        AND ess.event_id = esp.event_id
        AND esp.source_ref IS NOT NULL
        AND ess.source_ref IS NOT NULL
        AND esp.source_ref = ess.source_ref
        AND esp.archived_at IS NULL
        AND ess.archived_at IS NULL
        AND esp.source_catalog_session_id IS DISTINCT FROM ess.id
      RETURNING esp.id`,
    params
  );
  return { linked: result.rowCount || 0 };
}

async function syncPersonalIcsSource(pool, { source, eventId, userId, fetchImpl = fetch, fetchOptions = {} }) {
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
    const text = await fetchIcsText(decrypted.value, fetchImpl, fetchOptions);
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
                  source_url = $9,
                  source_categories = $10,
                  source_updated_at = $11,
                  source_sequence = $12,
                  archived_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
              AND event_id = $2
              AND created_by = $3
              AND source_type = $4`,
          [
            existing.rows[0].id,
            eventId,
            userId,
            ICS_SOURCE_TYPE,
            item.title,
            item.start_at,
            item.end_at,
            item.location,
            item.source_url,
            item.source_categories,
            item.source_updated_at,
            item.source_sequence
          ]
        );
        updated += 1;
      } else {
        await pool.query(
          `INSERT INTO event_schedule_plans (
             event_id, title, start_at, end_at, location, source_type, source_ref,
             source_url, source_categories, source_updated_at, source_sequence,
             status, visibility, notes, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'private', $13, $14)`,
          [
            eventId,
            item.title,
            item.start_at,
            item.end_at,
            item.location,
            ICS_SOURCE_TYPE,
            item.sourceRef,
            item.source_url,
            item.source_categories,
            item.source_updated_at,
            item.source_sequence,
            item.status,
            item.notes,
            userId
          ]
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

    const linkSummary = await linkPersonalPlansToCatalogSessions(pool, { eventId, userId });
    const summary = { created, updated, removed, linked: linkSummary.linked, total: items.length };
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
    return { source: failedSource.rows[0] || source, summary: { created: 0, updated: 0, removed: 0, linked: 0, total: 0 }, error: safeMessage, items: [] };
  }
}

async function importCatalogIcsSource(pool, { eventId, userId, feedUrl, fetchImpl = fetch, fetchOptions = {} }) {
  const text = await fetchIcsText(feedUrl, fetchImpl, fetchOptions);
  const items = parseIcsCatalogSessions(text);
  const savedItems = [];
  let created = 0;
  let updated = 0;

  for (const item of items) {
    const existing = await pool.query(
      `SELECT id
         FROM event_schedule_sessions
        WHERE event_id = $1
          AND source_type = $2
          AND source_ref = $3
        LIMIT 1`,
      [eventId, CATALOG_ICS_SOURCE_TYPE, item.source_ref]
    );
    if (existing.rows[0]) {
      const updatedResult = await pool.query(
        `UPDATE event_schedule_sessions
            SET title = $4,
                start_at = $5,
                end_at = $6,
                location = $7,
                room = $8,
                description = $9,
                track = $10,
                categories = $11,
                source_url = $12,
                source_updated_at = $13,
                status = $14,
                archived_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND event_id = $2
            AND source_type = $3
          RETURNING *`,
        [
          existing.rows[0].id,
          eventId,
          CATALOG_ICS_SOURCE_TYPE,
          item.title,
          item.start_at,
          item.end_at,
          item.location,
          item.room,
          item.description,
          item.track,
          item.categories,
          item.source_url,
          item.source_updated_at,
          item.status
        ]
      );
      if (updatedResult.rows[0]) savedItems.push(updatedResult.rows[0]);
      updated += 1;
    } else {
      const insertedResult = await pool.query(
        `INSERT INTO event_schedule_sessions (
           event_id, title, start_at, end_at, location, room, description, track,
           categories, source_type, source_ref, source_url, source_updated_at,
           status, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          eventId,
          item.title,
          item.start_at,
          item.end_at,
          item.location,
          item.room,
          item.description,
          item.track,
          item.categories,
          CATALOG_ICS_SOURCE_TYPE,
          item.source_ref,
          item.source_url,
          item.source_updated_at,
          item.status,
          userId
        ]
      );
      if (insertedResult.rows[0]) savedItems.push(insertedResult.rows[0]);
      created += 1;
    }
  }

  const linkSummary = await linkPersonalPlansToCatalogSessions(pool, { eventId });

  return {
    summary: { created, updated, linked: linkSummary.linked, total: items.length },
    items: savedItems
  };
}

module.exports = {
  ICS_SOURCE_TYPE,
  CATALOG_ICS_SOURCE_TYPE,
  ICS_FETCH_USER_AGENT,
  fetchIcsText,
  parseIcsEvents,
  parseIcsCatalogSessions,
  normalizeCatalogCategories,
  inferCatalogRoom,
  serializeIcsSource,
  loadPersonalIcsSource,
  upsertPersonalIcsSource,
  removePersonalIcsSource,
  linkPersonalPlansToCatalogSessions,
  syncPersonalIcsSource,
  importCatalogIcsSource
};
