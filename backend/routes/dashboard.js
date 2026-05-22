const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { buildMissingIdentifierReviewClues } = require('../services/reviewClues');

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
const MISSING_IDENTIFIER_SQL = `COALESCE(NULLIF(TRIM(m.upc), ''), NULL) IS NULL
             AND m.tmdb_id IS NULL
             AND COALESCE(NULLIF(TRIM(m.type_details->>'isbn'), ''), NULL) IS NULL
             AND COALESCE(NULLIF(TRIM(m.type_details->>'isbn13'), ''), NULL) IS NULL
             AND COALESCE(NULLIF(TRIM(m.type_details->>'google_books_id'), ''), NULL) IS NULL
             AND COALESCE(NULLIF(TRIM(m.type_details->>'plex_rating_key'), ''), NULL) IS NULL
             AND COALESCE(NULLIF(TRIM(m.type_details->>'kavita_series_id'), ''), NULL) IS NULL`;

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
    updated_at: row.updated_at || null,
    created_at: row.created_at || null
  };
  if (reviewFilter === 'missing_identifiers') {
    return {
      ...payload,
      ...buildMissingIdentifierReviewClues(row)
    };
  }
  return payload;
}

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
    )`);
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    activityParams.push(String(scopeContext.libraryId));
    activityScopeFilters.push(`(
      (al.details->>'libraryId') = $${activityParams.length}
      OR (al.details->>'library_id') = $${activityParams.length}
      OR (al.entity_type = 'library' AND al.entity_id::text = $${activityParams.length})
    )`);
  }
  const activityWhere = activityScopeFilters.length > 0 ? `WHERE ${activityScopeFilters.join(' AND ')}` : '';

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
    failedJobs,
    recentJobs,
    openReviews,
    upcomingEvents,
    recentActivity,
    integrationResult
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE ${MISSING_COVER_SQL})::int AS missing_covers,
         COUNT(*) FILTER (WHERE ${MISSING_IDENTIFIER_SQL})::int AS missing_identifiers
       FROM media m
       WHERE 1=1${mediaScopeClause}`,
      mediaParams
    ),
    pool.query(
      `SELECT m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.type_details, m.import_source, m.updated_at, m.created_at
       FROM media m
       WHERE ${MISSING_COVER_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 8`,
      mediaParams
    ),
    pool.query(
      `SELECT m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.upc, m.tmdb_id, m.type_details, m.import_source, m.updated_at, m.created_at
       FROM media m
       WHERE ${MISSING_IDENTIFIER_SQL}${mediaScopeClause}
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
    )
  ]);

  const mediaRow = mediaCounts.rows[0] || {};
  const openReviewCount = toCount(openReviews.rows[0]?.open_count);
  const missingCoverCount = toCount(mediaRow.missing_covers);
  const missingIdentifierCount = toCount(mediaRow.missing_identifiers);
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
    }
  ];

  res.json({
    scope: formatScope(scopeContext),
    generated_at: new Date().toISOString(),
    collection: {
      total_items: toCount(mediaRow.total),
      missing_covers: missingCoverCount,
      missing_identifiers: missingIdentifierCount
    },
    attention,
    attention_details: {
      missing_cover_items: missingCoverItems.rows.map(shapeMediaAttentionItem),
      missing_identifier_items: missingIdentifierItems.rows.map((row) => shapeMediaAttentionItem(row, 'missing_identifiers'))
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
