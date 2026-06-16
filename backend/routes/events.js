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
  eventScheduleChangePreviewSchema,
  eventScheduleNotificationCreateSchema,
  eventScheduleNotificationRecipientUpdateSchema,
  eventScheduleSessionCreateSchema,
  eventScheduleSessionUpdateSchema,
  eventScheduleCatalogIcsImportSchema,
  eventPersonalIcsSourceSchema
} = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const { isFeatureEnabledForSpace } = require('../services/featureFlags');
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
  syncPersonalIcsSource,
  importCatalogIcsSource
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
router.use('/events', asyncHandler(async (req, res, next) => {
  const scopeContext = resolveScopeContext(req);
  const enabled = await isFeatureEnabledForSpace(scopeContext?.spaceId || null, 'events_enabled', false);
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
const EVENT_ATTENDEE_FIELDS = ['user_id', 'display_name', 'contact_label', 'relationship', 'status', 'visibility', 'notes'];
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
const EVENT_SCHEDULE_SESSION_FIELDS = [
  'title',
  'start_at',
  'end_at',
  'location',
  'room',
  'description',
  'track',
  'categories',
  'source_type',
  'source_ref',
  'source_url',
  'source_updated_at',
  'status'
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
const EVENT_COMPANION_NOW_NEXT_VERSION = 'event-companion-now-next.v1';
const EVENT_COMPANION_NOW_NEXT_WINDOW_MINUTES = 120;
const EVENT_COMPANION_NOW_NEXT_LIMIT = 8;
const EVENT_COMPANION_FRIEND_AWARE_CHANGES_VERSION = 'event-companion-friend-aware-session-changes.v1';
const SCHEDULE_CHANGE_NOTIFICATION_CONTRACT_VERSION = 'event-schedule-change-preview.v1';
const SCHEDULE_NOTIFICATION_CONTRACT_VERSION = 'event-schedule-notification.v1';
const SCHEDULE_NOTIFICATION_DELIVERY_BOUNDARY_VERSION = 'event-schedule-notification-delivery-boundary.v1';
const SCHEDULE_NOTIFICATION_PROVIDER_CONTRACT_VERSION = 'event-schedule-notification-provider-prep.v1';
const SCHEDULE_NOTIFICATION_DELIVERY_ATTEMPT_MODEL_VERSION = 'event-schedule-notification-delivery-attempt-model.v1';
const CONFLICTING_SCHEDULE_PLAN_STATUSES = new Set(['planned', 'maybe', 'backup']);

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

function normalizeEventAttendeeBody(body = {}, req = {}) {
  const next = { ...body };
  if (next.link_current_user) {
    next.user_id = req.user?.id || null;
  }
  delete next.link_current_user;
  if (Object.prototype.hasOwnProperty.call(next, 'user_id')) {
    const userId = next.user_id === null || next.user_id === undefined ? null : Number(next.user_id);
    if (userId && userId !== Number(req.user?.id || 0) && req.user?.role !== 'admin') {
      const error = new Error('Only admins can link an attendee to another user');
      error.status = 403;
      throw error;
    }
    next.user_id = userId || null;
  }
  return next;
}

function isDuplicateEventAttendeeUserLinkError(err) {
  return err?.code === '23505' && String(err?.constraint || '').includes('idx_event_attendees_event_user_active');
}

async function findExistingLinkedEventAttendee(eventId, userId) {
  if (!eventId || !userId) return null;
  const result = await pool.query(
    `SELECT ea.id,
            ea.event_id,
            ea.display_name,
            ea.relationship,
            ea.status,
            ea.visibility,
            ea.user_id,
            u.name AS linked_user_name
       FROM event_attendees ea
       LEFT JOIN users u ON u.id = ea.user_id
      WHERE ea.event_id = $1
        AND ea.user_id = $2
        AND ea.archived_at IS NULL
      ORDER BY ea.id ASC
      LIMIT 1`,
    [eventId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    display_name: row.display_name,
    relationship: row.relationship || null,
    status: row.status,
    visibility: row.visibility,
    current_user_attendee: true,
    linked_user: {
      id: row.user_id,
      name: row.linked_user_name || null
    }
  };
}

async function handleDuplicateEventAttendeeUserLink(res, err, eventId, userId) {
  if (!isDuplicateEventAttendeeUserLinkError(err)) throw err;
  const existingAttendee = await findExistingLinkedEventAttendee(eventId, userId);
  const existingName = existingAttendee?.display_name || 'an existing attendee';
  return res.status(409).json({
    error: `You are already listed for this event as ${existingName}. Use that attendee row instead of adding another linked self attendee.`,
    existing_attendee: existingAttendee
  });
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

function buildEventActivityDetails(eventRow, extra = {}) {
  return {
    eventId: eventRow?.id || null,
    eventTitle: eventRow?.title || null,
    eventDateStart: eventRow?.date_start || null,
    eventLocation: eventRow?.location || null,
    ...extra
  };
}

function buildAttendeeActivityDetails(eventRow, attendee = {}) {
  return buildEventActivityDetails(eventRow, {
    attendeeId: attendee.id || null,
    attendeeName: attendee.display_name || null,
    attendeeRole: attendee.relationship || attendee.role || null,
    attendeeStatus: attendee.status || null,
    attendeeVisibility: attendee.visibility || null,
    linkedUserId: attendee.user_id || null
  });
}

function buildGroupActivityDetails(eventRow, group = {}) {
  const members = Array.isArray(group.members) ? group.members : [];
  return buildEventActivityDetails(eventRow, {
    groupId: group.id || null,
    groupName: group.name || null,
    groupStatus: group.status || null,
    groupVisibility: group.visibility || null,
    attendeeCount: members.length
  });
}

function buildMeetupActivityDetails(eventRow, meetup = {}) {
  return buildEventActivityDetails(eventRow, {
    meetupId: meetup.id || null,
    meetupTitle: meetup.title || null,
    groupId: meetup.group_id || null,
    groupName: meetup.group_name || null,
    startAt: meetup.start_at || null,
    endAt: meetup.end_at || null,
    location: meetup.location || null,
    vendor: meetup.vendor || null,
    booth: meetup.booth || null,
    status: meetup.status || null,
    visibility: meetup.visibility || null
  });
}

function buildSchedulePlanActivityDetails(eventRow, plan = {}) {
  return buildEventActivityDetails(eventRow, {
    schedulePlanId: plan.id || null,
    scheduleTitle: plan.title || null,
    startAt: plan.start_at || null,
    endAt: plan.end_at || null,
    location: plan.location || null,
    vendor: plan.vendor || null,
    booth: plan.booth || null,
    sourceType: plan.source_type || null,
    sourceRef: plan.source_ref || null,
    status: plan.status || null,
    visibility: plan.visibility || null
  });
}

function buildScheduleSessionActivityDetails(eventRow, session = {}) {
  return buildEventActivityDetails(eventRow, {
    scheduleSessionId: session.id || null,
    sessionTitle: session.title || null,
    startAt: session.start_at || null,
    endAt: session.end_at || null,
    location: session.location || null,
    room: session.room || null,
    track: session.track || null,
    sourceType: session.source_type || null,
    sourceRef: session.source_ref || null,
    status: session.status || null
  });
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
            ea.user_id,
            u.name AS linked_user_name,
            ea.display_name,
            ea.contact_label,
            ea.relationship,
            ea.status,
            ea.visibility
       FROM event_group_members egm
       JOIN event_attendees ea ON ea.id = egm.attendee_id
       LEFT JOIN users u ON u.id = ea.user_id
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
      user_id: row.user_id || null,
      linked_user: row.user_id ? {
        id: row.user_id,
        name: row.linked_user_name || null
      } : null,
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

function getSchedulePlanCatalogSessionId(plan = {}) {
  if (plan?.source_catalog_session_id) return String(plan.source_catalog_session_id);
  if (plan?.source_type === 'schedule_catalog' && plan?.source_ref) return String(plan.source_ref);
  return '';
}

function getScheduleWindow(item = {}) {
  const startTime = item?.start_at ? new Date(item.start_at).getTime() : NaN;
  if (!Number.isFinite(startTime)) return null;
  const explicitEndTime = item?.end_at ? new Date(item.end_at).getTime() : NaN;
  const endTime = Number.isFinite(explicitEndTime) ? explicitEndTime : startTime + (60 * 60 * 1000);
  if (endTime <= startTime) return null;
  return { startTime, endTime };
}

function scheduleWindowsOverlap(a, b) {
  return Boolean(a && b && a.startTime < b.endTime && b.startTime < a.endTime);
}

function isSchedulePlanConflictEligible(plan = {}) {
  return CONFLICTING_SCHEDULE_PLAN_STATUSES.has(plan?.status || 'planned');
}

async function loadScheduleChangeRecipients(eventId, visibility = 'private') {
  if (visibility === 'private') {
    return { attendees: [], groups: [] };
  }
  const [attendeeResult, groupResult] = await Promise.all([
    pool.query(
      `SELECT ea.id,
              ea.user_id,
              u.name AS linked_user_name,
              ea.display_name,
              ea.contact_label,
              ea.relationship,
              ea.status,
              ea.visibility
         FROM event_attendees ea
         LEFT JOIN users u ON u.id = ea.user_id
        WHERE ea.event_id = $1
          AND ea.archived_at IS NULL
          AND ea.status <> 'not_attending'
        ORDER BY ea.display_name ASC, ea.id ASC`,
      [eventId]
    ),
    pool.query(
      `SELECT *
         FROM event_groups
        WHERE event_id = $1
          AND archived_at IS NULL
          AND status = 'active'
        ORDER BY name ASC, id ASC`,
      [eventId]
    )
  ]);
  const groups = await attachMembersToGroups(groupResult.rows || []);
  const attendees = attendeeResult.rows || [];
  if (visibility === 'selected_people') {
    return { attendees, groups: [] };
  }
  if (visibility === 'group') {
    const memberIds = new Set();
    groups.forEach((group) => (group.members || []).forEach((member) => memberIds.add(Number(member.id))));
    return {
      attendees: attendees.filter((attendee) => memberIds.has(Number(attendee.id))),
      groups
    };
  }
  return { attendees, groups };
}

function normalizeScheduleMessageIntent(intent, status = '') {
  const normalized = String(intent || '').trim().toLowerCase();
  if (['join', 'leave', 'replace', 'backup', 'meet', 'status_update'].includes(normalized)) return normalized;
  if (status === 'skipped') return 'leave';
  if (status === 'backup') return 'backup';
  if (status === 'planned') return 'join';
  return 'status_update';
}

function buildScheduleMessageTemplate(subject = {}, status = 'planned', intent = 'status_update') {
  const title = String(subject?.title || 'Schedule update').trim() || 'Schedule update';
  const messageIntent = normalizeScheduleMessageIntent(intent, status);
  const statusLabel = String(status || 'planned').replace(/_/g, ' ');
  if (messageIntent === 'join') {
    return {
      intent: messageIntent,
      title,
      body: `Anyone want to join me for ${title}?`
    };
  }
  if (messageIntent === 'leave') {
    return {
      intent: messageIntent,
      title,
      body: `I'm dropping ${title}.`
    };
  }
  if (messageIntent === 'replace') {
    return {
      intent: messageIntent,
      title,
      body: `I'm switching to ${title}.`
    };
  }
  if (messageIntent === 'backup') {
    return {
      intent: messageIntent,
      title,
      body: `I'm keeping ${title} as backup.`
    };
  }
  if (messageIntent === 'meet') {
    return {
      intent: messageIntent,
      title,
      body: `Meet outside this room for ${title}?`
    };
  }
  return {
    intent: messageIntent,
    title,
    body: `${title} is marked ${statusLabel}.`
  };
}

async function buildScheduleChangePreview({ eventId, schedulePlanId = null, catalogSessionId = null, requestedStatus = null, requestedVisibility = null, messageIntent = null }) {
  let plan = null;
  let session = null;
  if (schedulePlanId) {
    const planResult = await pool.query(
      `SELECT *
         FROM event_schedule_plans
        WHERE id = $1
          AND event_id = $2
          AND archived_at IS NULL
        LIMIT 1`,
      [schedulePlanId, eventId]
    );
    plan = planResult.rows[0] || null;
    if (!plan) return null;
    const catalogId = Number(getSchedulePlanCatalogSessionId(plan) || 0);
    if (catalogId) catalogSessionId = catalogSessionId || catalogId;
  }
  if (catalogSessionId) {
    const sessionResult = await pool.query(
      `SELECT *
         FROM event_schedule_sessions
        WHERE id = $1
          AND event_id = $2
          AND archived_at IS NULL
        LIMIT 1`,
      [catalogSessionId, eventId]
    );
    session = sessionResult.rows[0] || null;
    if (!session) return null;
    if (!plan) {
      const linkedPlanResult = await pool.query(
        `SELECT *
           FROM event_schedule_plans
          WHERE event_id = $1
            AND archived_at IS NULL
            AND (
              source_catalog_session_id = $2
              OR (source_type = 'schedule_catalog' AND source_ref = $3)
            )
          ORDER BY CASE WHEN visibility = 'private' THEN 0 ELSE 1 END, id ASC
          LIMIT 1`,
        [eventId, session.id, String(session.id)]
      );
      plan = linkedPlanResult.rows[0] || null;
    }
  }

  const subject = plan || session;
  if (!subject) return null;
  const normalizedStatus = requestedStatus || plan?.status || (session?.status === 'cancelled' ? 'skipped' : 'planned');
  const normalizedVisibility = requestedVisibility || plan?.visibility || 'private';
  const messageTemplate = buildScheduleMessageTemplate(subject, normalizedStatus, messageIntent);
  const recipients = await loadScheduleChangeRecipients(eventId, normalizedVisibility);
  const candidateWindow = getScheduleWindow({
    start_at: plan?.start_at || session?.start_at,
    end_at: plan?.end_at || session?.end_at
  });
  let conflicts = [];
  if (candidateWindow && isSchedulePlanConflictEligible({ status: normalizedStatus })) {
    const plansResult = await pool.query(
      `SELECT id, title, start_at, end_at, location, status, visibility, source_type, source_ref, source_catalog_session_id
         FROM event_schedule_plans
        WHERE event_id = $1
          AND archived_at IS NULL
        ORDER BY start_at NULLS LAST, title ASC, id ASC`,
      [eventId]
    );
    const subjectCatalogId = getSchedulePlanCatalogSessionId(plan) || (session?.id ? String(session.id) : '');
    conflicts = (plansResult.rows || [])
      .filter((otherPlan) => !plan?.id || Number(otherPlan.id) !== Number(plan.id))
      .filter(isSchedulePlanConflictEligible)
      .filter((otherPlan) => {
        const otherCatalogId = getSchedulePlanCatalogSessionId(otherPlan);
        return !(subjectCatalogId && otherCatalogId && subjectCatalogId === otherCatalogId);
      })
      .filter((otherPlan) => scheduleWindowsOverlap(candidateWindow, getScheduleWindow(otherPlan)))
      .slice(0, 10);
  }
  const attendeeCount = recipients.attendees.length;
  const groupCount = recipients.groups.length;
  return {
    contract: {
      version: SCHEDULE_CHANGE_NOTIFICATION_CONTRACT_VERSION,
      preview_only: true,
      delivery_supported: false,
      delivery_endpoint: null,
      limitations: [
        'no_push_delivery',
        'no_device_registration',
        'no_message_persistence',
        'no_broadcast_without_user_selection'
      ]
    },
    event_id: eventId,
    subject: {
      kind: plan ? 'schedule_plan' : 'schedule_catalog',
      schedule_plan_id: plan?.id || null,
      catalog_session_id: session?.id || Number(getSchedulePlanCatalogSessionId(plan) || 0) || null,
      title: subject.title,
      start_at: plan?.start_at || session?.start_at || null,
      end_at: plan?.end_at || session?.end_at || null,
      location: plan?.location || session?.location || session?.room || null
    },
    requested_change: {
      status: normalizedStatus,
      visibility: normalizedVisibility
    },
    recipients: {
      attendees: recipients.attendees.map((attendee) => ({
        id: attendee.id,
        user_id: attendee.user_id || null,
        linked_user: attendee.user_id ? {
          id: attendee.user_id,
          name: attendee.linked_user_name || null
        } : null,
        display_name: attendee.display_name,
        contact_label: attendee.contact_label || null,
        relationship: attendee.relationship || null,
        status: attendee.status,
        visibility: attendee.visibility
      })),
      groups: recipients.groups.map((group) => ({
        id: group.id,
        name: group.name,
        visibility: group.visibility,
        status: group.status,
        member_count: Array.isArray(group.members) ? group.members.length : 0
      })),
      summary: {
        attendee_count: attendeeCount,
        group_count: groupCount,
        visibility: normalizedVisibility,
        selected_recipient_required: normalizedVisibility !== 'private',
        label: normalizedVisibility === 'private'
          ? 'Private change; no recipients.'
          : `${attendeeCount} ${attendeeCount === 1 ? 'person' : 'people'}${groupCount ? `, ${groupCount} ${groupCount === 1 ? 'group' : 'groups'}` : ''}`
      }
    },
    conflicts: conflicts.map((conflict) => ({
      id: conflict.id,
      title: conflict.title,
      start_at: conflict.start_at || null,
      end_at: conflict.end_at || null,
      location: conflict.location || null,
      status: conflict.status,
      visibility: conflict.visibility
    })),
    message_template: messageTemplate
  };
}

function uniquePositiveIds(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0)));
}

function buildScheduleNotificationContract() {
  return {
    version: SCHEDULE_NOTIFICATION_CONTRACT_VERSION,
    local_record_supported: true,
    external_delivery_supported: false,
    delivery_channel: 'event_local',
    delivery_endpoint: null,
    limitations: [
      'no_push_delivery',
      'no_device_registration',
      'no_email_delivery',
      'no_realtime_presence',
      'no_broadcast_without_user_selection'
    ]
  };
}

function buildScheduleNotificationDeliveryBoundary(eventId) {
  const deliveryProviders = [
    {
      provider: 'event_local',
      channel: 'event_local',
      enabled: true,
      configured: true,
      creates_delivery_attempts: true,
      requires_device_registration: false,
      mode: 'local_record',
      description: 'Stores schedule notification records, Event-local recipient readback rows, and local delivery-attempt audit rows.'
    },
    {
      provider: 'push',
      channel: 'push',
      enabled: false,
      configured: false,
      creates_delivery_attempts: false,
      requires_device_registration: true,
      mode: 'disabled',
      reason: 'No push provider, device registration, or delivery attempt queue is configured.'
    },
    {
      provider: 'email',
      channel: 'email',
      enabled: false,
      configured: false,
      creates_delivery_attempts: false,
      requires_device_registration: false,
      mode: 'disabled',
      reason: 'No schedule notification email provider or template delivery pipeline is configured.'
    },
    {
      provider: 'platform_device',
      channel: 'device',
      enabled: false,
      configured: false,
      creates_delivery_attempts: false,
      requires_device_registration: true,
      mode: 'disabled',
      reason: 'No native platform device identity or token registration contract exists yet.'
    }
  ];
  return {
    contract: {
      version: SCHEDULE_NOTIFICATION_DELIVERY_BOUNDARY_VERSION,
      event_id: Number(eventId),
      scope: 'event_local',
      external_delivery_supported: false,
      delivery_provider: null,
      delivery_endpoint: null,
      device_registration_supported: false,
      global_inbox_supported: false,
      realtime_supported: false
    },
    provider_contract: {
      version: SCHEDULE_NOTIFICATION_PROVIDER_CONTRACT_VERSION,
      active_provider: 'event_local',
      provider_selection: 'fixed_event_local',
      external_provider_configured: false,
      external_delivery_attempts_created: false,
      delivery_attempt_record_supported: true,
      delivery_attempt_endpoint: `/api/events/${eventId}/schedule-notification-delivery-attempts`,
      device_registration_endpoint: null
    },
    delivery_providers: deliveryProviders,
    delivery_attempt_model: {
      version: SCHEDULE_NOTIFICATION_DELIVERY_ATTEMPT_MODEL_VERSION,
      supported: true,
      creates_records: true,
      relationship: 'one_attempt_per_notification_recipient_provider',
      owner: 'backend_provider_delivery_pipeline',
      endpoint: `/api/events/${eventId}/schedule-notification-delivery-attempts`,
      status_values: ['queued', 'sending', 'succeeded', 'failed', 'skipped', 'cancelled'],
      field_contract: {
        id: 'integer',
        event_id: 'integer',
        notification_id: 'integer',
        recipient_id: 'integer',
        provider: 'event_local | push | email | platform_device',
        channel: 'event_local | push | email | device',
        status: 'queued | sending | succeeded | failed | skipped | cancelled',
        attempted_at: 'date-time | null',
        completed_at: 'date-time | null',
        retry_after: 'date-time | null',
        provider_message_id: 'string | null',
        error_code: 'string | null',
        error_message: 'string | null'
      },
      notes: [
        'Event-local sends create one audit attempt for each selected recipient row.',
        'Push, email, and platform-device delivery attempts are still not created while those providers are disabled.',
        'Provider message ids and error fields must be treated as provider metadata, not user-authored message content.'
      ]
    },
    supported_channels: [
      {
        channel: 'event_local',
        supported: true,
        records_notifications: true,
        creates_recipient_readback: true,
        creates_delivery_attempts: true,
        delivers_outside_app: false,
        description: 'Creates Event-local notification records, recipient readback rows, and local delivery-attempt audit rows only.'
      }
    ],
    unsupported_channels: [
      { channel: 'push', supported: false, reason: 'No native device registration or push provider is configured.' },
      { channel: 'email', supported: false, reason: 'Schedule notifications do not use SMTP or email delivery.' },
      { channel: 'device', supported: false, reason: 'No platform device identity or delivery token contract exists yet.' },
      { channel: 'global_inbox', supported: false, reason: 'Notification readback is scoped to the Event drawer and Event APIs.' },
      { channel: 'realtime', supported: false, reason: 'No websocket, presence, or realtime fanout is part of this contract.' },
      { channel: 'broadcast', supported: false, reason: 'Recipients must be selected from Event-local eligible people or groups.' }
    ],
    capabilities: {
      preview_recipients: true,
      draft_records: true,
      update_drafts: true,
      send_local_records: true,
      discard_drafts: true,
      recipient_readback: true,
      current_user_inbox_filter: true,
      read_acknowledgement: true,
      local_delivery_attempt_records: true,
      external_delivery: false,
      external_provider_config: false,
      delivery_attempt_readback: true
    },
    endpoints: {
      preview: `/api/events/${eventId}/schedule-change-preview`,
      records: `/api/events/${eventId}/schedule-notifications`,
      delivery_attempts: `/api/events/${eventId}/schedule-notification-delivery-attempts`,
      inbox: `/api/events/${eventId}/schedule-notification-inbox`,
      current_user_inbox: `/api/events/${eventId}/schedule-notification-inbox?recipient=me`
    },
    platform_guidance: [
      'Treat sent schedule notifications as local coordination records, not proof of push/email/device delivery.',
      'Use selected recipient ids from the preview/recipient picker; do not broadcast by default.',
      'Use delivery_providers to hide unavailable push/email/device affordances in platform clients.',
      'Use delivery-attempt readback as Event-local audit evidence only; it is not proof of external delivery.',
      'Native clients may cache this boundary and should refetch before offering any future delivery channel.',
      'Future push, email, device, or global inbox behavior requires a new contract version.'
    ]
  };
}

function selectScheduleNotificationRecipients(preview = {}, body = {}) {
  const eligible = preview.recipients || {};
  const eligibleAttendees = Array.isArray(eligible.attendees) ? eligible.attendees : [];
  const eligibleGroups = Array.isArray(eligible.groups) ? eligible.groups : [];
  const hasAttendeeSelection = Array.isArray(body.recipient_attendee_ids);
  const hasGroupSelection = Array.isArray(body.recipient_group_ids);
  const requestedAttendeeIds = uniquePositiveIds(body.recipient_attendee_ids);
  const requestedGroupIds = uniquePositiveIds(body.recipient_group_ids);
  const attendeeMap = new Map(eligibleAttendees.map((attendee) => [Number(attendee.id), attendee]));
  const groupMap = new Map(eligibleGroups.map((group) => [Number(group.id), group]));
  const invalidAttendeeIds = requestedAttendeeIds.filter((id) => !attendeeMap.has(id));
  const invalidGroupIds = requestedGroupIds.filter((id) => !groupMap.has(id));
  if (invalidAttendeeIds.length || invalidGroupIds.length) {
    const error = new Error('Selected recipients are not available for this event schedule visibility');
    error.status = 400;
    error.details = { invalid_attendee_ids: invalidAttendeeIds, invalid_group_ids: invalidGroupIds };
    throw error;
  }
  const attendees = hasAttendeeSelection
    ? requestedAttendeeIds.map((id) => attendeeMap.get(id)).filter(Boolean)
    : (hasGroupSelection ? [] : eligibleAttendees);
  const groups = hasGroupSelection
    ? requestedGroupIds.map((id) => groupMap.get(id)).filter(Boolean)
    : (hasAttendeeSelection ? [] : eligibleGroups);
  const summary = {
    attendee_count: attendees.length,
    group_count: groups.length,
    visibility: eligible.summary?.visibility || preview.requested_change?.visibility || 'private',
    selected_recipient_required: true,
    label: attendees.length || groups.length
      ? `${attendees.length} ${attendees.length === 1 ? 'person' : 'people'}${groups.length ? `, ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}` : ''}`
      : 'No recipients selected.'
  };
  return { attendees, groups, summary };
}

function serializeScheduleNotification(row = {}) {
  if (!row?.id) return null;
  const readback = row.recipient_summary || null;
  const deliveryAttemptReadback = row.delivery_attempt_summary || null;
  return {
    id: row.id,
    event_id: row.event_id,
    schedule_plan_id: row.schedule_plan_id || null,
    catalog_session_id: row.catalog_session_id || null,
    status: row.status,
    requested_status: row.requested_status,
    requested_visibility: row.requested_visibility,
    message_title: row.message_title,
    message_body: row.message_body,
    subject: row.subject_snapshot || {},
    recipients: row.recipients_snapshot || {},
    conflicts: row.conflicts_snapshot || [],
    contract: row.contract_snapshot || buildScheduleNotificationContract(),
    delivery_channel: row.delivery_channel || 'event_local',
    delivery_supported: Boolean(row.delivery_supported),
    recipient_readback: readback || {
      total: Number(row.recipient_count || 0),
      unread: Number(row.unread_count || 0),
      read: Number(row.read_count || 0),
      acknowledged: Number(row.acknowledged_count || 0)
    },
    delivery_attempt_readback: deliveryAttemptReadback || {
      total: Number(row.delivery_attempt_count || 0),
      queued: Number(row.delivery_attempt_queued_count || 0),
      sending: Number(row.delivery_attempt_sending_count || 0),
      succeeded: Number(row.delivery_attempt_succeeded_count || 0),
      failed: Number(row.delivery_attempt_failed_count || 0),
      skipped: Number(row.delivery_attempt_skipped_count || 0),
      cancelled: Number(row.delivery_attempt_cancelled_count || 0),
      latest_completed_at: row.delivery_attempt_latest_completed_at || null
    },
    created_by: row.created_by || null,
    sent_at: row.sent_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildScheduleNotificationDeliveryAttemptSummary(rows = []) {
  return rows.reduce((acc, row) => {
    acc.total += 1;
    const status = String(row?.status || '').trim();
    if (Object.prototype.hasOwnProperty.call(acc, status)) {
      acc[status] += 1;
    }
    const completedAt = row?.completed_at || null;
    if (completedAt && (!acc.latest_completed_at || new Date(completedAt).getTime() > new Date(acc.latest_completed_at).getTime())) {
      acc.latest_completed_at = completedAt;
    }
    return acc;
  }, {
    total: 0,
    queued: 0,
    sending: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    latest_completed_at: null
  });
}

async function insertScheduleNotificationRecipients(client, { notificationId, eventId, recipients }) {
  const attendees = Array.isArray(recipients?.attendees) ? recipients.attendees : [];
  const groups = Array.isArray(recipients?.groups) ? recipients.groups : [];
  for (const attendee of attendees) {
    const attendeeId = Number(attendee?.id || 0);
    if (!Number.isFinite(attendeeId) || attendeeId <= 0) continue;
    await client.query(
      `INSERT INTO event_schedule_notification_recipients (
         notification_id, event_id, recipient_type, attendee_id, recipient_snapshot
       ) VALUES ($1, $2, 'attendee', $3, $4::jsonb)
       ON CONFLICT (notification_id, attendee_id) WHERE recipient_type = 'attendee' AND attendee_id IS NOT NULL
       DO UPDATE SET
         recipient_snapshot = EXCLUDED.recipient_snapshot,
         read_status = 'unread',
         read_at = NULL,
         acknowledged_at = NULL,
         archived_at = NULL`,
      [notificationId, eventId, attendeeId, JSON.stringify(attendee)]
    );
  }
  for (const group of groups) {
    const groupId = Number(group?.id || 0);
    if (!Number.isFinite(groupId) || groupId <= 0) continue;
    await client.query(
      `INSERT INTO event_schedule_notification_recipients (
         notification_id, event_id, recipient_type, group_id, recipient_snapshot
       ) VALUES ($1, $2, 'group', $3, $4::jsonb)
       ON CONFLICT (notification_id, group_id) WHERE recipient_type = 'group' AND group_id IS NOT NULL
       DO UPDATE SET
         recipient_snapshot = EXCLUDED.recipient_snapshot,
         read_status = 'unread',
         read_at = NULL,
         acknowledged_at = NULL,
         archived_at = NULL`,
      [notificationId, eventId, groupId, JSON.stringify(group)]
    );
  }
}

async function insertEventLocalDeliveryAttempts(client, { notificationId, eventId }) {
  const result = await client.query(
    `INSERT INTO event_schedule_notification_delivery_attempts (
       notification_id,
       event_id,
       recipient_id,
       provider,
       channel,
       status,
       attempted_at,
       completed_at,
       metadata
     )
     SELECT
       r.notification_id,
       r.event_id,
       r.id,
       'event_local',
       'event_local',
       'succeeded',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP,
       jsonb_build_object('source', 'event_local_send')
       FROM event_schedule_notification_recipients r
      WHERE r.notification_id = $1
        AND r.event_id = $2
        AND r.archived_at IS NULL
      ON CONFLICT (notification_id, recipient_id, provider) WHERE archived_at IS NULL
      DO UPDATE SET
        status = 'succeeded',
        attempted_at = COALESCE(event_schedule_notification_delivery_attempts.attempted_at, EXCLUDED.attempted_at),
        completed_at = EXCLUDED.completed_at,
        metadata = event_schedule_notification_delivery_attempts.metadata || EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
    [notificationId, eventId]
  );
  return buildScheduleNotificationDeliveryAttemptSummary(result.rows);
}

function serializeScheduleNotificationDeliveryAttempt(row = {}) {
  if (!row?.id) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    notification_id: row.notification_id,
    recipient_id: row.recipient_id,
    provider: row.provider,
    channel: row.channel,
    status: row.status,
    attempted_at: row.attempted_at || null,
    completed_at: row.completed_at || null,
    retry_after: row.retry_after || null,
    provider_message_id: row.provider_message_id || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    metadata: row.metadata || {},
    recipient: row.recipient_id ? {
      id: row.recipient_id,
      recipient_type: row.recipient_type || null,
      attendee_id: row.attendee_id || null,
      group_id: row.group_id || null,
      recipient: row.recipient_snapshot || {}
    } : null,
    notification: row.notification_id ? {
      id: row.notification_id,
      status: row.notification_status || null,
      message_title: row.message_title || null,
      sent_at: row.sent_at || null
    } : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function serializeScheduleNotificationRecipient(row = {}) {
  if (!row?.id) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    notification_id: row.notification_id,
    recipient_type: row.recipient_type,
    attendee_id: row.attendee_id || null,
    group_id: row.group_id || null,
    recipient: row.recipient_snapshot || {},
    linked_user_id: row.linked_user_id || null,
    linked_user: row.linked_user_id ? {
      id: row.linked_user_id,
      name: row.linked_user_name || null
    } : null,
    current_user_recipient: Boolean(row.current_user_recipient),
    read_status: row.read_status || 'unread',
    read_at: row.read_at || null,
    acknowledged_at: row.acknowledged_at || null,
    notification: {
      id: row.notification_id,
      status: row.notification_status,
      requested_status: row.requested_status,
      requested_visibility: row.requested_visibility,
      message_title: row.message_title,
      message_body: row.message_body,
      subject: row.subject_snapshot || {},
      conflicts: row.conflicts_snapshot || [],
      delivery_channel: row.delivery_channel || 'event_local',
      delivery_supported: Boolean(row.delivery_supported),
      sent_at: row.sent_at || null,
      created_at: row.notification_created_at || null
    },
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function createScheduleNotification({ eventId, preview, body = {}, userId = null }) {
  const status = body.status || 'draft';
  const requestedVisibility = preview.requested_change?.visibility || 'private';
  const recipients = selectScheduleNotificationRecipients(preview, body);
  if (status === 'sent' && requestedVisibility === 'private') {
    const error = new Error('Private schedule changes cannot be sent to recipients');
    error.status = 400;
    throw error;
  }
  if (status === 'sent' && recipients.summary.attendee_count + recipients.summary.group_count === 0) {
    const error = new Error('At least one selected recipient is required to send a schedule notification');
    error.status = 400;
    throw error;
  }
  const contract = buildScheduleNotificationContract();
  const messageTitle = String(body.message_title || preview.message_template?.title || preview.subject?.title || 'Schedule update').trim().slice(0, 255);
  const messageBody = String(body.message_body || preview.message_template?.body || 'Schedule update').trim().slice(0, 5000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO event_schedule_notifications (
         event_id,
         schedule_plan_id,
         catalog_session_id,
         status,
         requested_status,
         requested_visibility,
         message_title,
         message_body,
         subject_snapshot,
         recipients_snapshot,
         conflicts_snapshot,
         contract_snapshot,
         delivery_channel,
         delivery_supported,
         created_by,
         sent_at
       ) VALUES (
         $1, $2, $3, $4::varchar, $5, $6, $7, $8,
         $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
         'event_local', FALSE, $13,
         CASE WHEN $4::text = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END
       )
       RETURNING *`,
      [
        eventId,
        preview.subject?.schedule_plan_id || null,
        preview.subject?.catalog_session_id || null,
        status,
        preview.requested_change.status,
        requestedVisibility,
        messageTitle,
        messageBody,
        JSON.stringify(preview.subject || {}),
        JSON.stringify(recipients),
        JSON.stringify(preview.conflicts || []),
        JSON.stringify(contract),
        userId
      ]
    );
    const row = result.rows[0];
    await insertScheduleNotificationRecipients(client, {
      notificationId: row.id,
      eventId,
      recipients
    });
    const deliveryAttemptSummary = status === 'sent'
      ? await insertEventLocalDeliveryAttempts(client, { notificationId: row.id, eventId })
      : buildScheduleNotificationDeliveryAttemptSummary([]);
    await client.query('COMMIT');
    return serializeScheduleNotification({
      ...row,
      recipient_count: recipients.summary.attendee_count + recipients.summary.group_count,
      unread_count: recipients.summary.attendee_count + recipients.summary.group_count,
      read_count: 0,
      acknowledged_count: 0,
      delivery_attempt_summary: deliveryAttemptSummary
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function updateScheduleNotificationDraft({ eventId, notificationId, preview, body = {}, userId = null }) {
  const existingResult = await pool.query(
    `SELECT *
       FROM event_schedule_notifications
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL`,
    [notificationId, eventId]
  );
  const existing = existingResult.rows[0];
  if (!existing) {
    const error = new Error('Schedule notification not found');
    error.status = 404;
    throw error;
  }
  if (existing.status !== 'draft') {
    const error = new Error('Only draft schedule notifications can be edited or sent');
    error.status = 409;
    throw error;
  }
  const status = body.status || 'draft';
  const requestedVisibility = preview.requested_change?.visibility || 'private';
  const recipients = selectScheduleNotificationRecipients(preview, body);
  if (status === 'sent' && requestedVisibility === 'private') {
    const error = new Error('Private schedule changes cannot be sent to recipients');
    error.status = 400;
    throw error;
  }
  if (status === 'sent' && recipients.summary.attendee_count + recipients.summary.group_count === 0) {
    const error = new Error('At least one selected recipient is required to send a schedule notification');
    error.status = 400;
    throw error;
  }
  const contract = buildScheduleNotificationContract();
  const messageTitle = String(body.message_title || preview.message_template?.title || preview.subject?.title || 'Schedule update').trim().slice(0, 255);
  const messageBody = String(body.message_body || preview.message_template?.body || 'Schedule update').trim().slice(0, 5000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE event_schedule_notification_delivery_attempts
          SET archived_at = CURRENT_TIMESTAMP
        WHERE notification_id = $1
          AND event_id = $2
          AND archived_at IS NULL`,
      [notificationId, eventId]
    );
    await client.query(
      `UPDATE event_schedule_notification_recipients
          SET archived_at = CURRENT_TIMESTAMP
        WHERE notification_id = $1
          AND event_id = $2
          AND archived_at IS NULL`,
      [notificationId, eventId]
    );
    const result = await client.query(
      `UPDATE event_schedule_notifications
          SET status = $1::varchar,
              requested_status = $2,
              requested_visibility = $3,
              message_title = $4,
              message_body = $5,
              subject_snapshot = $6::jsonb,
              recipients_snapshot = $7::jsonb,
              conflicts_snapshot = $8::jsonb,
              contract_snapshot = $9::jsonb,
              delivery_channel = 'event_local',
              delivery_supported = FALSE,
              created_by = COALESCE(created_by, $10),
              sent_at = CASE WHEN $1::text = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = $11
          AND event_id = $12
          AND status = 'draft'
          AND archived_at IS NULL
        RETURNING *`,
      [
        status,
        preview.requested_change.status,
        requestedVisibility,
        messageTitle,
        messageBody,
        JSON.stringify(preview.subject || {}),
        JSON.stringify(recipients),
        JSON.stringify(preview.conflicts || []),
        JSON.stringify(contract),
        userId,
        notificationId,
        eventId
      ]
    );
    const row = result.rows[0];
    await insertScheduleNotificationRecipients(client, {
      notificationId,
      eventId,
      recipients
    });
    const deliveryAttemptSummary = status === 'sent'
      ? await insertEventLocalDeliveryAttempts(client, { notificationId, eventId })
      : buildScheduleNotificationDeliveryAttemptSummary([]);
    await client.query('COMMIT');
    return serializeScheduleNotification({
      ...row,
      recipient_count: recipients.summary.attendee_count + recipients.summary.group_count,
      unread_count: status === 'sent' ? recipients.summary.attendee_count + recipients.summary.group_count : 0,
      read_count: 0,
      acknowledged_count: 0,
      delivery_attempt_summary: deliveryAttemptSummary
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

function buildOfflineKeyLocations({ event = {}, meetups = [], plans = [], sessions = [] }) {
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
  for (const session of sessions || []) {
    addOfflineLocation(locations, seen, {
      kind: 'schedule_catalog',
      name: session.location || session.room,
      notes: session.room && session.location && session.room !== session.location ? `Room: ${session.room}` : null,
      source_type: 'schedule_catalog',
      source_id: session.id || null,
      starts_at: session.start_at || null
    });
  }
  return locations.slice(0, 100);
}

function buildOfflinePacket({ event = {}, attendees = [], groups = [], meetups = [], plans = [], sessions = [], generatedAt = new Date(), icsFreshness = 'not_connected' }) {
  const generatedIso = generatedAt.toISOString();
  const staleAfterAt = new Date(generatedAt.getTime() + EVENT_COMPANION_CACHE_POLICY.stale_after_seconds * 1000).toISOString();
  const keyLocations = buildOfflineKeyLocations({ event, meetups, plans, sessions });
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
      schedule_catalog: true,
      key_locations: true,
      personal_ics_sync_visibility: true
    },
    counts: {
      attendees: attendees.length,
      groups: groups.length,
      meetups: meetups.length,
      planned_sessions: plans.length,
      schedule_catalog_sessions: sessions.length,
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
      'offline_mutation_queue_not_supported',
      'push_notifications_not_supported',
      'realtime_location_not_supported',
      'presence_tracking_not_supported'
    ],
    schedule_catalog: sessions,
    planned_sessions: plans,
    key_locations: keyLocations
  };
}

function normalizeCompanionLocation(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getScheduleCatalogPlanMap(plans = []) {
  const byCatalogId = new Map();
  for (const plan of plans || []) {
    const catalogId = getSchedulePlanCatalogSessionId(plan);
    if (!catalogId || byCatalogId.has(catalogId)) continue;
    byCatalogId.set(catalogId, plan);
  }
  return byCatalogId;
}

function getCompanionMinutesUntil(startTime, nowTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(nowTime)) return null;
  return Math.max(0, Math.round((startTime - nowTime) / 60000));
}

function getCompanionScheduleRelation(session = {}, linkedPlan = null) {
  if (linkedPlan?.id) {
    const planSource = linkedPlan.source_type === 'sched_ics' ? 'personal_sched_ics' : 'personal_plan';
    return {
      source: planSource,
      catalog_session_id: session.id || null,
      schedule_plan_id: linkedPlan.id,
      personal_status: linkedPlan.status || null,
      personal_visibility: linkedPlan.visibility || null,
      is_personal: true,
      is_catalog_only: false
    };
  }
  return {
    source: 'catalog_only',
    catalog_session_id: session.id || null,
    schedule_plan_id: null,
    personal_status: null,
    personal_visibility: null,
    is_personal: false,
    is_catalog_only: true
  };
}

function getCompanionQuickActions(eventId, session = {}, linkedPlan = null) {
  const statuses = ['planned', 'maybe', 'skipped', 'backup'];
  return {
    supported_statuses: statuses,
    write_mode: linkedPlan?.id ? 'patch_schedule_plan' : 'create_schedule_plan',
    endpoint: linkedPlan?.id
      ? `/api/events/${eventId}/schedule-plans/${linkedPlan.id}`
      : `/api/events/${eventId}/schedule-plans`,
    catalog_session_id: session.id || null,
    schedule_plan_id: linkedPlan?.id || null,
    requires_refetch_after_write: true
  };
}

function buildCompanionScheduleItem({ eventId, session = {}, linkedPlan = null, context = 'upcoming', now = new Date(), conflicts = [] }) {
  const window = getScheduleWindow(session);
  const nowTime = now.getTime();
  return {
    kind: 'catalog_session',
    context,
    catalog_session_id: session.id || null,
    schedule_plan_id: linkedPlan?.id || null,
    title: session.title || linkedPlan?.title || null,
    start_at: session.start_at || linkedPlan?.start_at || null,
    end_at: session.end_at || linkedPlan?.end_at || null,
    location: session.location || linkedPlan?.location || session.room || null,
    room: session.room || null,
    track: session.track || null,
    categories: Array.isArray(session.categories) ? session.categories : [],
    status: session.status || null,
    relation: getCompanionScheduleRelation(session, linkedPlan),
    quick_actions: getCompanionQuickActions(eventId, session, linkedPlan),
    conflicts,
    time_context: {
      is_now: context === 'current',
      is_next: context === 'next',
      minutes_until_start: window ? getCompanionMinutesUntil(window.startTime, nowTime) : null,
      minutes_until_end: window ? Math.max(0, Math.round((window.endTime - nowTime) / 60000)) : null
    }
  };
}

function getCompanionPlanConflictsForSession(session = {}, plans = [], linkedPlan = null) {
  const sessionWindow = getScheduleWindow(session);
  if (!sessionWindow) return [];
  const sessionCatalogId = session?.id ? String(session.id) : '';
  return (plans || [])
    .filter(isSchedulePlanConflictEligible)
    .filter((plan) => !linkedPlan?.id || Number(plan.id) !== Number(linkedPlan.id))
    .filter((plan) => {
      const planCatalogId = getSchedulePlanCatalogSessionId(plan);
      return !(sessionCatalogId && planCatalogId && sessionCatalogId === planCatalogId);
    })
    .filter((plan) => scheduleWindowsOverlap(sessionWindow, getScheduleWindow(plan)))
    .slice(0, 5)
    .map((plan) => ({
      schedule_plan_id: plan.id,
      title: plan.title,
      start_at: plan.start_at || null,
      end_at: plan.end_at || null,
      location: plan.location || null,
      status: plan.status || null,
      visibility: plan.visibility || null
    }));
}

function buildCompanionNowNext({ eventId, sessions = [], plans = [], generatedAt = new Date() }) {
  const now = generatedAt;
  const nowTime = now.getTime();
  const soonUntil = nowTime + EVENT_COMPANION_NOW_NEXT_WINDOW_MINUTES * 60000;
  const planByCatalogId = getScheduleCatalogPlanMap(plans);
  const activeSessions = (sessions || [])
    .filter((session) => session.status === 'active')
    .map((session) => ({ session, window: getScheduleWindow(session) }))
    .filter((entry) => entry.window)
    .sort((a, b) => a.window.startTime - b.window.startTime || Number(a.session.id || 0) - Number(b.session.id || 0));

  const currentEntries = activeSessions.filter((entry) => entry.window.startTime <= nowTime && nowTime < entry.window.endTime);
  const upcomingEntries = activeSessions.filter((entry) => entry.window.startTime > nowTime);
  const nextEntries = upcomingEntries.slice(0, EVENT_COMPANION_NOW_NEXT_LIMIT);
  const soonEntries = upcomingEntries
    .filter((entry) => entry.window.startTime <= soonUntil)
    .slice(0, EVENT_COMPANION_NOW_NEXT_LIMIT);

  const anchorLocationKeys = new Set();
  for (const entry of [...currentEntries, ...nextEntries.slice(0, 1)]) {
    const key = normalizeCompanionLocation(entry.session.room || entry.session.location);
    if (key) anchorLocationKeys.add(key);
  }
  const selectedIds = new Set([...currentEntries, ...nextEntries, ...soonEntries].map((entry) => Number(entry.session.id || 0)).filter(Boolean));
  const nearbyEntries = activeSessions
    .filter((entry) => !selectedIds.has(Number(entry.session.id || 0)))
    .filter((entry) => {
      const locationKey = normalizeCompanionLocation(entry.session.room || entry.session.location);
      return locationKey && anchorLocationKeys.has(locationKey);
    })
    .slice(0, EVENT_COMPANION_NOW_NEXT_LIMIT);

  const mapEntry = (entry, context) => {
    const linkedPlan = planByCatalogId.get(String(entry.session.id)) || null;
    return buildCompanionScheduleItem({
      eventId,
      session: entry.session,
      linkedPlan,
      context,
      now,
      conflicts: getCompanionPlanConflictsForSession(entry.session, plans, linkedPlan)
    });
  };

  return {
    contract: {
      version: EVENT_COMPANION_NOW_NEXT_VERSION,
      generated_at: now.toISOString(),
      source: 'event_schedule_sessions_with_personal_plan_overlay',
      catalog_sessions_authoritative: true,
      personal_plan_overlay: true,
      quick_actions_supported: true,
      conflict_hints_supported: true,
      nearby_strategy: 'same_room_or_location_as_current_or_next',
      limitations: [
        'read_snapshot_only',
        'no_offline_mutation_queue',
        'no_realtime_presence',
        'no_push_delivery'
      ]
    },
    window: {
      now: now.toISOString(),
      soon_minutes: EVENT_COMPANION_NOW_NEXT_WINDOW_MINUTES,
      max_items_per_group: EVENT_COMPANION_NOW_NEXT_LIMIT
    },
    counts: {
      current: currentEntries.length,
      next: nextEntries.length,
      soon: soonEntries.length,
      nearby: nearbyEntries.length
    },
    current: currentEntries.slice(0, EVENT_COMPANION_NOW_NEXT_LIMIT).map((entry) => mapEntry(entry, 'current')),
    next: nextEntries.map((entry, index) => mapEntry(entry, index === 0 ? 'next' : 'upcoming')),
    soon: soonEntries.map((entry) => mapEntry(entry, 'soon')),
    nearby: nearbyEntries.map((entry) => mapEntry(entry, 'nearby'))
  };
}

function buildCompanionFriendAwareChanges(eventId) {
  return {
    contract: {
      version: EVENT_COMPANION_FRIEND_AWARE_CHANGES_VERSION,
      scope: 'event_local',
      selected_recipient_notifications_supported: true,
      privacy_backend_owned: true,
      templates_supported: true,
      draft_records_supported: true,
      local_send_supported: true,
      external_delivery_supported: false,
      limitations: [
        'no_push_delivery',
        'no_email_delivery',
        'no_device_registration',
        'no_broadcast_without_recipient_selection',
        'no_global_friend_graph',
        'no_cross_event_inbox'
      ]
    },
    intents: [
      {
        intent: 'join',
        label: 'Join',
        default_message: 'Anyone want to join me for {{title}}?'
      },
      {
        intent: 'replace',
        label: 'Switch',
        default_message: "I'm switching to {{title}}."
      },
      {
        intent: 'meet',
        label: 'Meet',
        default_message: 'Meet outside this room for {{title}}?'
      },
      {
        intent: 'leave',
        label: 'Drop',
        default_message: "I'm dropping {{title}}."
      },
      {
        intent: 'backup',
        label: 'Backup',
        default_message: "I'm keeping {{title}} as backup."
      },
      {
        intent: 'status_update',
        label: 'Status update',
        default_message: '{{title}} is marked {{status}}.'
      }
    ],
    recipient_policy: {
      preview_required_before_send: true,
      default_mode: 'selected_recipients',
      visibility_values: ['private', 'selected_people', 'group', 'event_workspace'],
      group_notifications_supported: true,
      current_user_inbox_filter_supported: true,
      broadcast_supported: false,
      recipient_selection_required_when_visibility_shared: true
    },
    endpoints: {
      preview: `/api/events/${eventId}/schedule-change-preview`,
      records: `/api/events/${eventId}/schedule-notifications`,
      update_draft: `/api/events/${eventId}/schedule-notifications/{notificationId}`,
      discard_draft: `/api/events/${eventId}/schedule-notifications/{notificationId}`,
      delivery_boundary: `/api/events/${eventId}/schedule-notification-delivery-boundary`,
      inbox: `/api/events/${eventId}/schedule-notification-inbox`,
      current_user_inbox: `/api/events/${eventId}/schedule-notification-inbox?recipient=me`
    },
    write_guidance: [
      'Use the schedule-change preview first to fetch eligible recipients, message template, and conflict hints.',
      'Send or save drafts only with recipient ids returned by the preview for the current visibility.',
      'Treat sent records as Event-local coordination history, not push/email/device delivery.',
      'Refetch the companion snapshot or notification inbox after write actions to refresh plan and recipient readback.'
    ]
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

  const [attendeesResult, groupsResult, meetupsResult, plansResult, sessionsResult] = await Promise.all([
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
    ),
    pool.query(
      `SELECT *
         FROM event_schedule_sessions
        WHERE event_id = $1
          AND archived_at IS NULL
          AND status <> 'hidden'
        ORDER BY start_at NULLS LAST, title ASC, id ASC`,
      [eventId]
    )
  ]);

  const groups = await attachMembersToGroups(groupsResult.rows || []);
  const icsSource = serializeIcsSource(await loadPersonalIcsSource(pool, { eventId, userId }));
  const generatedAt = new Date();
  const icsFreshness = classifyPersonalIcsFreshness(icsSource, generatedAt);
  const nowNext = buildCompanionNowNext({
    eventId,
    sessions: sessionsResult.rows,
    plans: plansResult.rows,
    generatedAt
  });
  const friendAwareChanges = buildCompanionFriendAwareChanges(eventId);
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
        schedule_catalog: `/api/events/${eventId}/schedule-sessions`,
        personal_ics_source: `/api/events/${eventId}/personal-ics-source`
      },
      out_of_scope: [
        'catalog_import_automation',
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
      schedule_plans: plansResult.rows.length,
      schedule_catalog_sessions: sessionsResult.rows.length
    },
    sync: {
      personal_ics: icsSource,
      freshness: icsFreshness,
      personal_ics_visibility: buildPersonalIcsSyncVisibility({ eventId, source: icsSource, freshness: icsFreshness })
    },
    cache: EVENT_COMPANION_CACHE_POLICY,
    privacy: EVENT_COMPANION_PRIVACY_POLICY,
    now_next: nowNext,
    friend_aware_changes: friendAwareChanges,
    offline_packet: buildOfflinePacket({
      event,
      attendees: attendeesResult.rows,
      groups,
      meetups: meetupsResult.rows,
      plans: plansResult.rows,
      sessions: sessionsResult.rows,
      generatedAt,
      icsFreshness
    }),
    attendees: attendeesResult.rows,
    groups,
    meetups: meetupsResult.rows,
    schedule_catalog: sessionsResult.rows,
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
  await syncEventArtifactSignature({
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
      `SELECT ea.*,
              u.name AS linked_user_name,
              (ea.user_id = $2)::boolean AS current_user_attendee
         FROM event_attendees ea
         LEFT JOIN users u ON u.id = ea.user_id
        WHERE ea.event_id = $1
          AND ea.archived_at IS NULL
        ORDER BY ea.display_name ASC, ea.id ASC`,
    [eventId, req.user.id]
  );
  res.json({ items: result.rows.map((row) => ({
    ...row,
    linked_user: row.user_id ? {
      id: row.user_id,
      name: row.linked_user_name || null
    } : null
  })) });
}));

router.post('/events/:id/attendees', validate(eventAttendeeCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const body = normalizeEventAttendeeBody(req.body, req);
  const insert = buildInsertSql({
    table: 'event_attendees',
    eventId,
    fields: EVENT_ATTENDEE_FIELDS,
    body,
    userId: req.user.id
  });
  let result;
  try {
    result = await pool.query(insert.sql, insert.values);
  } catch (err) {
    return handleDuplicateEventAttendeeUserLink(res, err, eventId, body.user_id || req.user.id);
  }
  await logActivity(req, 'events.attendee.create', 'event', eventId, buildAttendeeActivityDetails(eventRow, result.rows[0]));
  res.status(201).json(result.rows[0]);
}));

router.patch('/events/:id/attendees/:attendeeId', validate(eventAttendeeUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const attendeeId = parsePositiveId(req.params.attendeeId, 'attendee id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const body = normalizeEventAttendeeBody(req.body, req);
  const update = buildUpdateSql({
    table: 'event_attendees',
    idColumn: 'id',
    id: attendeeId,
    eventId,
    fields: EVENT_ATTENDEE_FIELDS,
    body
  });
  let result;
  try {
    result = await pool.query(update.sql, update.values);
  } catch (err) {
    return handleDuplicateEventAttendeeUserLink(res, err, eventId, body.user_id || req.user.id);
  }
  if (!result.rows[0]) return res.status(404).json({ error: 'Attendee not found' });
  await logActivity(req, 'events.attendee.update', 'event', eventId, buildAttendeeActivityDetails(eventRow, result.rows[0]));
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
      RETURNING *`,
    [attendeeId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Attendee not found' });
  await logActivity(req, 'events.attendee.delete', 'event', eventId, buildAttendeeActivityDetails(eventRow, result.rows[0]));
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
  await logActivity(req, 'events.group.create', 'event', eventId, buildGroupActivityDetails(eventRow, group));
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
  await logActivity(req, 'events.group.update', 'event', eventId, buildGroupActivityDetails(eventRow, group));
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
      RETURNING *`,
    [groupId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Group not found' });
  await logActivity(req, 'events.group.delete', 'event', eventId, buildGroupActivityDetails(eventRow, result.rows[0]));
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
  await logActivity(req, 'events.meetup.create', 'event', eventId, buildMeetupActivityDetails(eventRow, result.rows[0]));
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
  await logActivity(req, 'events.meetup.update', 'event', eventId, buildMeetupActivityDetails(eventRow, result.rows[0]));
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
      RETURNING *`,
    [meetupId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Meetup not found' });
  await logActivity(req, 'events.meetup.delete', 'event', eventId, buildMeetupActivityDetails(eventRow, result.rows[0]));
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
  await logActivity(req, 'events.schedule_plan.create', 'event', eventId, buildSchedulePlanActivityDetails(eventRow, result.rows[0]));
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
  await logActivity(req, 'events.schedule_plan.update', 'event', eventId, buildSchedulePlanActivityDetails(eventRow, result.rows[0]));
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
      RETURNING *`,
    [planId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule plan not found' });
  await logActivity(req, 'events.schedule_plan.delete', 'event', eventId, buildSchedulePlanActivityDetails(eventRow, result.rows[0]));
  res.json({ ok: true, id: planId });
}));

router.post('/events/:id/schedule-change-preview', validate(eventScheduleChangePreviewSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const preview = await buildScheduleChangePreview({
    eventId,
    schedulePlanId: req.body.schedule_plan_id || null,
    catalogSessionId: req.body.catalog_session_id || null,
    requestedStatus: req.body.requested_status || null,
    requestedVisibility: req.body.requested_visibility || null,
    messageIntent: req.body.message_intent || null
  });
  if (!preview) return res.status(404).json({ error: 'Schedule change subject not found' });
  await logActivity(req, 'events.schedule_change.preview', 'event', eventId, buildEventActivityDetails(eventRow, {
    schedulePlanId: preview.subject.schedule_plan_id,
    catalogSessionId: preview.subject.catalog_session_id,
    scheduleTitle: preview.subject.title || null,
    requestedStatus: preview.requested_change.status,
    requestedVisibility: preview.requested_change.visibility,
    attendeeCount: preview.recipients.summary.attendee_count,
    groupCount: preview.recipients.summary.group_count,
    previewOnly: true
  }));
  res.json(preview);
}));

router.get('/events/:id/schedule-notifications', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT n.*,
            COALESCE(recipient_counts.recipient_count, 0)::int AS recipient_count,
            COALESCE(recipient_counts.unread_count, 0)::int AS unread_count,
            COALESCE(recipient_counts.read_count, 0)::int AS read_count,
            COALESCE(recipient_counts.acknowledged_count, 0)::int AS acknowledged_count,
            COALESCE(attempt_counts.delivery_attempt_count, 0)::int AS delivery_attempt_count,
            COALESCE(attempt_counts.queued_count, 0)::int AS delivery_attempt_queued_count,
            COALESCE(attempt_counts.sending_count, 0)::int AS delivery_attempt_sending_count,
            COALESCE(attempt_counts.succeeded_count, 0)::int AS delivery_attempt_succeeded_count,
            COALESCE(attempt_counts.failed_count, 0)::int AS delivery_attempt_failed_count,
            COALESCE(attempt_counts.skipped_count, 0)::int AS delivery_attempt_skipped_count,
            COALESCE(attempt_counts.cancelled_count, 0)::int AS delivery_attempt_cancelled_count,
            attempt_counts.latest_completed_at AS delivery_attempt_latest_completed_at
       FROM event_schedule_notifications n
       LEFT JOIN (
         SELECT notification_id,
                COUNT(*)::int AS recipient_count,
                COUNT(*) FILTER (WHERE read_status = 'unread')::int AS unread_count,
                COUNT(*) FILTER (WHERE read_status = 'read')::int AS read_count,
                COUNT(*) FILTER (WHERE read_status = 'acknowledged')::int AS acknowledged_count
           FROM event_schedule_notification_recipients
          WHERE archived_at IS NULL
          GROUP BY notification_id
       ) recipient_counts
         ON recipient_counts.notification_id = n.id
       LEFT JOIN (
         SELECT notification_id,
                COUNT(*)::int AS delivery_attempt_count,
                COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
                COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
                COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded_count,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
                COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped_count,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
                MAX(completed_at) AS latest_completed_at
           FROM event_schedule_notification_delivery_attempts
          WHERE archived_at IS NULL
          GROUP BY notification_id
       ) attempt_counts
         ON attempt_counts.notification_id = n.id
      WHERE n.event_id = $1
        AND n.archived_at IS NULL
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 50`,
    [eventId]
  );
  res.json({ items: result.rows.map(serializeScheduleNotification).filter(Boolean) });
}));

router.get('/events/:id/schedule-notification-delivery-boundary', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });
  res.json(buildScheduleNotificationDeliveryBoundary(eventId));
}));

router.get('/events/:id/schedule-notification-delivery-attempts', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });
  const notificationId = req.query.notification_id ? parsePositiveId(req.query.notification_id, 'schedule notification id') : null;

  const result = await pool.query(
    `SELECT a.*,
            r.recipient_type,
            r.attendee_id,
            r.group_id,
            r.recipient_snapshot,
            n.status AS notification_status,
            n.message_title,
            n.sent_at
       FROM event_schedule_notification_delivery_attempts a
       JOIN event_schedule_notifications n
         ON n.id = a.notification_id
        AND n.archived_at IS NULL
       JOIN event_schedule_notification_recipients r
         ON r.id = a.recipient_id
        AND r.archived_at IS NULL
      WHERE a.event_id = $1
        AND a.archived_at IS NULL
        AND ($2::integer IS NULL OR a.notification_id = $2)
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 100`,
    [eventId, notificationId]
  );
  const items = result.rows.map(serializeScheduleNotificationDeliveryAttempt).filter(Boolean);
  res.json({
    contract: {
      version: 'event-schedule-notification-delivery-attempt-readback.v1',
      scope: 'event_local',
      provider_delivery_supported: false,
      external_delivery_supported: false,
      readback_supported: true,
      limitations: [
        'event_local_audit_only',
        'no_push_delivery',
        'no_email_delivery',
        'no_device_registration',
        'no_provider_message_ids_for_event_local'
      ]
    },
    summary: buildScheduleNotificationDeliveryAttemptSummary(items),
    items
  });
}));

