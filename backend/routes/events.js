const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const {
  validate,
  eventCreateSchema,
  eventUpdateSchema,
  eventArtifactCreateSchema,
  eventArtifactUpdateSchema,
  eventArtifactSignatureLinkSchema,
  eventPurchasedItemCreateSchema,
  eventPurchasedItemUpdateSchema,
  eventAttendeeCreateSchema,
  eventAttendeeUpdateSchema,
  eventGroupCreateSchema,
  eventGroupUpdateSchema,
  eventMeetupCreateSchema,
  eventMeetupUpdateSchema,
  eventSchedulePlanCreateSchema,
  eventSchedulePlanUpdateSchema,
  eventPersonalIcsSourceSchema
} = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const { isFeatureEnabled } = require('../services/featureFlags');
const {
  loadSignatureRecords,
  serializeSignatureRow,
  syncPrimarySignatureRecord
} = require('../services/signatures');
const {
  serializeIcsSource,
  loadPersonalIcsSource,
  upsertPersonalIcsSource,
  removePersonalIcsSource,
  syncPersonalIcsSource
} = require('../services/schedIcsSync');

const router = express.Router();
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
]);

router.use('/events', authenticateToken);
router.use('/events', enforceScopeAccess({ allowedHintRoles: ['admin'] }));
router.use('/events', asyncHandler(async (_req, res, next) => {
  const enabled = await isFeatureEnabled('events_enabled', false);
  if (!enabled) return res.status(404).json({ error: 'Events feature is disabled' });
  return next();
}));

const parsePaging = (req) => {
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  return { page, limit, offset: (page - 1) * limit };
};

const serializePurchasedItemRecord = (row) => ({
  id: row.id,
  event_id: row.event_id,
  item_type: row.item_type,
  item_id: row.item_id,
  title_snapshot: row.title_snapshot || null,
  vendor_snapshot: row.vendor_snapshot || null,
  booth_snapshot: row.booth_snapshot || null,
  price_snapshot: row.price_snapshot === null || row.price_snapshot === undefined ? null : Number(row.price_snapshot),
  created_by: row.created_by || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  resolved_item: row.resolved_item || null
});

const ARTIFACT_DB_FIELDS = ['artifact_type', 'title', 'description', 'image_path', 'price', 'vendor'];
const ARTIFACT_SIGNATURE_FIELDS = ['signer_name', 'signer_role', 'signed_on', 'signed_at', 'signature_notes', 'proof_path'];
const EVENT_ATTENDEE_FIELDS = ['display_name', 'contact_label', 'relationship', 'status', 'visibility', 'notes'];
const EVENT_GROUP_FIELDS = ['name', 'visibility', 'status', 'notes'];
const EVENT_MEETUP_FIELDS = ['group_id', 'title', 'start_at', 'end_at', 'location', 'vendor', 'booth', 'location_notes', 'status', 'visibility', 'notes'];
const EVENT_SCHEDULE_PLAN_FIELDS = [
  'title',
  'start_at',
  'end_at',
  'location',
  'vendor',
  'booth',
  'location_notes',
  'source_type',
  'source_ref',
  'source_url',
  'source_categories',
  'source_updated_at',
  'source_sequence',
  'status',
  'visibility',
  'notes'
];

const EVENT_COMPANION_CONTRACT_VERSION = 'event-social-companion.v1';
const EVENT_COMPANION_CACHE_POLICY = {
  recommended_ttl_seconds: 300,
  stale_after_seconds: 43200,
  offline_mode: 'read_only_snapshot',
  conflict_policy: 'Backend remains authoritative; queued native mutations must refetch before retrying after reconnect.'
};
const EVENT_COMPANION_PRIVACY_POLICY = {
  personal_ics_url_returned: false,
  realtime_location: false,
  broad_social_discovery: false,
  notifications: 'not_available_in_this_contract',
  visibility_values: ['private', 'selected_people', 'group', 'event_workspace']
};
const EVENT_COMPANION_ICS_STATE_LABELS = {
  not_connected: 'No personal Sched feed connected',
  never_synced: 'Personal Sched feed connected but not synced yet',
  fresh: 'Personal Sched schedule is fresh',
  stale: 'Personal Sched schedule may be stale',
  failed: 'Last personal Sched sync failed',
  unknown: 'Personal Sched sync state is unknown'
};
const EVENT_COMPANION_OFFLINE_PACKET_VERSION = 'event-social-offline-packet.v1';

const serializeEventArtifactRow = (row = {}) => ({
  ...row,
  signature: row.signature || null,
  event_artifact_signature: row.event_artifact_signature || null,
  linked_signature: row.linked_signature || null
});

const buildEventArtifactSignaturePayload = ({ artifact = {}, event = {}, payload = {} }) => ({
  signer_name: payload.signer_name || artifact.signer_name || artifact.title || null,
  signer_role: payload.signer_role || artifact.signer_role || null,
  signed_on: payload.signed_on || artifact.signed_on || event.date_start || null,
  signed_at: payload.signed_at || artifact.signed_at || event.location || null,
  signed_event_id: event.id || artifact.event_id || null,
  proof_path: payload.proof_path || payload.image_path || artifact.image_path || null,
  notes: payload.signature_notes || payload.notes || payload.description || artifact.description || null
});

async function loadSignatureRowsByIds(signatureIds = []) {
  const ids = Array.from(new Set((signatureIds || [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0)));
  if (ids.length === 0) return new Map();
  const result = await pool.query(
    `SELECT *
       FROM signature_records
      WHERE id = ANY($1::int[])
        AND archived_at IS NULL`,
    [ids]
  );
  return new Map((result.rows || []).map((row) => [Number(row.id), serializeSignatureRow(row)]));
}

async function attachSignaturesToEventArtifacts(rows = []) {
  const artifacts = Array.isArray(rows) ? rows : [];
  if (artifacts.length === 0) return artifacts;
  const artifactIds = artifacts.map((row) => Number(row.id || 0)).filter(Boolean);
  const eventArtifactSignatures = await loadSignatureRecords(pool, { ownerType: 'event_artifact', ownerIds: artifactIds });
  const linkedSignatures = await loadSignatureRowsByIds(artifacts.map((row) => row.signature_record_id));
  return artifacts.map((row) => {
    const eventArtifactSignature = (eventArtifactSignatures.get(Number(row.id || 0)) || [])[0] || null;
    const linkedSignature = linkedSignatures.get(Number(row.signature_record_id || 0)) || null;
    return serializeEventArtifactRow({
      ...row,
      event_artifact_signature: eventArtifactSignature,
      linked_signature: linkedSignature,
      signature: linkedSignature || eventArtifactSignature || null
    });
  });
}

async function syncEventArtifactSignature({ artifact, event, payload = {}, userId = null }) {
  if (!artifact?.id || artifact.artifact_type !== 'autograph') return null;
  const signature = await syncPrimarySignatureRecord(pool, {
    ownerType: 'event_artifact',
    ownerId: artifact.id,
    libraryId: event.library_id || null,
    spaceId: event.space_id || null,
    createdBy: userId,
    signature: buildEventArtifactSignaturePayload({ artifact, event, payload }),
    signed: true
  });
  return signature;
}

async function ensureScopedEvent(scopeContext, eventId) {
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id, library_id, space_id, date_start, location
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  return eventResult.rows[0] || null;
}

function parsePositiveId(value, label = 'id') {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    const error = new Error(`Invalid ${label}`);
    error.status = 400;
    throw error;
  }
  return id;
}

