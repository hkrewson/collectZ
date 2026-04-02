const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireSessionAuth, requireRole } = require('../middleware/auth');
const {
  validate,
  supportRequestCreateSchema,
  supportRequestMessageCreateSchema,
  supportRequestStatusUpdateSchema,
  supportRequestAccessUpdateSchema,
  supportRequestTriageUpdateSchema
} = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadReleaseNotesFeed } = require('../services/releaseNotes');

const router = express.Router();

const SUPPORT_STAFF_ROLES = new Set(['admin', 'support_admin']);

function isSupportStaff(req) {
  return SUPPORT_STAFF_ROLES.has(String(req.user?.role || ''));
}

function formatSupportRequestKey(id) {
  const numericId = Number(id || 0);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  return `SUP-${String(numericId).padStart(6, '0')}`;
}

function formatSupportRequest(row, options = {}) {
  const includeInternalNotes = Boolean(options.includeInternalNotes);
  return {
    id: row.id,
    request_key: row.request_key || formatSupportRequestKey(row.id),
    subject: row.subject,
    status: row.status,
    classification: row.classification || 'support',
    tracking_status: row.tracking_status || 'untracked',
    support_access_status: row.support_access_status || 'not_requested',
    support_access_approved_at: row.support_access_approved_at || null,
    support_access_approved_by_user_id: row.support_access_approved_by_user_id || null,
    resolved_in_version: row.resolved_in_version || null,
    repo_issue_number: row.repo_issue_number || null,
    repo_issue_url: row.repo_issue_url || null,
    internal_notes: includeInternalNotes ? (row.internal_notes || null) : null,
    target_space_id: row.target_space_id || null,
    target_space_name: row.target_space_name || null,
    target_library_id: row.target_library_id || null,
    target_library_name: row.target_library_name || null,
    requester_user_id: row.requester_user_id || null,
    requester_name: row.requester_name || null,
    requester_email: row.requester_email || null,
    message_count: Number(row.message_count || 0),
    last_message_at: row.last_message_at || null,
    last_message_by_role: row.last_message_by_role || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function formatSupportMessage(row) {
  return {
    id: row.id,
    request_id: row.request_id,
    request_key: row.request_key || formatSupportRequestKey(row.request_id),
    author_user_id: row.author_user_id || null,
    author_role: row.author_role,
    is_internal: Boolean(row.is_internal),
    author_name: row.author_name || null,
    author_email: row.author_email || null,
    body: row.body,
    created_at: row.created_at
  };
}

function buildSupportTrackingUpdateMessage(previousRequest, nextRequest) {
  const parts = [];
  if ((previousRequest.classification || 'support') !== (nextRequest.classification || 'support')) {
    const label = nextRequest.classification === 'feature_request'
      ? 'feature request'
      : nextRequest.classification;
    parts.push(`This request is now being tracked as a ${label}.`);
  }
  if ((previousRequest.tracking_status || 'untracked') !== (nextRequest.tracking_status || 'untracked')) {
    const statusLabel = String(nextRequest.tracking_status || 'untracked').replace(/_/g, ' ');
    parts.push(`Tracking status is now ${statusLabel}.`);
  }
  if ((previousRequest.resolved_in_version || null) !== (nextRequest.resolved_in_version || null) && nextRequest.resolved_in_version) {
    parts.push(`This work shipped in ${nextRequest.resolved_in_version}.`);
  }
  if (parts.length === 0) return '';
  return `Support update: ${parts.join(' ')}`;
}

function buildSupportAccessUpdateMessage(nextStatus) {
  if (nextStatus === 'approved') {
    return 'Support access has been approved for this request. Support staff can use this request as the approval context for a later tenant support session.';
  }
  if (nextStatus === 'revoked') {
    return 'Support access approval has been revoked for this request.';
  }
  return '';
}

router.get('/releases', authenticateToken, asyncHandler(async (req, res) => {
  const requestedLimit = Number(req.query.limit || 5);
  const limit = Math.max(1, Math.min(10, Number.isFinite(requestedLimit) ? requestedLimit : 5));
  res.json({
    releases: loadReleaseNotesFeed({ limit })
  });
}));

async function getSupportRequestForActor({ client, requestId, userId, role }) {
  const includeInternalMessages = SUPPORT_STAFF_ROLES.has(String(role || ''));
  const result = await client.query(
    `SELECT sr.id,
            sr.subject,
            sr.status,
            sr.classification,
            sr.tracking_status,
            sr.support_access_status,
            sr.support_access_approved_at,
            sr.support_access_approved_by_user_id,
            sr.target_space_id,
            sr.target_library_id,
            sr.internal_notes,
            sr.repo_issue_number,
            sr.repo_issue_url,
            sr.resolved_in_version,
            sr.requester_user_id,
            sr.last_message_at,
            sr.last_message_by_role,
            sr.created_at,
            sr.updated_at,
            requester.name AS requester_name,
            requester.email AS requester_email,
            target_space.name AS target_space_name,
            target_library.name AS target_library_name,
            COUNT(srm.id) FILTER (WHERE $4::boolean = true OR COALESCE(srm.is_internal, false) = false)::int AS message_count
       FROM support_requests sr
       JOIN users requester ON requester.id = sr.requester_user_id
       LEFT JOIN spaces target_space ON target_space.id = sr.target_space_id
       LEFT JOIN libraries target_library ON target_library.id = sr.target_library_id
       LEFT JOIN support_request_messages srm ON srm.request_id = sr.id
      WHERE sr.id = $1
        AND ($2::boolean = true OR sr.requester_user_id = $3)
      GROUP BY sr.id, requester.name, requester.email, target_space.name, target_library.name`,
    [requestId, includeInternalMessages, userId, includeInternalMessages]
  );
  return result.rows[0] || null;
}

router.get('/requests', authenticateToken, asyncHandler(async (req, res) => {
  const supportStaff = isSupportStaff(req);
  const params = [];
  const where = [];

  if (!supportStaff) {
    params.push(req.user.id);
    where.push(`sr.requester_user_id = $${params.length}`);
  }

  const status = String(req.query.status || '').trim().toLowerCase();
  if (status && ['open', 'answered', 'closed'].includes(status)) {
    params.push(status);
    where.push(`sr.status = $${params.length}`);
  }

  const query = `
    SELECT sr.id,
           sr.subject,
           sr.status,
           sr.classification,
           sr.tracking_status,
           sr.support_access_status,
           sr.support_access_approved_at,
           sr.support_access_approved_by_user_id,
           sr.target_space_id,
           sr.target_library_id,
           sr.internal_notes,
           sr.repo_issue_number,
           sr.repo_issue_url,
           sr.resolved_in_version,
           sr.requester_user_id,
           sr.last_message_at,
           sr.last_message_by_role,
           sr.created_at,
           sr.updated_at,
           requester.name AS requester_name,
           requester.email AS requester_email,
           target_space.name AS target_space_name,
           target_library.name AS target_library_name,
           COUNT(srm.id) FILTER (WHERE $${params.length + 1}::boolean = true OR COALESCE(srm.is_internal, false) = false)::int AS message_count
      FROM support_requests sr
      JOIN users requester ON requester.id = sr.requester_user_id
      LEFT JOIN spaces target_space ON target_space.id = sr.target_space_id
      LEFT JOIN libraries target_library ON target_library.id = sr.target_library_id
      LEFT JOIN support_request_messages srm ON srm.request_id = sr.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY sr.id, requester.name, requester.email, target_space.name, target_library.name
     ORDER BY
       CASE sr.status
         WHEN 'open' THEN 0
         WHEN 'answered' THEN 1
         ELSE 2
       END,
       sr.last_message_at DESC,
       sr.id DESC
     LIMIT 100`;

  const result = await pool.query(query, [...params, supportStaff]);
  res.json({
    requests: result.rows.map((row) => formatSupportRequest(row, { includeInternalNotes: supportStaff })),
    support_staff: supportStaff
  });
}));

router.post('/requests', authenticateToken, requireSessionAuth, validate(supportRequestCreateSchema), asyncHandler(async (req, res) => {
  const supportStaff = isSupportStaff(req);
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  const targetSpaceId = supportStaff
    ? null
    : (Number(req.body.target_space_id || 0) || Number(req.user.activeSpaceId || 0) || null);
  const targetLibraryId = supportStaff
    ? null
    : (Number(req.body.target_library_id || 0) || Number(req.user.activeLibraryId || 0) || null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(
      `INSERT INTO support_requests (
         requester_user_id,
         subject,
         status,
         classification,
         tracking_status,
         target_space_id,
         target_library_id,
         last_message_at,
         last_message_by_role,
         updated_at
       )
       VALUES ($1, $2, 'open', 'support', 'untracked', $3, $4, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.user.id, subject, targetSpaceId, targetLibraryId, req.user.role]
    );
    const requestRow = requestResult.rows[0];
    const messageResult = await client.query(
      `INSERT INTO support_request_messages (request_id, author_user_id, author_role, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [requestRow.id, req.user.id, req.user.role, message]
    );
    await client.query('COMMIT');

    await logActivity(req, 'support.request.created', 'support_request', requestRow.id, {
      subject,
      status: requestRow.status,
      targetSpaceId,
      targetLibraryId
    });

    res.status(201).json({
      request: formatSupportRequest({
        ...requestRow,
        requester_name: req.user.name || null,
        requester_email: req.user.email || null,
        target_space_name: null,
        target_library_name: null,
        message_count: 1
      }, { includeInternalNotes: supportStaff }),
      message: formatSupportMessage({
        ...messageResult.rows[0],
        request_key: formatSupportRequestKey(requestRow.id),
        author_name: req.user.name || null,
        author_email: req.user.email || null
      })
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/requests/:id', authenticateToken, asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid support request id' });
  }

  const client = await pool.connect();
  try {
    const supportRequest = await getSupportRequestForActor({
      client,
      requestId,
      userId: req.user.id,
      role: req.user.role
    });
    if (!supportRequest) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    const messagesResult = await client.query(
      `SELECT srm.*,
              u.name AS author_name,
              u.email AS author_email
         FROM support_request_messages srm
         LEFT JOIN users u ON u.id = srm.author_user_id
        WHERE srm.request_id = $1
          AND ($2::boolean = true OR COALESCE(srm.is_internal, false) = false)
        ORDER BY srm.created_at ASC, srm.id ASC`,
      [requestId, isSupportStaff(req)]
    );

    res.json({
      request: formatSupportRequest(supportRequest, { includeInternalNotes: isSupportStaff(req) }),
      messages: messagesResult.rows.map((row) => formatSupportMessage({
        ...row,
        request_key: formatSupportRequestKey(supportRequest.id)
      }))
    });
  } finally {
    client.release();
  }
}));

router.post('/requests/:id/messages', authenticateToken, requireSessionAuth, validate(supportRequestMessageCreateSchema), asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid support request id' });
  }

  const body = String(req.body.body || '').trim();
  const nextStatus = isSupportStaff(req) ? 'answered' : 'open';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supportRequest = await getSupportRequestForActor({
      client,
      requestId,
      userId: req.user.id,
      role: req.user.role
    });
    if (!supportRequest) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Support request not found' });
    }

    const messageResult = await client.query(
      `INSERT INTO support_request_messages (request_id, author_user_id, author_role, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [requestId, req.user.id, req.user.role, body]
    );

    const requestResult = await client.query(
      `UPDATE support_requests
          SET status = $2,
              last_message_at = CURRENT_TIMESTAMP,
              last_message_by_role = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [requestId, nextStatus, req.user.role]
    );

    await client.query('COMMIT');

    await logActivity(req, 'support.request.message.created', 'support_request', requestId, {
      status: nextStatus,
      authorRole: req.user.role
    });

    res.status(201).json({
      request: formatSupportRequest({
        ...requestResult.rows[0],
        requester_name: supportRequest.requester_name,
        requester_email: supportRequest.requester_email,
        target_space_name: supportRequest.target_space_name,
        target_library_name: supportRequest.target_library_name,
        message_count: Number(supportRequest.message_count || 0) + 1
      }, { includeInternalNotes: isSupportStaff(req) }),
      message: formatSupportMessage({
        ...messageResult.rows[0],
        request_key: formatSupportRequestKey(requestId),
        author_name: req.user.name || null,
        author_email: req.user.email || null
      })
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.patch('/requests/:id/status', authenticateToken, requireSessionAuth, validate(supportRequestStatusUpdateSchema), asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid support request id' });
  }

  const nextStatus = req.body.status;
  const client = await pool.connect();
  try {
    const supportRequest = await getSupportRequestForActor({
      client,
      requestId,
      userId: req.user.id,
      role: req.user.role
    });
    if (!supportRequest) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    if (!isSupportStaff(req) && nextStatus !== 'closed') {
      return res.status(403).json({ error: 'Only support staff may reopen or answer requests' });
    }

    const result = await client.query(
      `UPDATE support_requests
          SET status = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [requestId, nextStatus]
    );

    await logActivity(req, 'support.request.status.updated', 'support_request', requestId, {
      previousStatus: supportRequest.status,
      nextStatus
    });

    res.json({
      request: formatSupportRequest({
        ...result.rows[0],
        requester_name: supportRequest.requester_name,
        requester_email: supportRequest.requester_email,
        message_count: supportRequest.message_count
      }, { includeInternalNotes: isSupportStaff(req) })
    });
  } finally {
    client.release();
  }
}));

router.patch('/requests/:id/access', authenticateToken, requireSessionAuth, validate(supportRequestAccessUpdateSchema), asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid support request id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supportRequest = await getSupportRequestForActor({
      client,
      requestId,
      userId: req.user.id,
      role: req.user.role
    });
    if (!supportRequest) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Support request not found' });
    }

    if (Number(supportRequest.requester_user_id || 0) !== Number(req.user.id || 0)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the original requester can approve or revoke support access for this request' });
    }

    if (!supportRequest.target_space_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Support access approval requires a target space on the request' });
    }

    const nextAccessStatus = req.body.support_access_status;
    const approvedAt = nextAccessStatus === 'approved' ? new Date().toISOString() : null;
    const approvedByUserId = nextAccessStatus === 'approved' ? req.user.id : null;

    const result = await client.query(
      `UPDATE support_requests
          SET support_access_status = $2,
              support_access_approved_at = $3,
              support_access_approved_by_user_id = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [requestId, nextAccessStatus, approvedAt, approvedByUserId]
    );

    const updatedRequest = {
      ...result.rows[0],
      target_space_name: supportRequest.target_space_name,
      target_library_name: supportRequest.target_library_name,
      requester_name: supportRequest.requester_name,
      requester_email: supportRequest.requester_email,
      message_count: supportRequest.message_count
    };

    const systemBody = buildSupportAccessUpdateMessage(nextAccessStatus);
    let systemMessage = null;
    if (systemBody) {
      const messageResult = await client.query(
        `INSERT INTO support_request_messages (request_id, author_user_id, author_role, is_internal, body)
         VALUES ($1, NULL, 'system', false, $2)
         RETURNING *`,
        [requestId, systemBody]
      );
      await client.query(
        `UPDATE support_requests
            SET last_message_at = CURRENT_TIMESTAMP,
                last_message_by_role = 'system',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [requestId]
      );
      systemMessage = formatSupportMessage({
        ...messageResult.rows[0],
        request_key: formatSupportRequestKey(requestId)
      });
      updatedRequest.last_message_at = new Date().toISOString();
      updatedRequest.last_message_by_role = 'system';
      updatedRequest.message_count = Number(updatedRequest.message_count || 0) + 1;
    }

    await client.query('COMMIT');

    await logActivity(req, 'support.request.access.updated', 'support_request', requestId, {
      supportAccessStatus: nextAccessStatus,
      targetSpaceId: supportRequest.target_space_id,
      targetLibraryId: supportRequest.target_library_id
    });

    res.json({
      request: formatSupportRequest(updatedRequest, { includeInternalNotes: isSupportStaff(req) }),
      message: systemMessage
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.patch('/requests/:id/triage', authenticateToken, requireSessionAuth, requireRole('admin', 'support_admin'), validate(supportRequestTriageUpdateSchema), asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Invalid support request id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supportRequest = await getSupportRequestForActor({
      client,
      requestId,
      userId: req.user.id,
      role: req.user.role
    });
    if (!supportRequest) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Support request not found' });
    }

    const nextClassification = req.body.classification || supportRequest.classification || 'support';
    const nextTrackingStatus = req.body.tracking_status === undefined
      ? (supportRequest.tracking_status || 'untracked')
      : (req.body.tracking_status || 'untracked');
    const nextInternalNotes = req.body.internal_notes === undefined
      ? (supportRequest.internal_notes || null)
      : req.body.internal_notes;
    const nextRepoIssueNumber = req.body.repo_issue_number === undefined
      ? (supportRequest.repo_issue_number || null)
      : req.body.repo_issue_number;
    const nextRepoIssueUrl = req.body.repo_issue_url === undefined
      ? (supportRequest.repo_issue_url || null)
      : req.body.repo_issue_url;
    const nextResolvedInVersion = req.body.resolved_in_version === undefined
      ? (supportRequest.resolved_in_version || null)
      : req.body.resolved_in_version;

    const result = await client.query(
      `UPDATE support_requests
          SET classification = $2,
              tracking_status = $3,
              internal_notes = $4,
              repo_issue_number = $5,
              repo_issue_url = $6,
              resolved_in_version = $7,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [requestId, nextClassification, nextTrackingStatus, nextInternalNotes, nextRepoIssueNumber, nextRepoIssueUrl, nextResolvedInVersion]
    );

    const updatedRequest = {
      ...result.rows[0],
      target_space_name: supportRequest.target_space_name,
      target_library_name: supportRequest.target_library_name,
      requester_name: supportRequest.requester_name,
      requester_email: supportRequest.requester_email,
      message_count: supportRequest.message_count
    };

    const systemBody = buildSupportTrackingUpdateMessage(supportRequest, updatedRequest);
    let systemMessage = null;
    let internalNoteMessage = null;
    if (systemBody) {
      const messageResult = await client.query(
        `INSERT INTO support_request_messages (request_id, author_user_id, author_role, is_internal, body)
         VALUES ($1, NULL, 'system', false, $2)
         RETURNING *`,
        [requestId, systemBody]
      );
      await client.query(
        `UPDATE support_requests
            SET last_message_at = CURRENT_TIMESTAMP,
                last_message_by_role = 'system',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [requestId]
      );
      systemMessage = formatSupportMessage({
        ...messageResult.rows[0],
        request_key: formatSupportRequestKey(requestId)
      });
      updatedRequest.last_message_at = new Date().toISOString();
      updatedRequest.last_message_by_role = 'system';
      updatedRequest.message_count = Number(updatedRequest.message_count || 0) + 1;
    }

    if (req.body.internal_notes !== undefined && req.body.internal_notes !== null && String(req.body.internal_notes).trim()) {
      const noteResult = await client.query(
        `INSERT INTO support_request_messages (request_id, author_user_id, author_role, is_internal, body)
         VALUES ($1, $2, $3, true, $4)
         RETURNING *`,
        [requestId, req.user.id, req.user.role, String(req.body.internal_notes).trim()]
      );
      internalNoteMessage = formatSupportMessage({
        ...noteResult.rows[0],
        request_key: formatSupportRequestKey(requestId),
        author_name: req.user.name || null,
        author_email: req.user.email || null
      });
      updatedRequest.message_count = Number(updatedRequest.message_count || 0) + 1;
    }

    await client.query('COMMIT');

    await logActivity(req, 'support.request.triage.updated', 'support_request', requestId, {
      classification: nextClassification,
      trackingStatus: nextTrackingStatus,
      repoIssueNumber: nextRepoIssueNumber,
      resolvedInVersion: nextResolvedInVersion
    });

    res.json({
      request: formatSupportRequest(updatedRequest, { includeInternalNotes: true }),
      message: systemMessage,
      internal_note_message: internalNoteMessage
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/staff/summary', authenticateToken, requireRole('admin', 'support_admin'), asyncHandler(async (_req, res) => {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
       COUNT(*) FILTER (WHERE status = 'answered')::int AS answered_count,
       COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_count,
       COUNT(*) FILTER (WHERE classification = 'bug')::int AS bug_count,
       COUNT(*) FILTER (WHERE classification = 'feature_request')::int AS feature_count
     FROM support_requests`
  );

  res.json({
    queue: {
      open: Number(result.rows[0]?.open_count || 0),
      answered: Number(result.rows[0]?.answered_count || 0),
      closed: Number(result.rows[0]?.closed_count || 0),
      bugs: Number(result.rows[0]?.bug_count || 0),
      features: Number(result.rows[0]?.feature_count || 0)
    }
  });
}));

module.exports = router;
