'use strict';

const pool = require('../db/pool');
const { detectLikelyComicLikeBook } = require('../services/bookComicNormalization');
const { parseComicTitleMetadata } = require('../services/cwa');
const { normalizeTypeDetails } = require('../services/typeDetails');

function parseArgs(argv = []) {
  const args = {
    apply: false,
    revert: false,
    json: false,
    ids: [],
    libraryId: null,
    limit: 100
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--revert') {
      args.revert = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token.startsWith('--ids=')) {
      args.ids = String(token.split('=')[1] || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      continue;
    }
    if (token === '--ids') {
      args.ids = String(argv[i + 1] || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      i += 1;
      continue;
    }
    if (token.startsWith('--library-id=')) {
      const value = Number(token.split('=')[1]);
      if (Number.isFinite(value) && value > 0) args.libraryId = value;
      continue;
    }
    if (token === '--library-id') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.libraryId = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const value = Number(token.split('=')[1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 5000);
      continue;
    }
    if (token === '--limit') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 5000);
      i += 1;
    }
  }
  if (args.apply && args.revert) {
    throw new Error('Use either --apply or --revert, not both');
  }
  return args;
}

function parseComicMetadataFromTitle(rawTitle = '') {
  const title = String(rawTitle || '').trim();
  if (!title) return { series: null, issue_number: null, volume: null, cover_date: null };

  let workingTitle = title;
  let coverDate = null;
  const yearPrefix = workingTitle.match(/^\(((?:18|19|20)\d{2})\)\s+(.+)$/);
  if (yearPrefix) {
    coverDate = `${yearPrefix[1]}-01-01`;
    workingTitle = String(yearPrefix[2] || '').trim();
  }

  const volumeHashMatch = workingTitle.match(/^(.+?)\s+v(?:ol(?:ume)?)?\s*([0-9]+)\s+#\s*([A-Za-z0-9.-]+)(?:\s*(?::|-|–)\s*.*)?$/i);
  if (volumeHashMatch) {
    return {
      series: String(volumeHashMatch[1] || '').trim() || null,
      volume: String(volumeHashMatch[2] || '').trim() || null,
      issue_number: String(volumeHashMatch[3] || '').trim() || null,
      cover_date: coverDate
    };
  }

  const parsed = parseComicTitleMetadata(workingTitle);
  return {
    series: parsed.series || null,
    issue_number: parsed.issue_number || null,
    volume: parsed.volume || null,
    cover_date: coverDate
  };
}

function buildComicLikeBookProposal(row = {}) {
  const signal = detectLikelyComicLikeBook(row);
  if (!signal?.likely) return null;

  const existingTypeDetails = row.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const inferred = parseComicMetadataFromTitle(row.title);
  const nextTypeDetailsRaw = {
    ...existingTypeDetails,
    series: existingTypeDetails.series || inferred.series || null,
    issue_number: existingTypeDetails.issue_number || inferred.issue_number || null,
    volume: existingTypeDetails.volume || inferred.volume || null,
    cover_date: existingTypeDetails.cover_date || inferred.cover_date || null
  };
  if (!nextTypeDetailsRaw.issue_number || !(nextTypeDetailsRaw.series || existingTypeDetails.provider_item_id || existingTypeDetails.calibre_entry_id)) {
    return null;
  }

  const normalized = normalizeTypeDetails('comic_book', nextTypeDetailsRaw, { strict: true });
  if (normalized.errors.length > 0) {
    return {
      action: 'skip_invalid_proposal',
      source: row,
      reasons: signal.reasons,
      errors: normalized.errors
    };
  }

  return {
    action: 'reclassify_book_to_comic',
    confidence: 'review',
    reasons: signal.reasons,
    source: row,
    proposed_media_type: 'comic_book',
    proposed_type_details: normalized.value || {}
  };
}

function summarizeProposal(proposal = {}) {
  const row = proposal.source || {};
  return {
    id: Number(row.id || 0) || null,
    title: String(row.title || '').trim() || null,
    from_media_type: String(row.media_type || '').trim() || null,
    to_media_type: proposal.proposed_media_type || null,
    import_source: String(row.import_source || '').trim() || null,
    reasons: Array.isArray(proposal.reasons) ? proposal.reasons : [],
    proposed_type_details: proposal.proposed_type_details || {},
    skipped: proposal.action === 'skip_invalid_proposal',
    errors: proposal.errors || []
  };
}

function buildWhereClause({ ids = [], libraryId = null, mediaType = 'book', tableAlias = '' }) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const params = [mediaType];
  const conditions = [`${prefix}media_type = $1`];
  if (libraryId) {
    params.push(libraryId);
    conditions.push(`${prefix}library_id = $${params.length}`);
  }
  if (Array.isArray(ids) && ids.length > 0) {
    params.push(ids);
    conditions.push(`${prefix}id = ANY($${params.length}::int[])`);
  }
  return {
    params,
    where: `WHERE ${conditions.join(' AND ')}`
  };
}

function safeJsonParseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildComicLikeBookRevertProposal(row = {}) {
  const previousMediaType = String(row.historical_repair_previous_media_type || '').trim();
  const previousTypeDetails = safeJsonParseObject(row.historical_repair_previous_type_details);
  const action = String(row.historical_repair_action || '').trim();
  if (action !== 'reclassify_book_to_comic') return null;
  if (previousMediaType !== 'book') return null;
  return {
    action: 'revert_comic_to_book',
    confidence: 'high',
    source: row,
    proposed_media_type: previousMediaType,
    proposed_type_details: previousTypeDetails
  };
}

async function upsertRepairMetadata(client, mediaId, key, value) {
  await client.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     VALUES ($1::int, $2::varchar, $3::text)
     ON CONFLICT (media_id, "key")
     DO UPDATE SET "value" = EXCLUDED."value"`,
    [mediaId, key, value]
  );
}

async function runRepairComicLikeBooks(options = {}) {
  const revertMode = Boolean(options.revert);
  const { params, where } = buildWhereClause({
    ...options,
    mediaType: revertMode ? 'comic_book' : 'book',
    tableAlias: revertMode ? 'm' : ''
  });
  params.push(options.limit || 100);

  const rowsResult = revertMode
    ? await pool.query(
      `SELECT m.id, m.title, m.media_type, m.import_source, m.library_id, m.space_id, m.type_details,
              prev_type.value AS historical_repair_previous_media_type,
              prev_details.value AS historical_repair_previous_type_details,
              repair_action.value AS historical_repair_action
         FROM media m
         LEFT JOIN media_metadata prev_type
           ON prev_type.media_id = m.id
          AND prev_type."key" = 'historical_repair_previous_media_type'
         LEFT JOIN media_metadata prev_details
           ON prev_details.media_id = m.id
          AND prev_details."key" = 'historical_repair_previous_type_details'
         LEFT JOIN media_metadata repair_action
           ON repair_action.media_id = m.id
          AND repair_action."key" = 'historical_repair_action'
         ${where}
        ORDER BY m.id ASC
        LIMIT $${params.length}`,
      params
    )
    : await pool.query(
      `SELECT id, title, media_type, import_source, library_id, space_id, type_details
         FROM media
         ${where}
        ORDER BY id ASC
        LIMIT $${params.length}`,
      params
    );

  const rows = rowsResult.rows || [];
  const proposals = rows
    .map(revertMode ? buildComicLikeBookRevertProposal : buildComicLikeBookProposal)
    .filter(Boolean);

  const applicable = proposals.filter((proposal) => proposal.action === (revertMode ? 'revert_comic_to_book' : 'reclassify_book_to_comic'));
  const skipped = proposals.filter((proposal) => proposal.action !== (revertMode ? 'revert_comic_to_book' : 'reclassify_book_to_comic'));
  let updated = 0;

  if ((options.apply || options.revert) && applicable.length > 0) {
    await pool.query('BEGIN');
    try {
      for (const proposal of applicable) {
        const row = proposal.source;
        if (!revertMode) {
          await upsertRepairMetadata(pool, row.id, 'historical_repair_previous_media_type', String(row.media_type || ''));
          await upsertRepairMetadata(pool, row.id, 'historical_repair_previous_type_details', JSON.stringify(row.type_details || {}));
          await upsertRepairMetadata(pool, row.id, 'historical_repair_action', 'reclassify_book_to_comic');
          await upsertRepairMetadata(pool, row.id, 'historical_repair_applied_at', new Date().toISOString());
        } else {
          await upsertRepairMetadata(pool, row.id, 'historical_repair_reverted_at', new Date().toISOString());
        }
        await pool.query(
          `UPDATE media
           SET media_type = $2,
               type_details = $3::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, proposal.proposed_media_type, JSON.stringify(proposal.proposed_type_details || {})]
        );
        updated += 1;
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  return {
    mode: revertMode ? 'revert' : (options.apply ? 'apply' : 'dry-run'),
    scanned: rows.length,
    applicable: applicable.length,
    skipped: skipped.length,
    updated,
    sample: applicable.slice(0, Math.min(options.limit || 100, 20)).map(summarizeProposal),
    skippedSample: skipped.slice(0, 10).map(summarizeProposal)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRepairComicLikeBooks(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
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
  parseComicMetadataFromTitle,
  buildComicLikeBookProposal,
  buildComicLikeBookRevertProposal,
  runRepairComicLikeBooks
};