async function ensureEventSocialGroup(eventId, groupId) {
  if (!groupId) return null;
  const result = await pool.query(
    `SELECT id, event_id
       FROM event_groups
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      LIMIT 1`,
    [groupId, eventId]
  );
  return result.rows[0] || null;
}

function buildInsertSql({ table, eventId, fields, body, userId }) {
  const columns = ['event_id'];
  const placeholders = ['$1'];
  const values = [eventId];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    values.push(body[field] ?? null);
    placeholders.push(`$${values.length}`);
    columns.push(field);
  }
  columns.push('created_by');
  values.push(userId || null);
  placeholders.push(`$${values.length}`);
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  };
}

function buildUpdateSql({ table, idColumn, id, eventId, fields, body }) {
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    values.push(body[field] ?? null);
    updates.push(`${field} = $${values.length}`);
  }
  if (updates.length === 0) return null;
  values.push(id);
  values.push(eventId);
  return {
    sql: `UPDATE ${table}
             SET ${updates.join(', ')}
           WHERE ${idColumn} = $${values.length - 1}
             AND event_id = $${values.length}
             AND archived_at IS NULL
       RETURNING *`,
    values
  };
}

async function replaceEventGroupMembers(eventId, groupId, attendeeIds = [], userId = null) {
  if (!Array.isArray(attendeeIds)) return;
  const uniqueAttendeeIds = Array.from(new Set(attendeeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  await pool.query('DELETE FROM event_group_members WHERE group_id = $1', [groupId]);
  if (uniqueAttendeeIds.length === 0) return;
  const attendees = await pool.query(
    `SELECT id
       FROM event_attendees
      WHERE event_id = $1
        AND id = ANY($2::int[])
        AND archived_at IS NULL`,
    [eventId, uniqueAttendeeIds]
  );
  const scopedIds = (attendees.rows || []).map((row) => Number(row.id));
  for (const attendeeId of scopedIds) {
    await pool.query(
      `INSERT INTO event_group_members (group_id, attendee_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, attendee_id) DO NOTHING`,
      [groupId, attendeeId, userId]
    );
  }
}

async function attachMembersToGroups(groups = []) {
  const groupIds = groups.map((group) => Number(group.id || 0)).filter(Boolean);
  if (groupIds.length === 0) return groups;
  const memberResult = await pool.query(
    `SELECT egm.group_id,
            ea.id,
            ea.display_name,
            ea.contact_label,
            ea.relationship,
            ea.status,
            ea.visibility
       FROM event_group_members egm
       JOIN event_attendees ea ON ea.id = egm.attendee_id
      WHERE egm.group_id = ANY($1::int[])
        AND ea.archived_at IS NULL
      ORDER BY ea.display_name ASC, ea.id ASC`,
    [groupIds]
  );
  const membersByGroup = new Map();
  for (const row of memberResult.rows || []) {
    const key = Number(row.group_id);
    if (!membersByGroup.has(key)) membersByGroup.set(key, []);
    membersByGroup.get(key).push({
      id: row.id,
      display_name: row.display_name,
      contact_label: row.contact_label || null,
      relationship: row.relationship || null,
      status: row.status,
      visibility: row.visibility
    });
  }
  return groups.map((group) => ({
    ...group,
    members: membersByGroup.get(Number(group.id)) || []
  }));
}

function classifyPersonalIcsFreshness(source = null, now = new Date()) {
  if (!source?.has_url) return 'not_connected';
  if (source.sync_status === 'failed' || source.status === 'error') return 'failed';
  if (!source.last_success_at) return 'never_synced';
  const lastSuccess = new Date(source.last_success_at).getTime();
  if (!Number.isFinite(lastSuccess)) return 'unknown';
  const staleAfterMs = EVENT_COMPANION_CACHE_POLICY.stale_after_seconds * 1000;
  return now.getTime() - lastSuccess > staleAfterMs ? 'stale' : 'fresh';
}

function sanitizePersonalIcsError(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/webcal:\/\/\S+/gi, '[redacted-url]')
    .slice(0, 240);
}

function buildPersonalIcsSyncVisibility({ eventId, source = null, freshness = 'not_connected' }) {
  const connected = Boolean(source?.has_url);
  const lastSuccessAt = source?.last_success_at || null;
  let staleAfterAt = null;
  if (lastSuccessAt) {
    const lastSuccessTime = new Date(lastSuccessAt).getTime();
    if (Number.isFinite(lastSuccessTime)) {
      staleAfterAt = new Date(lastSuccessTime + EVENT_COMPANION_CACHE_POLICY.stale_after_seconds * 1000).toISOString();
    }
  }
  return {
    connected,
    provider: source?.provider || 'sched_ics',
    status: source?.status || (connected ? 'active' : 'not_connected'),
    sync_status: source?.sync_status || 'idle',
    freshness,
    state_label: EVENT_COMPANION_ICS_STATE_LABELS[freshness] || EVENT_COMPANION_ICS_STATE_LABELS.unknown,
    last_synced_at: source?.last_synced_at || null,
    last_success_at: lastSuccessAt,
    stale_after_at: staleAfterAt,
    last_item_count: Number(source?.last_item_count || 0),
    has_error: Boolean(source?.last_error || freshness === 'failed'),
    error_summary: sanitizePersonalIcsError(source?.last_error),
    manual_refresh_supported: connected,
    manual_refresh_endpoint: connected ? `/api/events/${eventId}/personal-ics-source/sync` : null,
    personal_schedule_only: true,
    raw_url_returned: false
  };
}

function addOfflineLocation(locations, seen, location) {
  const name = String(location?.name || '').trim();
  if (!name) return;
  const key = [
    name.toLowerCase(),
    String(location?.vendor || '').trim().toLowerCase(),
    String(location?.booth || '').trim().toLowerCase()
  ].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  locations.push({
    kind: location.kind || 'location',
    name,
    vendor: location.vendor || null,
    booth: location.booth || null,
    notes: location.notes || null,
    source_type: location.source_type || null,
    source_id: location.source_id || null,
    starts_at: location.starts_at || null
  });
}

function buildOfflineKeyLocations({ event = {}, meetups = [], plans = [] }) {
  const locations = [];
  const seen = new Set();
  addOfflineLocation(locations, seen, {
    kind: 'event',
    name: event.location,
    source_type: 'event',
    source_id: event.id || null,
    starts_at: event.date_start || null
  });
  for (const meetup of meetups || []) {
    addOfflineLocation(locations, seen, {
      kind: 'meetup',
      name: meetup.location,
      vendor: meetup.vendor,
      booth: meetup.booth,
      notes: meetup.location_notes,
      source_type: 'meetup',
      source_id: meetup.id || null,
      starts_at: meetup.start_at || null
    });
  }
  for (const plan of plans || []) {
    addOfflineLocation(locations, seen, {
      kind: 'schedule_plan',
      name: plan.location,
      vendor: plan.vendor,
      booth: plan.booth,
      notes: plan.location_notes,
      source_type: 'schedule_plan',
      source_id: plan.id || null,
      starts_at: plan.start_at || null
    });
  }
  return locations.slice(0, 100);
}

function buildOfflinePacket({ event = {}, attendees = [], groups = [], meetups = [], plans = [], generatedAt = new Date(), icsFreshness = 'not_connected' }) {
  const generatedIso = generatedAt.toISOString();
  const staleAfterAt = new Date(generatedAt.getTime() + EVENT_COMPANION_CACHE_POLICY.stale_after_seconds * 1000).toISOString();
  const keyLocations = buildOfflineKeyLocations({ event, meetups, plans });
  return {
    version: EVENT_COMPANION_OFFLINE_PACKET_VERSION,
    generated_at: generatedIso,
    event_id: event.id || null,
    cache_key: `event:${event.id || 'unknown'}:offline:${generatedIso}`,
    recommended_ttl_seconds: EVENT_COMPANION_CACHE_POLICY.recommended_ttl_seconds,
    stale_after_at: staleAfterAt,
    stale_after_seconds: EVENT_COMPANION_CACHE_POLICY.stale_after_seconds,
    mode: 'read_only_snapshot',
    backend_authoritative: true,
    supports_offline_mutations: false,
    retry_policy: {
      queued_mutations_supported: false,
      refetch_before_retry: true,
      conflict_resolution: 'backend_authoritative_refetch_before_write',
      guidance: 'Use this packet while offline, then refetch the companion snapshot before retrying any user action after reconnect.'
    },
    includes: {
      event: true,
      attendees: true,
      groups: true,
      meetups: true,
      planned_sessions: true,
      schedule_catalog: false,
      key_locations: true,
      personal_ics_sync_visibility: true
    },
    counts: {
      attendees: attendees.length,
      groups: groups.length,
      meetups: meetups.length,
      planned_sessions: plans.length,
      schedule_catalog_sessions: 0,
      key_locations: keyLocations.length
    },
    freshness: {
      packet: 'fresh',
      personal_ics: icsFreshness,
      stale_state_visible: true
    },
    privacy: {
      raw_personal_ics_url_returned: false,
      realtime_location_included: false,
      presence_included: false,
      broad_social_discovery_included: false
    },
    limitations: [
      'full_schedule_catalog_not_available',
      'offline_mutation_queue_not_supported',
      'push_notifications_not_supported',
      'realtime_location_not_supported',
      'presence_tracking_not_supported'
    ],
    schedule_catalog: [],
    planned_sessions: plans,
    key_locations: keyLocations
  };
}

async function loadCompanionTodayPayload({ eventId, scopeContext, userId }) {
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext, {
    libraryColumn: 'e.library_id',
    spaceColumn: 'e.space_id'
  });
  const eventResult = await pool.query(
    `SELECT e.*
       FROM events e
      WHERE e.id = $1
        AND e.archived_at IS NULL
        ${eventScopeClause}
      LIMIT 1`,
    eventParams
  );
  const event = eventResult.rows[0] || null;
  if (!event) return null;

  const [attendeesResult, groupsResult, meetupsResult, plansResult] = await Promise.all([
    pool.query(
      `SELECT *
         FROM event_attendees
        WHERE event_id = $1
          AND archived_at IS NULL
        ORDER BY display_name ASC, id ASC`,
      [eventId]
    ),
    pool.query(
      `SELECT *
         FROM event_groups
        WHERE event_id = $1
          AND archived_at IS NULL
        ORDER BY name ASC, id ASC`,
      [eventId]
    ),
    pool.query(
      `SELECT em.*, eg.name AS group_name
         FROM event_meetups em
         LEFT JOIN event_groups eg ON eg.id = em.group_id AND eg.archived_at IS NULL
        WHERE em.event_id = $1
          AND em.archived_at IS NULL
        ORDER BY em.start_at NULLS LAST, em.title ASC, em.id ASC`,
      [eventId]
    ),
    pool.query(
      `SELECT *
         FROM event_schedule_plans
        WHERE event_id = $1
          AND archived_at IS NULL
        ORDER BY start_at NULLS LAST, title ASC, id ASC`,
      [eventId]
    )
  ]);

  const groups = await attachMembersToGroups(groupsResult.rows || []);
  const icsSource = serializeIcsSource(await loadPersonalIcsSource(pool, { eventId, userId }));
  const generatedAt = new Date();
  const icsFreshness = classifyPersonalIcsFreshness(icsSource, generatedAt);
  return {
    contract: {
      version: EVENT_COMPANION_CONTRACT_VERSION,
      generated_at: generatedAt.toISOString(),
      read_endpoint: `/api/events/${eventId}/companion/today`,
      write_endpoints: {
        attendees: `/api/events/${eventId}/attendees`,
        groups: `/api/events/${eventId}/groups`,
        meetups: `/api/events/${eventId}/meetups`,
        schedule_plans: `/api/events/${eventId}/schedule-plans`,
        personal_ics_source: `/api/events/${eventId}/personal-ics-source`
      },
      out_of_scope: [
        'full_schedule_catalog',
        'push_notifications',
        'realtime_location',
        'presence_tracking',
        'offline_mutation_queue'
      ]
    },
    event,
    counts: {
      attendees: attendeesResult.rows.length,
      groups: groups.length,
      meetups: meetupsResult.rows.length,
      schedule_plans: plansResult.rows.length
    },
    sync: {
      personal_ics: icsSource,
      freshness: icsFreshness,
      personal_ics_visibility: buildPersonalIcsSyncVisibility({ eventId, source: icsSource, freshness: icsFreshness })
    },
    cache: EVENT_COMPANION_CACHE_POLICY,
    privacy: EVENT_COMPANION_PRIVACY_POLICY,
    offline_packet: buildOfflinePacket({
      event,
      attendees: attendeesResult.rows,
      groups,
      meetups: meetupsResult.rows,
      plans: plansResult.rows,
      generatedAt,
      icsFreshness
    }),
    attendees: attendeesResult.rows,
    groups,
    meetups: meetupsResult.rows,
    schedule_plans: plansResult.rows
  };
}