router.get('/events/:id/schedule-notification-inbox', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });
  const mineOnly = String(req.query.recipient || '').trim().toLowerCase() === 'me';

  const result = await pool.query(
    `SELECT r.*,
            ea.user_id AS linked_user_id,
            u.name AS linked_user_name,
            (ea.user_id = $2)::boolean AS current_user_recipient,
            n.status AS notification_status,
            n.requested_status,
            n.requested_visibility,
            n.message_title,
            n.message_body,
            n.subject_snapshot,
            n.conflicts_snapshot,
            n.delivery_channel,
            n.delivery_supported,
            n.sent_at,
            n.created_at AS notification_created_at
       FROM event_schedule_notification_recipients r
       JOIN event_schedule_notifications n
         ON n.id = r.notification_id
        AND n.archived_at IS NULL
       LEFT JOIN event_attendees ea
         ON ea.id = r.attendee_id
        AND ea.archived_at IS NULL
       LEFT JOIN users u
         ON u.id = ea.user_id
      WHERE r.event_id = $1
        AND r.archived_at IS NULL
        AND n.status = 'sent'
        AND ($3::boolean = FALSE OR ea.user_id = $2)
      ORDER BY
        CASE r.read_status WHEN 'unread' THEN 0 WHEN 'read' THEN 1 ELSE 2 END,
        COALESCE(n.sent_at, n.created_at) DESC,
        r.id DESC
      LIMIT 100`,
    [eventId, req.user.id, mineOnly]
  );
  const items = result.rows.map(serializeScheduleNotificationRecipient).filter(Boolean);
  const counts = items.reduce((acc, item) => {
    acc.total += 1;
    acc[item.read_status] = (acc[item.read_status] || 0) + 1;
    if (item.current_user_recipient) acc.mine += 1;
    return acc;
  }, { total: 0, unread: 0, read: 0, acknowledged: 0, mine: 0 });
  res.json({
    contract: {
      version: 'event-schedule-notification-inbox.v1',
      scope: 'event_local',
      current_user_filter_supported: true,
      external_delivery_supported: false,
      readback_supported: true,
      limitations: [
        'no_push_delivery',
        'no_email_delivery',
        'no_device_registration',
        'no_cross_event_inbox',
        'no_global_friend_identity'
      ]
    },
    counts,
    items
  });
}));

