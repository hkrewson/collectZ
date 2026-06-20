const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { validate, dashboardReviewDecisionSchema } = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const {
  buildMissingIdentifierReviewClues,
  buildMissingIdentifierReviewSql,
  buildSparseMetadataReviewClues,
  buildSparseMetadataReviewSql
} = require('../services/reviewClues');

const router = express.Router();

router.use('/dashboard', authenticateToken);
router.use('/dashboard', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toCount(value) {
  return Math.max(0, Math.trunc(firstNumber(value)));
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  return fallback;
}

function formatScope(scopeContext) {
  return {
    space_id: scopeContext?.spaceId ?? null,
    library_id: scopeContext?.libraryId ?? null
  };
}

function buildSyncScopeClause(params, scopeContext) {
  const conditions = [];
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    params.push(String(scopeContext.spaceId));
    conditions.push(`(scope->>'spaceId') = $${params.length}`);
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    params.push(String(scopeContext.libraryId));
    conditions.push(`(scope->>'libraryId') = $${params.length}`);
  }
  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

function summarizeProviderRow(row = {}) {
  return [
    {
      id: 'plex',
      label: 'Plex',
      configured: Boolean(row.plex_api_url || row.plex_api_key_encrypted || row.plex_server_name),
      detail: row.plex_server_name || row.plex_api_url || null,
      last_received_at: row.plex_webhook_receiver_last_received_at || null,
      last_event: row.plex_webhook_receiver_last_event || null
    },
    {
      id: 'kavita',
      label: 'Kavita',
      configured: Boolean(row.kavita_base_url || row.kavita_api_key_encrypted),
      detail: row.kavita_base_url || null,
      last_received_at: null,
      last_event: null
    },
    {
      id: 'books',
      label: 'Google Books',
      configured: Boolean(row.books_provider || row.books_api_url || row.books_api_key_encrypted),
      detail: row.books_provider || row.books_api_url || null,
      last_received_at: null,
      last_event: null
    },
    {
      id: 'barcode',
      label: 'Barcode',
      configured: Boolean(row.barcode_provider || row.barcode_api_url || row.barcode_api_key_encrypted),
      detail: row.barcode_provider || row.barcode_api_url || null,
      last_received_at: null,
      last_event: null
    },
    {
      id: 'comics',
      label: 'Comics',
      configured: Boolean(row.comics_provider || row.comics_api_url || row.comics_api_key_encrypted),
      detail: row.comics_provider || row.comics_api_url || null,
      last_received_at: null,
      last_event: null
    }
  ];
}

function shapeActivity(row) {
  const details = safeJson(row.details, {});
  return {
    id: row.id,
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    title: details.title || details.mediaTitle || details.eventTitle || details.provider || row.action,
    summary: details.reason || details.message || details.status || details.provider || null,
    created_at: row.created_at,
    user_email: row.user_email || null
  };
}

const MISSING_COVER_SQL = `COALESCE(NULLIF(TRIM(m.poster_path), ''), NULL) IS NULL`;
const MISSING_IDENTIFIER_SQL = buildMissingIdentifierReviewSql('m');
const SPARSE_METADATA_SQL = buildSparseMetadataReviewSql('m');
const REVIEW_FINDING_TYPES = new Set(['missing_covers', 'missing_identifiers', 'sparse_metadata']);

function normalizeReviewFindingType(value) {
  const normalized = String(value || '').trim().replace(/-/g, '_');
  return REVIEW_FINDING_TYPES.has(normalized) ? normalized : null;
}

function normalizeReviewDecisionAction(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'defer' || normalized === 'deferred') return 'deferred';
  if (normalized === 'dismiss' || normalized === 'dismissed') return 'dismissed';
  return null;
}

function activeReviewDecisionSql(mediaAlias, findingType) {
  return `NOT EXISTS (
    SELECT 1
    FROM media_review_decisions mrd
    WHERE mrd.media_id = ${mediaAlias}.id
      AND mrd.finding_type = '${findingType}'
      AND (mrd.media_updated_at IS NULL OR ${mediaAlias}.updated_at <= mrd.media_updated_at)
      AND (
        mrd.action = 'dismissed'
        OR (mrd.action = 'deferred' AND mrd.deferred_until > CURRENT_TIMESTAMP)
      )
  )`;
}