async function loadPurchasedItemSource(scopeContext, itemType, itemId) {
  const params = [itemId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });

  if (itemType === 'art') {
    const result = await pool.query(
      `SELECT id, source_collectible_id, library_id, space_id, title, vendor, booth, price, image_path, artist, series, exclusive, notes, created_at, updated_at, archived_at
       FROM art_items
       WHERE id = $1
         AND archived_at IS NULL
         ${scopeClause}
       LIMIT 1`,
      params
    );
    if (!result.rows[0]) return null;
    return {
      item_type: 'art',
      item_id: result.rows[0].id,
      title: result.rows[0].title,
      vendor: result.rows[0].vendor || null,
      booth: result.rows[0].booth || null,
      price: result.rows[0].price ?? null,
      resolved_item: {
        id: result.rows[0].id,
        source_collectible_id: result.rows[0].source_collectible_id || null,
        library_id: result.rows[0].library_id || null,
        space_id: result.rows[0].space_id || null,
        title: result.rows[0].title,
        artist: result.rows[0].artist || null,
        series: result.rows[0].series || null,
        vendor: result.rows[0].vendor || null,
        booth: result.rows[0].booth || null,
        price: result.rows[0].price === null || result.rows[0].price === undefined ? null : Number(result.rows[0].price),
        exclusive: result.rows[0].exclusive === true,
        image_path: result.rows[0].image_path || null,
        notes: result.rows[0].notes || null,
        created_at: result.rows[0].created_at,
        updated_at: result.rows[0].updated_at,
        archived_at: result.rows[0].archived_at || null
      }
    };
  }

  const result = await pool.query(
    `SELECT id, title, vendor, booth, price, image_path, subtype, category_key, artist, series
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       AND subtype <> 'art'
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!result.rows[0]) return null;
  return {
    item_type: 'collectible',
    item_id: result.rows[0].id,
    title: result.rows[0].title,
    vendor: result.rows[0].vendor || null,
    booth: result.rows[0].booth || null,
    price: result.rows[0].price ?? null,
    resolved_item: {
      id: result.rows[0].id,
      item_type: 'collectible',
      subtype: result.rows[0].subtype || 'collectible',
      category_key: result.rows[0].category_key || null,
      title: result.rows[0].title,
      artist: result.rows[0].artist || null,
      series: result.rows[0].series || null,
      vendor: result.rows[0].vendor || null,
      booth: result.rows[0].booth || null,
      image_path: result.rows[0].image_path || null
    }
  };
}

async function loadSignatureTargetSource(scopeContext, ownerType, ownerId) {
  const params = [ownerId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  if (ownerType === 'art') {
    const result = await pool.query(
      `SELECT id, library_id, space_id, title, artist, image_path
       FROM art_items
       WHERE id = $1
         AND archived_at IS NULL
         ${scopeClause}
       LIMIT 1`,
      params
    );
    return result.rows[0] || null;
  }
  if (ownerType === 'media') {
    const result = await pool.query(
      `SELECT id, library_id, space_id, title, signed_by, signed_role, signed_on, signed_at, signed_proof_path
       FROM media
       WHERE id = $1
         AND archived_at IS NULL
         ${scopeClause}
       LIMIT 1`,
      params
    );
    return result.rows[0] || null;
  }
  return null;
}

const buildLinkedObjectSignaturePayload = ({ artifact = {}, event = {}, sourceSignature = null, payload = {} }) => ({
  signer_name: payload.signer_name || sourceSignature?.signer_name || artifact.title || null,
  signer_role: payload.signer_role || sourceSignature?.signer_role || null,
  signed_on: payload.signed_on || sourceSignature?.signed_on || event.date_start || null,
  signed_at: payload.signed_at || sourceSignature?.signed_at || event.location || null,
  signed_event_id: event.id || sourceSignature?.signed_event_id || null,
  proof_path: payload.proof_path || sourceSignature?.proof_path || artifact.image_path || null,
  notes: payload.notes || sourceSignature?.notes || artifact.description || null
});

async function loadPurchasedItemsForEvent(eventId, scopeContext) {
  const result = await pool.query(
    `SELECT epi.*
     FROM event_purchased_items epi
     WHERE epi.event_id = $1
       AND epi.archived_at IS NULL
     ORDER BY epi.created_at DESC, epi.id DESC`,
    [eventId]
  );

  const rows = [];
  for (const row of result.rows) {
    const source = await loadPurchasedItemSource(scopeContext, row.item_type, row.item_id);
    rows.push(serializePurchasedItemRecord({
      ...row,
      resolved_item: source?.resolved_item || null
    }));
  }
  return rows;
}

router.get('/events', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { page, limit, offset } = parsePaging(req);
  const q = String(req.query?.q || '').trim();
  const from = String(req.query?.from || '').trim();
  const to = String(req.query?.to || '').trim();
  const location = String(req.query?.location || '').trim();
  const sortDir = String(req.query?.sort_dir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const params = [];
  let where = 'WHERE e.archived_at IS NULL';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      e.title ILIKE $${params.length}
      OR COALESCE(e.location, '') ILIKE $${params.length}
      OR COALESCE(e.host, '') ILIKE $${params.length}
      OR COALESCE(e.notes, '') ILIKE $${params.length}
    )`;
  }
  if (location) {
    params.push(`%${location}%`);
    where += ` AND e.location ILIKE $${params.length}`;
  }
  if (from.match(/^\d{4}-\d{2}-\d{2}$/)) {
    params.push(from);
    where += ` AND e.date_start >= $${params.length}::date`;
  }
  if (to.match(/^\d{4}-\d{2}-\d{2}$/)) {
    params.push(to);
    where += ` AND e.date_start <= $${params.length}::date`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'e.space_id',
    libraryColumn: 'e.library_id'
  });
  const whereWithScope = `${where} ${scopeClause}`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM events e
     ${whereWithScope}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rows = await pool.query(
    `SELECT
       e.*,
       COALESCE(a.artifact_count, 0)::int AS artifact_count,
       COALESCE(p.purchased_item_count, 0)::int AS purchased_item_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS purchased_item_count
       FROM event_purchased_items epi
       WHERE epi.event_id = e.id
         AND epi.archived_at IS NULL
     ) p ON TRUE
     ${whereWithScope}
     ORDER BY e.date_start ${sortDir} NULLS LAST, e.date_end ${sortDir} NULLS LAST, e.title ${sortDir}, e.id ${sortDir}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);
  res.json({
    items: rows.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page < Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.get('/events/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const row = await pool.query(
    `SELECT
       e.*,
       COALESCE(a.artifact_count, 0)::int AS artifact_count,
       COALESCE(p.purchased_item_count, 0)::int AS purchased_item_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS purchased_item_count
       FROM event_purchased_items epi
       WHERE epi.event_id = e.id
         AND epi.archived_at IS NULL
     ) p ON TRUE
     WHERE e.id = $1
       AND e.archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!row.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  res.json(row.rows[0]);
}));