router.patch('/events/:id/schedule-notification-inbox/:recipientId', validate(eventScheduleNotificationRecipientUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const recipientId = parsePositiveId(req.params.recipientId, 'notification recipient id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const readStatus = req.body.read_status;
  const result = await pool.query(
    `UPDATE event_schedule_notification_recipients
        SET read_status = $1::varchar,
            read_at = CASE
              WHEN $1::text IN ('read', 'acknowledged') AND read_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE read_at
            END,
            acknowledged_at = CASE
              WHEN $1::text = 'acknowledged' AND acknowledged_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE acknowledged_at
            END
      WHERE id = $2
        AND event_id = $3
        AND archived_at IS NULL
      RETURNING *`,
    [readStatus, recipientId, eventId]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Notification recipient not found' });
  await logActivity(req, 'events.schedule_notification_recipient.update', 'event', eventId, {
    recipientId,
    notificationId: row.notification_id,
    recipientType: row.recipient_type,
    readStatus
  });
  res.json(serializeScheduleNotificationRecipient(row));
}));

router.post('/events/:id/schedule-notifications', validate(eventScheduleNotificationCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const preview = await buildScheduleChangePreview({
    eventId,
    schedulePlanId: req.body.schedule_plan_id || null,
    catalogSessionId: req.body.catalog_session_id || null,
    requestedStatus: req.body.requested_status || null,
    requestedVisibility: req.body.requested_visibility || null,
    messageIntent: req.body.message_intent || null
  });
  if (!preview) return res.status(404).json({ error: 'Schedule change subject not found' });

  const notification = await createScheduleNotification({
    eventId,
    preview,
    body: req.body,
    userId: req.user.id
  });
  await logActivity(req, notification.status === 'sent' ? 'events.schedule_notification.send' : 'events.schedule_notification.draft', 'event', eventId, buildEventActivityDetails(eventRow, {
    notificationId: notification.id,
    schedulePlanId: notification.schedule_plan_id,
    catalogSessionId: notification.catalog_session_id,
    scheduleTitle: preview.subject?.title || null,
    requestedStatus: notification.requested_status,
    requestedVisibility: notification.requested_visibility,
    attendeeCount: notification.recipients?.summary?.attendee_count || 0,
    groupCount: notification.recipients?.summary?.group_count || 0,
    deliveryChannel: notification.delivery_channel,
    externalDeliverySupported: false
  }));
  res.status(201).json(notification);
}));

