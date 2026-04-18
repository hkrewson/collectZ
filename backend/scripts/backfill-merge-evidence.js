'use strict';

const pool = require('../db/pool');
const { buildPersistedMergeEvidence } = require('../services/bookComicNormalization');

function parseArgs(argv = []) {
  const args = {
    apply: false,
    json: false,
    limit: 100,
    canonicalIds: []
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const value = Number(token.split('=')[1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 500);
      continue;
    }
    if (token === '--limit') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 500);
      i += 1;
      continue;
    }
    if (token.startsWith('--canonical-ids=')) {
      args.canonicalIds = String(token.split('=')[1] || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      continue;
    }
    if (token === '--canonical-ids') {
      args.canonicalIds = String(argv[i + 1] || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      i += 1;
    }
  }
  return args;
}

async function loadBackfillCandidates(client, options = {}) {
  const params = [];
  let where = `WHERE h.repair_type = 'duplicate_attach'
    AND h.reverted_at IS NULL
    AND (h.context IS NULL OR COALESCE(jsonb_typeof(h.context->'mergeEvidence'), 'null') <> 'object')`;
  if (Array.isArray(options.canonicalIds) && options.canonicalIds.length > 0) {
    params.push(options.canonicalIds);
    where += ` AND h.canonical_media_id = ANY($${params.length}::int[])`;
  }
  params.push(options.limit || 100);
  const result = await client.query(
    `SELECT h.canonical_media_id, h.duplicate_media_id, h.context, h.snapshot, h.applied_at, h.repair_type,
            m.id AS canonical_id, m.title AS canonical_title, m.media_type AS canonical_media_type,
            m.import_source AS canonical_import_source, m.type_details AS canonical_type_details
       FROM media_repair_history h
       JOIN media m ON m.id = h.canonical_media_id
      ${where}
      ORDER BY h.applied_at ASC NULLS LAST, h.canonical_media_id ASC, h.duplicate_media_id ASC
      LIMIT $${params.length}`,
    params
  );
  return result.rows || [];
}

function buildCandidateReportRow(row = {}, mergeEvidence = null) {
  return {
    canonical_id: Number(row.canonical_media_id || 0) || null,
    duplicate_id: Number(row.duplicate_media_id || 0) || null,
    media_type: String(row.canonical_media_type || '').trim() || null,
    canonical_title: String(row.canonical_title || '').trim() || null,
    confidence: String(mergeEvidence?.confidence || '').trim() || null,
    kind: String(mergeEvidence?.kind || '').trim() || null,
    merge_key: String(mergeEvidence?.key || '').trim() || null,
    selection_reason: String(mergeEvidence?.canonical_selection?.selection_reason || '').trim() || null,
    applied_at: row.applied_at || null
  };
}

async function runBackfillMergeEvidence(options = {}) {
  const client = await pool.connect();
  try {
    const candidates = await loadBackfillCandidates(client, options);
    const reportRows = [];
    let updated = 0;

    if (options.apply && candidates.length > 0) {
      await client.query('BEGIN');
    }

    try {
      for (const row of candidates) {
        const context = row.context && typeof row.context === 'object' ? { ...row.context } : {};
        const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
        const duplicateMedia = snapshot.media && typeof snapshot.media === 'object' ? snapshot.media : null;
        if (!duplicateMedia) continue;

        const mergeEvidence = buildPersistedMergeEvidence({
          canonicalRow: {
            id: row.canonical_id,
            title: row.canonical_title,
            media_type: row.canonical_media_type,
            import_source: row.canonical_import_source,
            type_details: row.canonical_type_details
          },
          duplicateRow: duplicateMedia,
          previousCanonicalTypeDetails: context.previousCanonicalTypeDetails && typeof context.previousCanonicalTypeDetails === 'object'
            ? context.previousCanonicalTypeDetails
            : row.canonical_type_details
        });
        if (!mergeEvidence) continue;

        reportRows.push(buildCandidateReportRow(row, mergeEvidence));
        if (!options.apply) continue;

        context.mergeEvidence = mergeEvidence;
        await client.query(
          `UPDATE media_repair_history
              SET context = $3::jsonb,
                  updated_at = NOW()
            WHERE canonical_media_id = $1
              AND duplicate_media_id = $2
              AND repair_type = 'duplicate_attach'`,
          [row.canonical_media_id, row.duplicate_media_id, JSON.stringify(context)]
        );
        updated += 1;
      }

      if (options.apply && candidates.length > 0) {
        await client.query('COMMIT');
      }
    } catch (error) {
      if (options.apply && candidates.length > 0) {
        await client.query('ROLLBACK');
      }
      throw error;
    }

    return {
      mode: options.apply ? 'apply' : 'dry-run',
      scanned: candidates.length,
      applicable: reportRows.length,
      updated,
      rows: reportRows
    };
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runBackfillMergeEvidence(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Backfill merge evidence (${result.mode})`);
  console.log(`Scanned: ${result.scanned}`);
  console.log(`Applicable: ${result.applicable}`);
  console.log(`Updated: ${result.updated}`);
  result.rows.forEach((row) => {
    console.log(`- canonical ${row.canonical_id} <- duplicate ${row.duplicate_id} [${row.media_type}] ${row.kind || 'unknown'} ${row.merge_key || ''}`.trim());
  });
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.stack || error.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  runBackfillMergeEvidence
};