router.post('/events', validate(eventCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const libraryId = Number(scopeContext?.libraryId || 0) || null;
  if (!libraryId) {
    return res.status(400).json({ error: 'No active library selected for event creation' });
  }
  const spaceId = Number(scopeContext?.spaceId || 0) || null;
  const { title, url, location, date_start, date_end, host, time_label, room, image_path, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO events (
       library_id, space_id, created_by, title, url, location, date_start, date_end, host, time_label, room, image_path, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13)
     RETURNING *`,
    [libraryId, spaceId, req.user.id, title, url, location, date_start, date_end || null, host || null, time_label || null, room || null, image_path || null, notes || null]
  );
  const row = result.rows[0];
  await logActivity(req, 'events.create', 'event', row.id, {
    title: row.title,
    date_start: row.date_start,
    location: row.location
  });
  res.status(201).json(row);
}));

router.patch('/events/:id', validate(eventUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const allowed = ['title', 'url', 'location', 'date_start', 'date_end', 'host', 'time_label', 'room', 'image_path', 'notes'];
  const fields = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (!fields.length) {
    return res.status(400).json({ error: 'No valid event fields provided' });
  }
  const updates = [];
  const params = [];
  for (const [key, value] of fields) {
    params.push(value ?? null);
    const cast = key === 'date_start' || key === 'date_end' ? '::date' : '';
    updates.push(`${key} = $${params.length}${cast}`);
  }
  params.push(eventId);
  let where = `WHERE id = $${params.length} AND archived_at IS NULL`;
  where += appendScopeSql(params, scopeContext);

  const result = await pool.query(
    `UPDATE events
     SET ${updates.join(', ')}
     ${where}
     RETURNING *`,
    params
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  await logActivity(req, 'events.update', 'event', eventId, {
    fields: fields.map(([k]) => k)
  });
  res.json(result.rows[0]);
}));

router.delete('/events/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `UPDATE events
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     RETURNING id, title`,
    params
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  await logActivity(req, 'events.delete', 'event', eventId, {
    title: result.rows[0].title
  });
  res.json({ ok: true, id: eventId });
}));

router.post('/events/:id/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const existing = await pool.query(
    `SELECT id, image_path
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Event not found' });

  const previousPath = existing.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE events
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, eventId]
  );

  await logActivity(req, previousPath ? 'events.image.replace' : 'events.image.upload', 'event', eventId, {
    previousPath,
    imagePath: updated.rows[0].image_path,
    provider: stored.provider
  });

  res.json(updated.rows[0]);
}));