function activeReviewDecisionPredicate(mediaAlias, decisionAlias) {
  return `(${decisionAlias}.media_updated_at IS NULL OR ${mediaAlias}.updated_at <= ${decisionAlias}.media_updated_at)
    AND (
      ${decisionAlias}.action = 'dismissed'
      OR (${decisionAlias}.action = 'deferred' AND ${decisionAlias}.deferred_until > CURRENT_TIMESTAMP)
    )`;
}

function reviewDecisionHistorySql(mediaAlias, findingType) {
  return `COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', recent_review.id,
        'action', recent_review.action,
        'created_at', recent_review.created_at,
        'decision_id', recent_review.decision_id,
        'previous_action', recent_review.previous_action,
        'deferred_until', recent_review.deferred_until
      )
      ORDER BY recent_review.created_at DESC, recent_review.id DESC
    )
    FROM (
      SELECT
        al.id,
        al.action,
        al.created_at,
        al.details->>'decision_id' AS decision_id,
        al.details->>'previous_action' AS previous_action,
        al.details->>'deferred_until' AS deferred_until
      FROM activity_log al
      WHERE al.entity_type = 'media'
        AND al.entity_id = ${mediaAlias}.id
        AND al.action IN ('dashboard.review.deferred', 'dashboard.review.dismissed', 'dashboard.review.restored')
        AND al.details->>'finding_type' = '${findingType}'
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT 3
    ) recent_review
  ), '[]'::jsonb) AS review_decision_history`;
}

const MISSING_COVER_ACTIVE_SQL = `(${MISSING_COVER_SQL} AND ${activeReviewDecisionSql('m', 'missing_covers')})`;
const MISSING_IDENTIFIER_ACTIVE_SQL = `(${MISSING_IDENTIFIER_SQL} AND ${activeReviewDecisionSql('m', 'missing_identifiers')})`;
const SPARSE_METADATA_ACTIVE_SQL = `(${SPARSE_METADATA_SQL} AND ${activeReviewDecisionSql('m', 'sparse_metadata')})`;

function shapeMediaAttentionItem(row, reviewFilter = '') {
  const details = safeJson(row.type_details, {});
  const payload = {
    id: row.id,
    title: row.title || 'Untitled',
    media_type: row.media_type || null,
    year: row.year || null,
    format: row.format || null,
    poster_path: row.poster_path || null,
    series: details.series || details.collection_title || null,
    issue_number: details.issue_number || null,
    author: details.author || null,
    provider_name: details.provider_name || null,
    import_source: row.import_source || null,
    owned_formats: Array.isArray(row.owned_formats) ? row.owned_formats : [],
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    review_decision_history: Array.isArray(row.review_decision_history) ? row.review_decision_history : []
  };
  if (reviewFilter === 'missing_identifiers') {
    return {
      ...payload,
      ...buildMissingIdentifierReviewClues(row)
    };
  }
  if (reviewFilter === 'sparse_metadata') {
    return {
      ...payload,
      ...buildSparseMetadataReviewClues(row)
    };
  }
  return payload;
}

function shapeReviewDecisionRow(row = {}) {
  return {
    id: row.id,
    media_id: row.media_id,
    title: row.title || 'Untitled',
    media_type: row.media_type || null,
    year: row.year || null,
    format: row.format || null,
    finding_type: row.finding_type,
    action: row.action,
    deferred_until: row.deferred_until || null,
    created_at: row.created_at || null
  };
}