router.patch('/events/:id/schedule-notifications/:notificationId', validate(eventScheduleNotificationCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const notificationId = parsePositiveId(req.params.notificationId, 'schedule notification id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const preview = await buildScheduleChangePreview({
    eventId,
    schedulePlanId: req.body.schedule_plan_id || null,
    catalogSessionId: req.body.catalog_session_id || null,
    requestedStatus: req.body.requested_status || null,
    requestedVisibility: req.body.requested_visibility || null,
    messageIntent: req.body.message_intent || null
  });
  if (!preview) return res.status(404).json({ error: 'Schedule change subject not found' });

  const notification = await updateScheduleNotificationDraft({
    eventId,
    notificationId,
    preview,
    body: req.body,
    userId: req.user.id
  });
  await logActivity(req, notification.status === 'sent' ? 'events.schedule_notification.send_draft' : 'events.schedule_notification.update_draft', 'event', eventId, buildEventActivityDetails(eventRow, {
    notificationId: notification.id,
    schedulePlanId: notification.schedule_plan_id,
    catalogSessionId: notification.catalog_session_id,
    scheduleTitle: preview.subject?.title || null,
    requestedStatus: notification.requested_status,
    requestedVisibility: notification.requested_visibility,
    attendeeCount: notification.recipients?.summary?.attendee_count || 0,
    groupCount: notification.recipients?.summary?.group_count || 0,
    deliveryChannel: notification.delivery_channel,
    externalDeliverySupported: false
  }));
  res.json(notification);
}));