router.delete('/events/:id/image', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const existing = await pool.query(
    `SELECT id, image_path
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Event not found' });
  if (!existing.rows[0].image_path) return res.status(400).json({ error: 'No image attached' });

  await pool.query(`UPDATE events SET image_path = NULL WHERE id = $1`, [eventId]);
  await logActivity(req, 'events.image.delete', 'event', eventId, {
    previousPath: existing.rows[0].image_path
  });
  res.json({ ok: true, id: eventId });
}));

router.get('/events/:id/artifacts', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifacts = await pool.query(
    `SELECT *
     FROM event_artifacts
     WHERE event_id = $1
     ORDER BY created_at DESC, id DESC`,
    [eventId]
  );
  res.json(await attachSignaturesToEventArtifacts(artifacts.rows));
}));

router.post('/events/:id/artifacts', validate(eventArtifactCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id, library_id, space_id, date_start, location
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const { artifact_type, title, description, image_path, price, vendor } = req.body;
  const created = await pool.query(
    `INSERT INTO event_artifacts (
       event_id, artifact_type, title, description, image_path, price, vendor, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [eventId, artifact_type, title, description || null, image_path || null, price ?? null, vendor || null, req.user.id]
  );
  let row = created.rows[0];
  const signature = await syncEventArtifactSignature({
    artifact: row,
    event: eventResult.rows[0],
    payload: req.body,
    userId: req.user.id
  });
  if (signature) {
    row = {
      ...row,
      event_artifact_signature: signature,
      linked_signature: null,
      signature
    };
  }
  await logActivity(req, 'events.artifact.create', 'event', eventId, {
    artifactId: row.id,
    artifactType: row.artifact_type,
    title: row.title
  });
  res.status(201).json(serializeEventArtifactRow(row));
}));

router.patch('/events/:id/artifacts/:artifactId', validate(eventArtifactUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id, library_id, space_id, date_start, location
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const fields = Object.entries(req.body || {}).filter(([key]) => ARTIFACT_DB_FIELDS.includes(key));
  const touchesSignature = ARTIFACT_SIGNATURE_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  if (!fields.length) {
    if (!touchesSignature) return res.status(400).json({ error: 'No valid artifact fields provided' });
  }
  const updates = [];
  const params = [eventId, artifactId];
  for (const [key, value] of fields) {
    params.push(value ?? null);
    updates.push(`${key} = $${params.length}`);
  }
  const result = updates.length > 0
    ? await pool.query(
      `UPDATE event_artifacts
       SET ${updates.join(', ')}
       WHERE event_id = $1
         AND id = $2
       RETURNING *`,
      params
    )
    : await pool.query(
      `SELECT *
       FROM event_artifacts
       WHERE event_id = $1
         AND id = $2
       LIMIT 1`,
      params
    );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  let row = result.rows[0];
  const signature = await syncEventArtifactSignature({
    artifact: row,
    event: eventResult.rows[0],
    payload: req.body,
    userId: req.user.id
  });
  await logActivity(req, 'events.artifact.update', 'event', eventId, {
    artifactId,
    fields: [
      ...fields.map(([k]) => k),
      ...(touchesSignature ? ['signature'] : [])
    ]
  });
  const hydrated = await attachSignaturesToEventArtifacts([row]);
  res.json(hydrated[0] || serializeEventArtifactRow(row));
}));