router.post('/dashboard/review-decisions', validate(dashboardReviewDecisionSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.body.media_id);
  const findingType = normalizeReviewFindingType(req.body.finding_type);
  const action = normalizeReviewDecisionAction(req.body.action);
  if (!findingType || !action) {
    return res.status(400).json({ error: 'Invalid review decision' });
  }

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  const mediaResult = await pool.query(
    `SELECT m.id, m.title, m.updated_at, m.space_id, m.library_id
     FROM media m
     WHERE m.id = $1${mediaScopeClause}
     LIMIT 1`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Review item not found' });

  const insertResult = await pool.query(
    `INSERT INTO media_review_decisions (
       media_id, finding_type, action, media_updated_at, deferred_until,
       note, library_id, space_id, created_by
     )
     VALUES (
       $1, $2, $3, $4,
       CASE WHEN $3 = 'deferred' THEN CURRENT_TIMESTAMP + INTERVAL '7 days' ELSE NULL END,
       $5, $6, $7, $8
     )
     RETURNING id, media_id, finding_type, action, deferred_until, created_at`,
    [
      media.id,
      findingType,
      action,
      media.updated_at || null,
      req.body.note || null,
      media.library_id || null,
      media.space_id || null,
      req.user?.id || null
    ]
  );

  const decision = insertResult.rows[0];
  await logActivity(req, `dashboard.review.${action}`, 'media', media.id, {
    title: media.title || null,
    finding_type: findingType,
    decision_id: decision.id,
    deferred_until: decision.deferred_until || null,
    spaceId: media.space_id || null,
    libraryId: media.library_id || null
  });

  res.status(201).json({
    ok: true,
    decision
  });
}));

router.delete('/dashboard/review-decisions/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const decisionId = Number(req.params.id);
  if (!Number.isFinite(decisionId) || decisionId <= 0) {
    return res.status(400).json({ error: 'Invalid review decision id' });
  }

  const params = [decisionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  const result = await pool.query(
    `DELETE FROM media_review_decisions mrd
     USING media m
     WHERE mrd.id = $1
       AND m.id = mrd.media_id${scopeClause}
     RETURNING
       mrd.id, mrd.media_id, mrd.finding_type, mrd.action, mrd.deferred_until, mrd.created_at,
       m.title, m.media_type, m.year, m.format, m.space_id, m.library_id`,
    params
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Review decision not found' });

  await logActivity(req, 'dashboard.review.restored', 'media', row.media_id, {
    title: row.title || null,
    finding_type: row.finding_type,
    decision_id: row.id,
    previous_action: row.action,
    spaceId: row.space_id || null,
    libraryId: row.library_id || null
  });

  res.json({
    ok: true,
    decision: shapeReviewDecisionRow(row)
  });
}));

