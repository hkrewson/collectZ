'use strict';

function buildCompactJobSummary(summary = null) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return null;
  }

  const compact = {};
  const scalarFields = [
    'imported',
    'rows',
    'created',
    'updated',
    'skipped',
    'skipped_invalid',
    'skipped_non_movie',
    'skipped_existing',
    'errorCount',
    'reviewQueued',
    'collectionsDetected',
    'collectionsCreated',
    'collectionItemsSeeded',
    'tmdbPosterEnriched',
    'tmdbPosterLookupMisses',
    'tmdbPosterLookupNoMatch',
    'tmdbPosterLookupNoImage',
    'variantsCreated',
    'variantsUpdated',
    'seasonsCreated',
    'seasonsUpdated',
    'totalAvailable'
  ];

  for (const field of scalarFields) {
    if (summary[field] !== undefined) compact[field] = summary[field];
  }

  if (summary.matchModes && typeof summary.matchModes === 'object' && !Array.isArray(summary.matchModes)) {
    compact.matchModes = summary.matchModes;
  }
  if (summary.enrichment && typeof summary.enrichment === 'object' && !Array.isArray(summary.enrichment)) {
    compact.enrichment = summary.enrichment;
  }
  if (summary.auditOutcomes && typeof summary.auditOutcomes === 'object' && !Array.isArray(summary.auditOutcomes)) {
    compact.auditOutcomes = summary.auditOutcomes;
  }

  if (Array.isArray(summary.errors)) {
    compact.errorCount = summary.errors.length;
  }
  if (Array.isArray(summary.errorsSample)) {
    compact.errorCount = compact.errorCount ?? summary.errorsSample.length;
  }
  if (Array.isArray(summary.enrichmentErrors)) {
    compact.enrichmentErrorCount = summary.enrichmentErrors.length;
  }
  if (summary.enrichmentErrorCount !== undefined) {
    compact.enrichmentErrorCount = summary.enrichmentErrorCount;
  }
  if (Array.isArray(summary.enrichmentMisses)) {
    compact.enrichmentMissCount = summary.enrichmentMisses.length;
  }
  if (summary.enrichmentMissCount !== undefined) {
    compact.enrichmentMissCount = summary.enrichmentMissCount;
  }

  return compact;
}

function formatSyncJob(job, options = {}) {
  const includeFullSummary = options.includeFullSummary === true;
  if (!job || typeof job !== 'object') return job;
  return {
    id: job.id,
    job_type: job.job_type,
    provider: job.provider,
    status: job.status,
    created_by: job.created_by,
    scope: job.scope,
    progress: job.progress,
    summary: includeFullSummary ? (job.summary || null) : buildCompactJobSummary(job.summary),
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
    created_at: job.created_at,
    updated_at: job.updated_at
  };
}

module.exports = {
  buildCompactJobSummary,
  formatSyncJob
};