router.post('/events/:id/artifacts/:artifactId/link-signature', validate(eventArtifactSignatureLinkSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const artifactResult = await pool.query(
    `SELECT *
       FROM event_artifacts
      WHERE id = $1
        AND event_id = $2
      LIMIT 1`,
    [artifactId, eventId]
  );
  const artifact = artifactResult.rows[0] || null;
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  if (artifact.artifact_type !== 'autograph') {
    return res.status(400).json({ error: 'Only autograph artifacts can be linked to object signatures' });
  }

  const target = await loadSignatureTargetSource(scopeContext, req.body.owner_type, Number(req.body.owner_id));
  if (!target) return res.status(404).json({ error: 'Signature target not found in scope' });

  const hydratedArtifact = (await attachSignaturesToEventArtifacts([artifact]))[0] || artifact;
  const sourceSignature = hydratedArtifact.event_artifact_signature || hydratedArtifact.signature || null;
  const signaturePayload = buildLinkedObjectSignaturePayload({
    artifact,
    event: eventRow,
    sourceSignature,
    payload: req.body
  });

  const signature = await syncPrimarySignatureRecord(pool, {
    ownerType: req.body.owner_type,
    ownerId: target.id,
    libraryId: target.library_id || null,
    spaceId: target.space_id || null,
    createdBy: req.user.id,
    signature: signaturePayload,
    signed: true
  });

  if (req.body.owner_type === 'art') {
    await pool.query(
      `UPDATE art_items
       SET signed = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [target.id]
    );
  } else if (req.body.owner_type === 'media') {
    await pool.query(
      `UPDATE media
       SET signed_by = $2,
           signed_role = $3,
           signed_on = $4,
           signed_at = $5,
           signed_proof_path = $6
       WHERE id = $1`,
      [
        target.id,
        signaturePayload.signer_name || null,
        signaturePayload.signer_role || null,
        signaturePayload.signed_on || null,
        signaturePayload.signed_at || null,
        signaturePayload.proof_path || null
      ]
    );
  }

  const updatedArtifact = await pool.query(
    `UPDATE event_artifacts
     SET signature_record_id = $1
     WHERE id = $2
       AND event_id = $3
     RETURNING *`,
    [signature?.id || null, artifactId, eventId]
  );

  await logActivity(req, 'events.artifact.signature.link', 'event', eventId, {
    artifactId,
    signatureRecordId: signature?.id || null,
    ownerType: req.body.owner_type,
    ownerId: target.id
  });

  const hydrated = await attachSignaturesToEventArtifacts(updatedArtifact.rows);
  res.json({
    artifact: hydrated[0] || serializeEventArtifactRow(updatedArtifact.rows[0] || artifact),
    signature
  });
}));

router.delete('/events/:id/artifacts/:artifactId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const deleted = await pool.query(
    `DELETE FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     RETURNING id, artifact_type, title`,
    [eventId, artifactId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  await logActivity(req, 'events.artifact.delete', 'event', eventId, {
    artifactId,
    artifactType: deleted.rows[0].artifact_type,
    title: deleted.rows[0].title
  });
  res.json({ ok: true, id: artifactId });
}));

router.get('/events/:id/purchased-items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const purchasedItems = await loadPurchasedItemsForEvent(eventId, scopeContext);
  res.json({ items: purchasedItems });
}));

router.post('/events/:id/purchased-items', validate(eventPurchasedItemCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const source = await loadPurchasedItemSource(scopeContext, req.body.item_type, Number(req.body.item_id));
  if (!source) {
    return res.status(404).json({ error: 'Purchased item source not found in scope' });
  }

  const created = await pool.query(
    `INSERT INTO event_purchased_items (
       event_id,
       item_type,
       item_id,
       title_snapshot,
       vendor_snapshot,
       booth_snapshot,
       price_snapshot,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (event_id, item_type, item_id) WHERE archived_at IS NULL
     DO NOTHING
     RETURNING *`,
    [
      eventId,
      source.item_type,
      source.item_id,
      req.body.title_snapshot || source.title,
      req.body.vendor_snapshot || source.vendor || null,
      req.body.booth_snapshot || source.booth || null,
      req.body.price_snapshot ?? source.price ?? null,
      req.user.id
    ]
  );
  if (!created.rows[0]) {
    return res.status(409).json({ error: 'Purchased item is already linked to this event' });
  }

  await logActivity(req, 'events.purchased_item.create', 'event', eventId, {
    purchasedItemId: created.rows[0].id,
    itemType: source.item_type,
    itemId: source.item_id
  });

  res.status(201).json(serializePurchasedItemRecord({
    ...created.rows[0],
    resolved_item: source.resolved_item
  }));
}));

router.patch('/events/:id/purchased-items/:purchasedItemId', validate(eventPurchasedItemUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const purchasedItemId = Number(req.params.purchasedItemId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(purchasedItemId) || purchasedItemId <= 0) {
    return res.status(400).json({ error: 'Invalid event/purchased item id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const existing = await pool.query(
    `SELECT *
     FROM event_purchased_items
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     LIMIT 1`,
    [purchasedItemId, eventId]
  );
  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'Purchased item link not found' });
  }

  let source = await loadPurchasedItemSource(scopeContext, existing.rows[0].item_type, existing.rows[0].item_id);
  let nextItemType = existing.rows[0].item_type;
  let nextItemId = existing.rows[0].item_id;

  const relinkRequested = Object.prototype.hasOwnProperty.call(req.body || {}, 'item_type')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'item_id');
  if (relinkRequested) {
    const targetItemType = req.body.item_type || existing.rows[0].item_type;
    const targetItemId = req.body.item_id || existing.rows[0].item_id;
    source = await loadPurchasedItemSource(scopeContext, targetItemType, Number(targetItemId));
    if (!source) {
      return res.status(404).json({ error: 'Purchased item source not found in scope' });
    }
    nextItemType = source.item_type;
    nextItemId = source.item_id;
  }

  if (
    (nextItemType !== existing.rows[0].item_type || Number(nextItemId) !== Number(existing.rows[0].item_id))
  ) {
    const duplicate = await pool.query(
      `SELECT id
       FROM event_purchased_items
       WHERE event_id = $1
         AND item_type = $2
         AND item_id = $3
         AND archived_at IS NULL
         AND id <> $4
       LIMIT 1`,
      [eventId, nextItemType, nextItemId, purchasedItemId]
    );
    if (duplicate.rows[0]) {
      return res.status(409).json({ error: 'Purchased item is already linked to this event' });
    }
  }

  const updated = await pool.query(
    `UPDATE event_purchased_items
     SET item_type = $3,
         item_id = $4,
         title_snapshot = $5,
         vendor_snapshot = $6,
         booth_snapshot = $7,
         price_snapshot = $8
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     RETURNING *`,
    [
      purchasedItemId,
      eventId,
      nextItemType,
      nextItemId,
      req.body.title_snapshot ?? existing.rows[0].title_snapshot ?? source?.title ?? null,
      req.body.vendor_snapshot ?? existing.rows[0].vendor_snapshot ?? source?.vendor ?? null,
      req.body.booth_snapshot ?? existing.rows[0].booth_snapshot ?? source?.booth ?? null,
      req.body.price_snapshot ?? existing.rows[0].price_snapshot ?? source?.price ?? null
    ]
  );

  await logActivity(req, 'events.purchased_item.update', 'event', eventId, {
    purchasedItemId,
    itemType: nextItemType,
    itemId: nextItemId
  });

  res.json(serializePurchasedItemRecord({
    ...updated.rows[0],
    resolved_item: source?.resolved_item || null
  }));
}));

router.delete('/events/:id/purchased-items/:purchasedItemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const purchasedItemId = Number(req.params.purchasedItemId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(purchasedItemId) || purchasedItemId <= 0) {
    return res.status(400).json({ error: 'Invalid event/purchased item id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const deleted = await pool.query(
    `UPDATE event_purchased_items
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     RETURNING id, item_type, item_id`,
    [purchasedItemId, eventId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Purchased item link not found' });
  }

  await logActivity(req, 'events.purchased_item.delete', 'event', eventId, {
    purchasedItemId,
    itemType: deleted.rows[0].item_type,
    itemId: deleted.rows[0].item_id
  });

  res.json({ ok: true, id: purchasedItemId });
}));

router.get('/events/:id/attendees', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT *
       FROM event_attendees
      WHERE event_id = $1
        AND archived_at IS NULL
      ORDER BY display_name ASC, id ASC`,
    [eventId]
  );
  res.json({ items: result.rows });
}));

router.post('/events/:id/attendees', validate(eventAttendeeCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const insert = buildInsertSql({
    table: 'event_attendees',
    eventId,
    fields: EVENT_ATTENDEE_FIELDS,
    body: req.body,
    userId: req.user.id
  });
  const result = await pool.query(insert.sql, insert.values);
  await logActivity(req, 'events.attendee.create', 'event', eventId, { attendeeId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
}));

router.patch('/events/:id/attendees/:attendeeId', validate(eventAttendeeUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const attendeeId = parsePositiveId(req.params.attendeeId, 'attendee id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const update = buildUpdateSql({
    table: 'event_attendees',
    idColumn: 'id',
    id: attendeeId,
    eventId,
    fields: EVENT_ATTENDEE_FIELDS,
    body: req.body
  });
  const result = await pool.query(update.sql, update.values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Attendee not found' });
  await logActivity(req, 'events.attendee.update', 'event', eventId, { attendeeId });
  res.json(result.rows[0]);
}));

router.delete('/events/:id/attendees/:attendeeId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const attendeeId = parsePositiveId(req.params.attendeeId, 'attendee id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_attendees
        SET archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      RETURNING id`,
    [attendeeId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Attendee not found' });
  await logActivity(req, 'events.attendee.delete', 'event', eventId, { attendeeId });
  res.json({ ok: true, id: attendeeId });
}));

router.get('/events/:id/groups', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT *
       FROM event_groups
      WHERE event_id = $1
        AND archived_at IS NULL
      ORDER BY name ASC, id ASC`,
    [eventId]
  );
  res.json({ items: await attachMembersToGroups(result.rows) });
}));