router.get('/dashboard/summary', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaParams = [];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });

  const eventParams = [];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext, {
    spaceColumn: 'e.space_id',
    libraryColumn: 'e.library_id'
  });

  const reviewParams = [];
  const reviewScopeClause = appendScopeSql(reviewParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });

  const syncFailureParams = [];
  const syncFailureScopeClause = buildSyncScopeClause(syncFailureParams, scopeContext);

  const syncRecentParams = [];
  const syncRecentScopeClause = buildSyncScopeClause(syncRecentParams, scopeContext);

  const activityParams = [];
  const activityScopeFilters = [];
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    activityParams.push(String(scopeContext.spaceId));
    activityScopeFilters.push(`(
      (al.details->>'spaceId') = $${activityParams.length}
      OR (al.details->>'space_id') = $${activityParams.length}
      OR (al.entity_type = 'space' AND al.entity_id::text = $${activityParams.length})
      OR EXISTS (
        SELECT 1
          FROM sync_jobs sj
         WHERE sj.id::text = COALESCE(al.details->>'jobId', '')
           AND COALESCE(sj.scope->>'spaceId', sj.scope->>'space_id', '') = $${activityParams.length}
      )
    )`);
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    activityParams.push(String(scopeContext.libraryId));
    activityScopeFilters.push(`(
      (al.details->>'libraryId') = $${activityParams.length}
      OR (al.details->>'library_id') = $${activityParams.length}
      OR (al.entity_type = 'library' AND al.entity_id::text = $${activityParams.length})
      OR EXISTS (
        SELECT 1
          FROM sync_jobs sj
         WHERE sj.id::text = COALESCE(al.details->>'jobId', '')
           AND COALESCE(sj.scope->>'libraryId', sj.scope->>'library_id', '') = $${activityParams.length}
      )
    )`);
  }
  const activityConditions = [
    `al.action NOT LIKE 'request.%'`,
    `COALESCE(al.entity_type, '') <> 'http_request'`,
    ...activityScopeFilters
  ];
  const activityWhere = `WHERE ${activityConditions.join(' AND ')}`;

  const integrationParams = [];
  let integrationWhere = 'WHERE space_id IS NULL';
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    integrationParams.push(scopeContext.spaceId);
    integrationWhere = `WHERE space_id = $${integrationParams.length}`;
  }

  const [
    mediaCounts,
    missingCoverItems,
    missingIdentifierItems,
    sparseMetadataItems,
    failedJobs,
    recentJobs,
    openReviews,
    upcomingEvents,
    recentActivity,
    integrationResult,
    hiddenReviewDecisions
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE ${MISSING_COVER_ACTIVE_SQL})::int AS missing_covers,
         COUNT(*) FILTER (WHERE ${MISSING_IDENTIFIER_ACTIVE_SQL})::int AS missing_identifiers,
         COUNT(*) FILTER (WHERE ${SPARSE_METADATA_ACTIVE_SQL})::int AS sparse_metadata
       FROM media m
       WHERE 1=1${mediaScopeClause}`,
      mediaParams
    ),
    pool.query(
      `SELECT
         m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at,
         ${reviewDecisionHistorySql('m', 'missing_covers')}
       FROM media m
       WHERE ${MISSING_COVER_ACTIVE_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 8`,
      mediaParams
    ),
    pool.query(
      `SELECT
         m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.upc, m.tmdb_id, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at,
         ${reviewDecisionHistorySql('m', 'missing_identifiers')}
       FROM media m
       WHERE ${MISSING_IDENTIFIER_ACTIVE_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 8`,
      mediaParams
    ),
    pool.query(
      `SELECT
         m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.upc, m.tmdb_id, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at,
         ${reviewDecisionHistorySql('m', 'sparse_metadata')}
       FROM media m
       WHERE ${SPARSE_METADATA_ACTIVE_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 8`,
      mediaParams
    ),
    pool.query(
      `SELECT id, job_type, provider, status, error, summary, updated_at, created_at
       FROM sync_jobs
       WHERE status = 'failed'${syncFailureScopeClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT 5`,
      syncFailureParams
    ),
    pool.query(
      `SELECT id, job_type, provider, status, error, summary, updated_at, created_at
       FROM sync_jobs
       WHERE 1=1${syncRecentScopeClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT 6`,
      syncRecentParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS open_count
       FROM plex_reconciliation_reviews
       WHERE status = 'open'${reviewScopeClause}`,
      reviewParams
    ),
    pool.query(
      `SELECT e.id, e.title, e.location, e.date_start, e.date_end, e.host, e.image_path
       FROM events e
       WHERE e.archived_at IS NULL
         AND COALESCE(e.date_end, e.date_start) >= CURRENT_DATE${eventScopeClause}
       ORDER BY e.date_start ASC, e.id ASC
       LIMIT 5`,
      eventParams
    ),
    pool.query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at, u.email AS user_email
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${activityWhere}
       ORDER BY al.id DESC
       LIMIT 8`,
      activityParams
    ),
    pool.query(
      `SELECT *
       FROM app_integrations
       ${integrationWhere}
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      integrationParams
    ),
    pool.query(
      `SELECT DISTINCT ON (mrd.media_id, mrd.finding_type)
         mrd.id, mrd.media_id, mrd.finding_type, mrd.action, mrd.deferred_until, mrd.created_at,
         m.title, m.media_type, m.year, m.format
       FROM media_review_decisions mrd
       JOIN media m ON m.id = mrd.media_id
       WHERE ${activeReviewDecisionPredicate('m', 'mrd')}${mediaScopeClause}
       ORDER BY mrd.media_id, mrd.finding_type, mrd.created_at DESC, mrd.id DESC
       LIMIT 20`,
      mediaParams
    )
  ]);

  const mediaRow = mediaCounts.rows[0] || {};
  const openReviewCount = toCount(openReviews.rows[0]?.open_count);
  const missingCoverCount = toCount(mediaRow.missing_covers);
  const missingIdentifierCount = toCount(mediaRow.missing_identifiers);
  const sparseMetadataCount = toCount(mediaRow.sparse_metadata);
  const failedJobCount = Array.isArray(failedJobs.rows) ? failedJobs.rows.length : 0;

  const attention = [
    {
      id: 'failed-syncs',
      label: 'Failed syncs',
      count: failedJobCount,
      severity: failedJobCount > 0 ? 'danger' : 'ok',
      target_tab: 'dashboard',
      description: failedJobCount > 0 ? 'Recent import or provider jobs need a look.' : 'No recent failed sync jobs.'
    },
    {
      id: 'plex-conflicts',
      label: 'Plex conflicts',
      count: openReviewCount,
      severity: openReviewCount > 0 ? 'warn' : 'ok',
      target_tab: 'admin-integrations',
      target_section: 'plex',
      description: openReviewCount > 0 ? 'Open reconciliation decisions are waiting.' : 'No open Plex reconciliation conflicts.'
    },
    {
      id: 'missing-covers',
      label: 'Missing covers',
      count: missingCoverCount,
      severity: missingCoverCount > 0 ? 'info' : 'ok',
      target_tab: 'dashboard',
      description: missingCoverCount > 0 ? 'Items without cover/poster art are visible in this scope.' : 'No missing covers detected in this scope.'
    },
    {
      id: 'missing-identifiers',
      label: 'Missing identifiers',
      count: missingIdentifierCount,
      severity: missingIdentifierCount > 0 ? 'info' : 'ok',
      target_tab: 'dashboard',
      description: missingIdentifierCount > 0 ? 'Some items lack UPC, ISBN, TMDB, Plex, Kavita, or Google Books identifiers.' : 'Identifiers look covered in this scope.'
    },
    {
      id: 'sparse-metadata',
      label: 'Sparse metadata',
      count: sparseMetadataCount,
      severity: sparseMetadataCount > 0 ? 'info' : 'ok',
      target_tab: 'dashboard',
      description: sparseMetadataCount > 0 ? 'Some items have enough identity but need descriptive fields for better matching and display.' : 'Metadata clues look covered in this scope.'
    }
  ];

  res.json({
    scope: formatScope(scopeContext),
    generated_at: new Date().toISOString(),
    collection: {
      total_items: toCount(mediaRow.total),
      missing_covers: missingCoverCount,
      missing_identifiers: missingIdentifierCount,
      sparse_metadata: sparseMetadataCount
    },
    attention,
    attention_details: {
      missing_cover_items: missingCoverItems.rows.map(shapeMediaAttentionItem),
      missing_identifier_items: missingIdentifierItems.rows.map((row) => shapeMediaAttentionItem(row, 'missing_identifiers')),
      sparse_metadata_items: sparseMetadataItems.rows.map((row) => shapeMediaAttentionItem(row, 'sparse_metadata')),
      hidden_review_decisions: hiddenReviewDecisions.rows.map(shapeReviewDecisionRow)
    },
    failed_sync_jobs: failedJobs.rows.map((row) => ({
      id: row.id,
      job_type: row.job_type,
      provider: row.provider,
      status: row.status,
      error: row.error || null,
      summary: safeJson(row.summary, {}),
      updated_at: row.updated_at,
      created_at: row.created_at
    })),
    recent_sync_jobs: recentJobs.rows.map((row) => ({
      id: row.id,
      job_type: row.job_type,
      provider: row.provider,
      status: row.status,
      error: row.error || null,
      summary: safeJson(row.summary, {}),
      updated_at: row.updated_at,
      created_at: row.created_at
    })),
    providers: summarizeProviderRow(integrationResult.rows[0] || {}),
    upcoming_events: upcomingEvents.rows.map((row) => ({
      id: row.id,
      title: row.title,
      location: row.location || null,
      date_start: row.date_start,
      date_end: row.date_end || null,
      host: row.host || null,
      image_path: row.image_path || null
    })),
    recent_activity: recentActivity.rows.map(shapeActivity)
  });
}));

module.exports = router;