router.delete('/events/:id/schedule-notifications/:notificationId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const notificationId = parsePositiveId(req.params.notificationId, 'schedule notification id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_schedule_notifications
        SET status = 'archived',
            archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND status = 'draft'
        AND archived_at IS NULL
      RETURNING *`,
    [notificationId, eventId]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Draft schedule notification not found' });
  await pool.query(
    `UPDATE event_schedule_notification_recipients
        SET archived_at = CURRENT_TIMESTAMP
      WHERE notification_id = $1
        AND event_id = $2
        AND archived_at IS NULL`,
    [notificationId, eventId]
  );
  await pool.query(
    `UPDATE event_schedule_notification_delivery_attempts
        SET archived_at = CURRENT_TIMESTAMP
      WHERE notification_id = $1
        AND event_id = $2
        AND archived_at IS NULL`,
    [notificationId, eventId]
  );
  await logActivity(req, 'events.schedule_notification.discard_draft', 'event', eventId, buildEventActivityDetails(eventRow, {
    notificationId,
    schedulePlanId: row.schedule_plan_id || null,
    catalogSessionId: row.catalog_session_id || null,
    externalDeliverySupported: false
  }));
  res.json({ ok: true, id: notificationId });
}));

router.get('/events/:id/schedule-sessions', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `SELECT *
       FROM event_schedule_sessions
      WHERE event_id = $1
        AND archived_at IS NULL
      ORDER BY start_at NULLS LAST, title ASC, id ASC`,
    [eventId]
  );
  res.json({ items: result.rows });
}));

router.post('/events/:id/schedule-sessions', validate(eventScheduleSessionCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const insert = buildInsertSql({
    table: 'event_schedule_sessions',
    eventId,
    fields: EVENT_SCHEDULE_SESSION_FIELDS,
    body: req.body,
    userId: req.user.id
  });
  const result = await pool.query(insert.sql, insert.values);
  await logActivity(req, 'events.schedule_session.create', 'event', eventId, buildScheduleSessionActivityDetails(eventRow, result.rows[0]));
  res.status(201).json(result.rows[0]);
}));

router.post('/events/:id/schedule-sessions/import-ics', validate(eventScheduleCatalogIcsImportSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  try {
    const result = await importCatalogIcsSource(pool, {
      eventId,
      userId: req.user.id,
      feedUrl: req.body.feed_url
    });
    await logActivity(req, 'events.schedule_session.import_ics.success', 'event', eventId, buildEventActivityDetails(eventRow, {
      summary: result.summary
    }));
    res.json(result);
  } catch (error) {
    await logActivity(req, 'events.schedule_session.import_ics.failure', 'event', eventId, buildEventActivityDetails(eventRow, {
      error: 'redacted catalog ICS import failure detail'
    }));
    res.status(502).json({
      error: 'Catalog ICS import failed',
      detail: String(error?.message || 'Import failed').replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240),
      summary: { created: 0, updated: 0, linked: 0, total: 0 }
    });
  }
}));

router.patch('/events/:id/schedule-sessions/:sessionId', validate(eventScheduleSessionUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const sessionId = parsePositiveId(req.params.sessionId, 'schedule session id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const update = buildUpdateSql({
    table: 'event_schedule_sessions',
    idColumn: 'id',
    id: sessionId,
    eventId,
    fields: EVENT_SCHEDULE_SESSION_FIELDS,
    body: req.body
  });
  const result = await pool.query(update.sql, update.values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule session not found' });
  await logActivity(req, 'events.schedule_session.update', 'event', eventId, buildScheduleSessionActivityDetails(eventRow, result.rows[0]));
  res.json(result.rows[0]);
}));

router.delete('/events/:id/schedule-sessions/:sessionId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = parsePositiveId(req.params.id, 'event id');
  const sessionId = parsePositiveId(req.params.sessionId, 'schedule session id');
  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) return res.status(404).json({ error: 'Event not found' });

  const result = await pool.query(
    `UPDATE event_schedule_sessions
        SET archived_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND event_id = $2
        AND archived_at IS NULL
      RETURNING *`,
    [sessionId, eventId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule session not found' });
  await logActivity(req, 'events.schedule_session.delete', 'event', eventId, buildScheduleSessionActivityDetails(eventRow, result.rows[0]));
  res.json({ ok: true, id: sessionId });
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