router.post('/events/:id/groups', validate(eventGroupCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const insert = buildInsertSql({
    table: 'event_groups',
    eventId,
    fields: EVENT_GROUP_FIELDS,
    body: req.body,
    userId: req.user.id
  });
  const result = await pool.query(insert.sql, insert.values);
  await replaceEventGroupMembers(eventId, result.rows[0].id, req.body.attendee_ids, req.user.id);
  const [group] = await attachMembersToGroups(result.rows);
  await logActivity(req, 'events.group.create', 'event', eventId, { groupId: group.id });
  res.status(201).json(group);
}));

router.patch('/events/:id/groups/:groupId', validate(eventGroupUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const groupId = parsePositiveId(req.params.groupId, 'group id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  let rows = [];
  const update = buildUpdateSql({
    table: 'event_groups',
    idColumn: 'id',
    id: groupId,
    eventId,
    fields: EVENT_GROUP_FIELDS,
    body: req.body
  });
  if (update) {
    const result = await pool.query(update.sql, update.values);
    rows = result.rows;
  } else {
    const result = await pool.query(
      `SELECT * FROM event_groups WHERE id = $1 AND event_id = $2 AND archived_at IS NULL LIMIT 1`,
      [groupId, eventId]
    );
    rows = result.rows;
  }
  if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'attendee_ids')) {
    await replaceEventGroupMembers(eventId, groupId, req.body.attendee_ids, req.user.id);
  }
  const [group] = await attachMembersToGroups(rows);
  await logActivity(req, 'events.group.update', 'event', eventId, { groupId });
  res.json(group);
}));

router.delete('/events/:id/groups/:groupId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const groupId = parsePositiveId(req.params.groupId, 'group id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_groups
        SET archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      RETURNING id`,
    [groupId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Group not found' });
  await logActivity(req, 'events.group.delete', 'event', eventId, { groupId });
  res.json({ ok: true, id: groupId });
}));

router.get('/events/:id/meetups', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT em.*, eg.name AS group_name
       FROM event_meetups em
       LEFT JOIN event_groups eg ON eg.id = em.group_id AND eg.archived_at IS NULL
      WHERE em.event_id = $1
        AND em.archived_at IS NULL
      ORDER BY em.start_at NULLS LAST, em.title ASC, em.id ASC`,
    [eventId]
  );
  res.json({ items: result.rows });
}));

router.post('/events/:id/meetups', validate(eventMeetupCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });
  if (req.body.group_id && !(await ensureEventSocialGroup(eventId, req.body.group_id))) {
    return res.status(404).json({ error: 'Group not found for this event' });
  }

  const insert = buildInsertSql({
    table: 'event_meetups',
    eventId,
    fields: EVENT_MEETUP_FIELDS,
    body: req.body,
    userId: req.user.id
  });
  const result = await pool.query(insert.sql, insert.values);
  await logActivity(req, 'events.meetup.create', 'event', eventId, { meetupId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
}));

router.patch('/events/:id/meetups/:meetupId', validate(eventMeetupUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const meetupId = parsePositiveId(req.params.meetupId, 'meetup id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });
  if (req.body.group_id && !(await ensureEventSocialGroup(eventId, req.body.group_id))) {
    return res.status(404).json({ error: 'Group not found for this event' });
  }

  const update = buildUpdateSql({
    table: 'event_meetups',
    idColumn: 'id',
    id: meetupId,
    eventId,
    fields: EVENT_MEETUP_FIELDS,
    body: req.body
  });
  const result = await pool.query(update.sql, update.values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Meetup not found' });
  await logActivity(req, 'events.meetup.update', 'event', eventId, { meetupId });
  res.json(result.rows[0]);
}));

router.delete('/events/:id/meetups/:meetupId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const meetupId = parsePositiveId(req.params.meetupId, 'meetup id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_meetups
        SET archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      RETURNING id`,
    [meetupId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Meetup not found' });
  await logActivity(req, 'events.meetup.delete', 'event', eventId, { meetupId });
  res.json({ ok: true, id: meetupId });
}));

router.get('/events/:id/schedule-plans', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT *
       FROM event_schedule_plans
      WHERE event_id = $1
        AND archived_at IS NULL
      ORDER BY start_at NULLS LAST, title ASC, id ASC`,
    [eventId]
  );
  res.json({ items: result.rows });
}));

router.post('/events/:id/schedule-plans', validate(eventSchedulePlanCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const insert = buildInsertSql({
    table: 'event_schedule_plans',
    eventId,
    fields: EVENT_SCHEDULE_PLAN_FIELDS,
    body: req.body,
    userId: req.user.id
  });
  const result = await pool.query(insert.sql, insert.values);
  await logActivity(req, 'events.schedule_plan.create', 'event', eventId, { schedulePlanId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
}));

router.patch('/events/:id/schedule-plans/:planId', validate(eventSchedulePlanUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const planId = parsePositiveId(req.params.planId, 'schedule plan id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const update = buildUpdateSql({
    table: 'event_schedule_plans',
    idColumn: 'id',
    id: planId,
    eventId,
    fields: EVENT_SCHEDULE_PLAN_FIELDS,
    body: req.body
  });
  const result = await pool.query(update.sql, update.values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule plan not found' });
  await logActivity(req, 'events.schedule_plan.update', 'event', eventId, { schedulePlanId: planId });
  res.json(result.rows[0]);
}));

router.delete('/events/:id/schedule-plans/:planId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const planId = parsePositiveId(req.params.planId, 'schedule plan id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_schedule_plans
        SET archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      RETURNING id`,
    [planId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule plan not found' });
  await logActivity(req, 'events.schedule_plan.delete', 'event', eventId, { schedulePlanId: planId });
  res.json({ ok: true, id: planId });
}));

router.get('/events/:id/companion/today', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const payload = await loadCompanionTodayPayload({ eventId, scopeContext, userId: req.user.id });
  if (!payload) return res.status(404).json({ error: 'Event not found' });
  res.json(payload);
}));

router.get('/events/:id/personal-ics-source', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const source = await loadPersonalIcsSource(pool, { eventId, userId: req.user.id });
  res.json({ source: serializeIcsSource(source) });
}));

router.put('/events/:id/personal-ics-source', validate(eventPersonalIcsSourceSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const source = await upsertPersonalIcsSource(pool, {
    eventId,
    userId: req.user.id,
    feedUrl: req.body.feed_url
  });
  await logActivity(req, 'events.personal_ics_source.save', 'event', eventId, {
    sourceId: source?.id || null,
    hasUrl: true
  });
  res.json({ source: serializeIcsSource(source) });
}));

router.delete('/events/:id/personal-ics-source', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const source = await removePersonalIcsSource(pool, { eventId, userId: req.user.id });
  await logActivity(req, 'events.personal_ics_source.delete', 'event', eventId, {
    sourceId: source?.id || null
  });
  res.json({ ok: true, id: source?.id || null });
}));

router.post('/events/:id/personal-ics-source/sync', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const source = await loadPersonalIcsSource(pool, { eventId, userId: req.user.id });
  if (!source) return res.status(404).json({ error: 'Personal ICS source not found' });

  const result = await syncPersonalIcsSource(pool, { source, eventId, userId: req.user.id });
  await logActivity(req, result.error ? 'events.personal_ics_source.sync.failure' : 'events.personal_ics_source.sync.success', 'event', eventId, {
    sourceId: source.id,
    summary: result.summary,
    error: result.error ? 'redacted sync failure detail available on source status' : null
  });
  res.status(result.error ? 502 : 200).json({
    source: serializeIcsSource(result.source),
    summary: result.summary,
    error: result.error || null
  });
}));

router.post('/events/:id/artifacts/:artifactId/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifactCheck = await pool.query(
    `SELECT id, image_path
     FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     LIMIT 1`,
    [eventId, artifactId]
  );
  if (!artifactCheck.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }

  const previousPath = artifactCheck.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE event_artifacts
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, artifactId]
  );

  await logActivity(req, previousPath ? 'events.attachment.replace' : 'events.attachment.upload', 'event', eventId, {
    artifactId,
    previousPath,
    nextPath: updated.rows[0].image_path
  });

  res.json({
    id: updated.rows[0].id,
    image_path: updated.rows[0].image_path,
    provider: stored.provider
  });
}));

router.delete('/events/:id/artifacts/:artifactId/image', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifactCheck = await pool.query(
    `SELECT id, image_path
     FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     LIMIT 1`,
    [eventId, artifactId]
  );
  if (!artifactCheck.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  if (!artifactCheck.rows[0].image_path) {
    return res.json({ ok: true, removed: false });
  }

  await pool.query(
    `UPDATE event_artifacts
     SET image_path = NULL
     WHERE id = $1`,
    [artifactId]
  );
  await logActivity(req, 'events.attachment.delete', 'event', eventId, {
    artifactId,
    previousPath: artifactCheck.rows[0].image_path
  });
  res.json({ ok: true, removed: true });
}));

module.exports = router;
