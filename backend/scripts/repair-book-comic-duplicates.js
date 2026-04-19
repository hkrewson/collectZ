'use strict';

const pool = require('../db/pool');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  chooseCanonicalRow,
  buildDuplicateRepairPlan,
  buildPersistedMergeEvidence
} = require('../services/bookComicNormalization');
const { buildMergedOwnedFormatsPayload } = require('../services/mediaFormats');

function parseArgs(argv = []) {
  const args = {
    apply: false,
    revert: false,
    json: false,
    ids: [],
    canonicalId: null
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
    if (token.startsWith('--canonical-id=')) {
      const value = Number(token.split('=')[1]);
      if (Number.isFinite(value) && value > 0) args.canonicalId = value;
      continue;
    }
    if (token === '--canonical-id') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.canonicalId = value;
      i += 1;
    }
  }
  if (args.ids.length < 2) {
    throw new Error('Provide at least two ids with --ids for duplicate attach repair');
  }
  if (args.apply && args.revert) {
    throw new Error('Use either --apply or --revert, not both');
  }
  return args;
}

function toPlainTypeDetails(typeDetails) {
  return typeDetails && typeof typeDetails === 'object' ? typeDetails : {};
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function mergeMissingObjectFields(base = {}, extra = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (!(key in merged) || isBlank(merged[key])) {
      merged[key] = value;
    }
  }
  return merged;
}

function buildMergedFormatState(canonicalRow = {}, duplicateRow = {}) {
  return buildMergedOwnedFormatsPayload(
    canonicalRow.media_type || duplicateRow.media_type || 'movie',
    canonicalRow.owned_formats,
    canonicalRow.format,
    duplicateRow.owned_formats,
    duplicateRow.format
  );
}

function buildClusterFromRows(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const mediaTypes = Array.from(new Set(rows.map((row) => String(row.media_type || '').trim()).filter(Boolean)));
  if (mediaTypes.length !== 1) {
    throw new Error(`Duplicate attach rows must share one media_type, got ${mediaTypes.join(', ')}`);
  }
  const builder = mediaTypes[0] === 'comic_book'
    ? buildComicNormalizationIdentity
    : buildBookNormalizationIdentity;
  const identities = rows.map((row) => ({ row, identity: builder(row) }));
  const first = identities[0]?.identity || null;
  if (!first?.key || first.confidence !== 'high') {
    throw new Error('Duplicate attach repair currently supports only high-confidence clusters');
  }
  const mismatched = identities.find(({ identity }) => !identity || identity.key !== first.key || identity.confidence !== 'high');
  if (mismatched) {
    throw new Error(`Rows do not share one high-confidence normalization identity: ${JSON.stringify({ id: mismatched.row?.id, key: mismatched.identity?.key, confidence: mismatched.identity?.confidence })}`);
  }
  return {
    key: first.key,
    confidence: first.confidence,
    kind: first.kind,
    rationale: first.rationale,
    rows
  };
}

async function loadRows(client, ids = []) {
  const result = await client.query(
    `SELECT id, title, media_type, import_source, library_id, space_id, type_details,
            original_title, release_date, year, format, owned_formats, genre, director, cast_members,
            rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path,
            overview, trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at,
            signed_proof_path, location, notes, estimated_value_low, estimated_value_mid,
            estimated_value_high, valuation_currency, valuation_source, valuation_last_updated,
            series_id, added_by, created_at, updated_at
       FROM media
      WHERE id = ANY($1::int[])
      ORDER BY id ASC`,
    [ids]
  );
  return result.rows || [];
}

async function upsertCanonicalMetadata(client, mediaId, key, value) {
  await client.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     VALUES ($1::int, $2::varchar, $3::text)
     ON CONFLICT (media_id, "key")
     DO UPDATE SET "value" = EXCLUDED."value"`,
    [mediaId, key, value]
  );
}

async function upsertDuplicateAttachHistory(client, canonicalMediaId, duplicateMediaId, snapshot, context) {
  await client.query(
    `INSERT INTO media_repair_history (
       canonical_media_id, duplicate_media_id, repair_type, snapshot, context, applied_at, updated_at
     ) VALUES (
       $1, $2, 'duplicate_attach', $3::jsonb, $4::jsonb, NOW(), NOW()
     )
     ON CONFLICT (canonical_media_id, duplicate_media_id, repair_type)
     DO UPDATE SET
       snapshot = EXCLUDED.snapshot,
       context = EXCLUDED.context,
       applied_at = NOW(),
       updated_at = NOW(),
       reverted_at = NULL`,
    [canonicalMediaId, duplicateMediaId, JSON.stringify(snapshot), JSON.stringify(context)]
  );
}

async function getDuplicateAttachHistory(client, canonicalMediaId, duplicateMediaId) {
  const result = await client.query(
    `SELECT canonical_media_id, duplicate_media_id, repair_type, snapshot, context, applied_at, reverted_at
       FROM media_repair_history
      WHERE canonical_media_id = $1
        AND duplicate_media_id = $2
        AND repair_type = 'duplicate_attach'
      LIMIT 1`,
    [canonicalMediaId, duplicateMediaId]
  );
  return result.rows[0] || null;
}

async function listActiveDuplicateAttachHistories(client, canonicalMediaId, options = {}) {
  const excludedDuplicateId = Number(options.excludeDuplicateId || 0);
  const result = await client.query(
    `SELECT canonical_media_id, duplicate_media_id, repair_type, snapshot, context, applied_at, reverted_at
       FROM media_repair_history
      WHERE canonical_media_id = $1
        AND repair_type = 'duplicate_attach'
        AND reverted_at IS NULL
        AND ($2::int = 0 OR duplicate_media_id <> $2)
      ORDER BY applied_at ASC NULLS LAST, duplicate_media_id ASC`,
    [canonicalMediaId, excludedDuplicateId]
  );
  return result.rows || [];
}

async function getExistingDuplicateAttachHistory(client, canonicalMediaId, duplicateMediaId) {
  const history = await getDuplicateAttachHistory(client, canonicalMediaId, duplicateMediaId);
  if (history && !history.reverted_at) {
    return history;
  }

  const snapshotKey = `historical_duplicate_attach_snapshot_${duplicateMediaId}`;
  const contextKey = `historical_duplicate_attach_context_${duplicateMediaId}`;
  const revertedKey = `historical_duplicate_attach_reverted_at_${duplicateMediaId}`;
  const result = await client.query(
    `SELECT "key", "value"
       FROM media_metadata
      WHERE media_id = $1
        AND "key" = ANY($2::varchar[])`,
    [canonicalMediaId, [snapshotKey, contextKey, revertedKey]]
  );
  const metadataByKey = new Map((result.rows || []).map((row) => [row.key, row.value]));
  if (!metadataByKey.has(snapshotKey) || !metadataByKey.has(contextKey) || metadataByKey.has(revertedKey)) {
    return null;
  }
  return {
    canonical_media_id: Number(canonicalMediaId),
    duplicate_media_id: Number(duplicateMediaId),
    repair_type: 'duplicate_attach',
    applied_at: null,
    reverted_at: null
  };
}

async function markDuplicateAttachHistoryReverted(client, canonicalMediaId, duplicateMediaId) {
  await client.query(
    `UPDATE media_repair_history
        SET reverted_at = NOW(),
            updated_at = NOW()
      WHERE canonical_media_id = $1
        AND duplicate_media_id = $2
        AND repair_type = 'duplicate_attach'`,
    [canonicalMediaId, duplicateMediaId]
  );
}

async function deleteCanonicalMetadata(client, mediaId, key) {
  await client.query(
    `DELETE FROM media_metadata
      WHERE media_id = $1
        AND "key" = $2`,
    [mediaId, key]
  );
}

async function getCanonicalMetadataEntries(client, mediaId, keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const result = await client.query(
    `SELECT "key", "value"
       FROM media_metadata
      WHERE media_id = $1
        AND "key" = ANY($2::varchar[])
      ORDER BY "key" ASC`,
    [mediaId, keys]
  );
  return result.rows || [];
}

async function getCanonicalRelationState(client, canonicalId, duplicateSnapshot) {
  const metadataKeys = (duplicateSnapshot?.media_metadata || []).map((entry) => entry.key).filter(Boolean);
  const duplicateSeasonNumbers = (duplicateSnapshot?.media_seasons || [])
    .map((row) => Number(row.season_number))
    .filter((value) => Number.isFinite(value));
  const duplicateGenreIds = (duplicateSnapshot?.media_genres || [])
    .map((row) => Number(row.genre_id))
    .filter((value) => Number.isFinite(value));
  const duplicateDirectorIds = (duplicateSnapshot?.media_directors || [])
    .map((row) => Number(row.director_id))
    .filter((value) => Number.isFinite(value));
  const duplicateActorIds = (duplicateSnapshot?.media_actors || [])
    .map((row) => Number(row.actor_id))
    .filter((value) => Number.isFinite(value));

  const metadata = await getCanonicalMetadataEntries(client, canonicalId, metadataKeys);
  const seasons = duplicateSeasonNumbers.length
    ? (await client.query(
        `SELECT season_number
           FROM media_seasons
          WHERE media_id = $1
            AND season_number = ANY($2::int[])
          ORDER BY season_number ASC`,
        [canonicalId, duplicateSeasonNumbers]
      )).rows
    : [];
  const genres = duplicateGenreIds.length
    ? (await client.query(
        `SELECT genre_id
           FROM media_genres
          WHERE media_id = $1
            AND genre_id = ANY($2::int[])
          ORDER BY genre_id ASC`,
        [canonicalId, duplicateGenreIds]
      )).rows
    : [];
  const directors = duplicateDirectorIds.length
    ? (await client.query(
        `SELECT director_id
           FROM media_directors
          WHERE media_id = $1
            AND director_id = ANY($2::int[])
          ORDER BY director_id ASC`,
        [canonicalId, duplicateDirectorIds]
      )).rows
    : [];
  const actors = duplicateActorIds.length
    ? (await client.query(
        `SELECT actor_id
           FROM media_actors
          WHERE media_id = $1
            AND actor_id = ANY($2::int[])
          ORDER BY actor_id ASC`,
        [canonicalId, duplicateActorIds]
      )).rows
    : [];

  return {
    canonicalTypeDetails: null,
    canonicalFormat: null,
    canonicalOwnedFormats: [],
    canonicalMetadata: metadata,
    canonicalSeasonNumbers: seasons.map((row) => Number(row.season_number)).filter((value) => Number.isFinite(value)),
    canonicalGenreIds: genres.map((row) => Number(row.genre_id)).filter((value) => Number.isFinite(value)),
    canonicalDirectorIds: directors.map((row) => Number(row.director_id)).filter((value) => Number.isFinite(value)),
    canonicalActorIds: actors.map((row) => Number(row.actor_id)).filter((value) => Number.isFinite(value))
  };
}

function buildAttachContext({ duplicateSnapshot, canonicalRow, canonicalRelationState }) {
  return {
    duplicateSnapshot,
    previousCanonicalTypeDetails: toPlainTypeDetails(canonicalRow.type_details),
    previousCanonicalFormat: canonicalRelationState.canonicalFormat ?? canonicalRow.format ?? null,
    previousCanonicalOwnedFormats: Array.isArray(canonicalRelationState.canonicalOwnedFormats)
      ? canonicalRelationState.canonicalOwnedFormats
      : (Array.isArray(canonicalRow.owned_formats) ? canonicalRow.owned_formats : []),
    previousCanonicalMetadata: canonicalRelationState.canonicalMetadata || [],
    previousCanonicalSeasonNumbers: canonicalRelationState.canonicalSeasonNumbers || [],
    previousCanonicalGenreIds: canonicalRelationState.canonicalGenreIds || [],
    previousCanonicalDirectorIds: canonicalRelationState.canonicalDirectorIds || [],
    previousCanonicalActorIds: canonicalRelationState.canonicalActorIds || []
  };
}

async function snapshotDuplicateState(client, duplicateId) {
  const mediaRow = await client.query('SELECT * FROM media WHERE id = $1', [duplicateId]);
  const metadataRows = await client.query('SELECT "key", "value", created_at FROM media_metadata WHERE media_id = $1 ORDER BY id ASC', [duplicateId]);
  const variantRows = await client.query('SELECT * FROM media_variants WHERE media_id = $1 ORDER BY id ASC', [duplicateId]);
  const seasonRows = await client.query('SELECT * FROM media_seasons WHERE media_id = $1 ORDER BY id ASC', [duplicateId]);
  const genreRows = await client.query('SELECT genre_id FROM media_genres WHERE media_id = $1 ORDER BY genre_id ASC', [duplicateId]);
  const directorRows = await client.query('SELECT director_id FROM media_directors WHERE media_id = $1 ORDER BY director_id ASC', [duplicateId]);
  const actorRows = await client.query('SELECT actor_id FROM media_actors WHERE media_id = $1 ORDER BY actor_id ASC', [duplicateId]);
  const collectionRows = await client.query('SELECT * FROM collection_items WHERE media_id = $1 ORDER BY id ASC', [duplicateId]);
  const seriesRows = await client.query('SELECT id FROM media WHERE series_id = $1 ORDER BY id ASC', [duplicateId]);

  return {
    media: mediaRow.rows[0] || null,
    media_metadata: metadataRows.rows || [],
    media_variants: variantRows.rows || [],
    media_seasons: seasonRows.rows || [],
    media_genres: genreRows.rows || [],
    media_directors: directorRows.rows || [],
    media_actors: actorRows.rows || [],
    collection_items: collectionRows.rows || [],
    child_series_refs: seriesRows.rows || []
  };
}

async function mergeDuplicateMetadataIntoCanonical(client, canonicalId, duplicateId) {
  const result = await client.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     SELECT $1::int, mm."key", mm."value"
       FROM media_metadata mm
      WHERE mm.media_id = $2
        AND mm."key" NOT LIKE 'historical_%'
     ON CONFLICT (media_id, "key") DO NOTHING`,
    [canonicalId, duplicateId]
  );
  return Number(result.rowCount || 0);
}

async function mergeDuplicateTaxonomyIntoCanonical(client, canonicalId, duplicateId) {
  const genres = await client.query(
    `INSERT INTO media_genres (media_id, genre_id)
     SELECT $1::int, genre_id
     FROM media_genres
     WHERE media_id = $2
     ON CONFLICT (media_id, genre_id) DO NOTHING`,
    [canonicalId, duplicateId]
  );
  const directors = await client.query(
    `INSERT INTO media_directors (media_id, director_id)
     SELECT $1::int, director_id
     FROM media_directors
     WHERE media_id = $2
     ON CONFLICT (media_id, director_id) DO NOTHING`,
    [canonicalId, duplicateId]
  );
  const actors = await client.query(
    `INSERT INTO media_actors (media_id, actor_id)
     SELECT $1::int, actor_id
     FROM media_actors
     WHERE media_id = $2
     ON CONFLICT (media_id, actor_id) DO NOTHING`,
    [canonicalId, duplicateId]
  );
  return {
    genres: Number(genres.rowCount || 0),
    directors: Number(directors.rowCount || 0),
    actors: Number(actors.rowCount || 0)
  };
}

async function mergeDuplicateSeasonsIntoCanonical(client, canonicalId, duplicateId) {
  const inserted = await client.query(
    `INSERT INTO media_seasons (
       media_id, season_number, expected_episodes, available_episodes, is_complete,
       watch_state, watchlist, last_watched_at, source
     )
     SELECT $1::int, season_number, expected_episodes, available_episodes, is_complete,
            watch_state, watchlist, last_watched_at, source
       FROM media_seasons
      WHERE media_id = $2
     ON CONFLICT (media_id, season_number) DO NOTHING`,
    [canonicalId, duplicateId]
  );
  await client.query('DELETE FROM media_seasons WHERE media_id = $1', [duplicateId]);
  return Number(inserted.rowCount || 0);
}

async function rewireDuplicateReferences(client, canonicalId, duplicateId) {
  const collectionItems = await client.query('UPDATE collection_items SET media_id = $1, updated_at = NOW() WHERE media_id = $2', [canonicalId, duplicateId]);
  const variants = await client.query('UPDATE media_variants SET media_id = $1, updated_at = NOW() WHERE media_id = $2', [canonicalId, duplicateId]);
  const seriesRefs = await client.query('UPDATE media SET series_id = $1, updated_at = NOW() WHERE series_id = $2', [canonicalId, duplicateId]);
  return {
    collectionItems: Number(collectionItems.rowCount || 0),
    variants: Number(variants.rowCount || 0),
    seriesRefs: Number(seriesRefs.rowCount || 0)
  };
}

async function mergeDuplicateIntoCanonical(client, canonicalRow, duplicateRow, mergeEvidence = null) {
  const canonicalTypeDetails = toPlainTypeDetails(canonicalRow.type_details);
  const duplicateTypeDetails = toPlainTypeDetails(duplicateRow.type_details);
  const mergedTypeDetails = mergeMissingObjectFields(canonicalTypeDetails, duplicateTypeDetails);
  const mergedFormatState = buildMergedFormatState(canonicalRow, duplicateRow);

  const snapshot = await snapshotDuplicateState(client, duplicateRow.id);
  const canonicalRelationState = await getCanonicalRelationState(client, canonicalRow.id, snapshot);
  canonicalRelationState.canonicalTypeDetails = canonicalTypeDetails;
  canonicalRelationState.canonicalFormat = canonicalRow.format || null;
  canonicalRelationState.canonicalOwnedFormats = Array.isArray(canonicalRow.owned_formats)
    ? canonicalRow.owned_formats
    : [];

  await client.query(
    `UPDATE media
     SET type_details = $2::jsonb,
         format = $3,
         owned_formats = $4::text[],
         updated_at = NOW()
     WHERE id = $1`,
    [canonicalRow.id, JSON.stringify(mergedTypeDetails), mergedFormatState.format, mergedFormatState.ownedFormats]
  );

  const attachContext = buildAttachContext({
    duplicateSnapshot: snapshot,
    canonicalRow,
    canonicalRelationState
  });
  attachContext.mergeEvidence = mergeEvidence && typeof mergeEvidence === 'object'
    ? mergeEvidence
    : null;
  await upsertDuplicateAttachHistory(client, canonicalRow.id, duplicateRow.id, snapshot, attachContext);

  const mergedMetadataEntries = await mergeDuplicateMetadataIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const mergedTaxonomy = await mergeDuplicateTaxonomyIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const mergedSeasons = await mergeDuplicateSeasonsIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const rewired = await rewireDuplicateReferences(client, canonicalRow.id, duplicateRow.id);

  await client.query('DELETE FROM media WHERE id = $1', [duplicateRow.id]);

  return {
    duplicateId: Number(duplicateRow.id || 0) || null,
    historyStored: true,
    mergedMetadataEntries,
    mergedTaxonomy,
    mergedSeasons,
    rewired
  };
}

function parseJsonText(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildCanonicalMetadataMap(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.key) continue;
    map.set(String(entry.key), entry.value);
  }
  return map;
}

async function restoreDuplicateMediaRow(client, mediaRow) {
  if (!mediaRow?.id) {
    throw new Error('Missing duplicate media snapshot row for revert');
  }
  await client.query(
    `INSERT INTO media (
       id, title, media_type, original_title, release_date, year, format, owned_formats, genre,
       director, cast_members, rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url,
       poster_path, backdrop_path, overview, trailer_url, runtime, upc, signed_by, signed_role,
       signed_on, signed_at, signed_proof_path, location, notes, estimated_value_low,
       estimated_value_mid, estimated_value_high, valuation_currency, valuation_source,
       valuation_last_updated, type_details, library_id, space_id, series_id, import_source,
       added_by, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
       $31, $32, $33, $34, $35, $36::jsonb, $37, $38, $39, $40, $41, $42, $43
     )`,
    [
      mediaRow.id,
      mediaRow.title,
      mediaRow.media_type,
      mediaRow.original_title,
      mediaRow.release_date,
      mediaRow.year,
      mediaRow.format,
      Array.isArray(mediaRow.owned_formats) ? mediaRow.owned_formats : null,
      mediaRow.genre,
      mediaRow.director,
      mediaRow.cast_members,
      mediaRow.rating,
      mediaRow.user_rating,
      mediaRow.tmdb_id,
      mediaRow.tmdb_media_type,
      mediaRow.tmdb_url,
      mediaRow.poster_path,
      mediaRow.backdrop_path,
      mediaRow.overview,
      mediaRow.trailer_url,
      mediaRow.runtime,
      mediaRow.upc,
      mediaRow.signed_by,
      mediaRow.signed_role,
      mediaRow.signed_on,
      mediaRow.signed_at,
      mediaRow.signed_proof_path,
      mediaRow.location,
      mediaRow.notes,
      mediaRow.estimated_value_low,
      mediaRow.estimated_value_mid,
      mediaRow.estimated_value_high,
      mediaRow.valuation_currency,
      mediaRow.valuation_source,
      mediaRow.valuation_last_updated,
      JSON.stringify(mediaRow.type_details || {}),
      mediaRow.library_id,
      mediaRow.space_id,
      mediaRow.series_id,
      mediaRow.import_source,
      mediaRow.added_by,
      mediaRow.created_at,
      mediaRow.updated_at
    ]
  );
}

async function restoreDuplicateMetadata(client, duplicateId, metadataEntries = []) {
  for (const entry of metadataEntries) {
    await client.query(
      `INSERT INTO media_metadata (media_id, "key", "value", created_at)
       VALUES ($1, $2, $3, COALESCE($4, NOW()))
       ON CONFLICT (media_id, "key")
       DO UPDATE SET "value" = EXCLUDED."value"`,
      [duplicateId, entry.key, entry.value, entry.created_at || null]
    );
  }
}

async function restoreDuplicateVariants(client, duplicateId, variantRows = []) {
  for (const row of variantRows) {
    await client.query(
      `INSERT INTO media_variants (
         id, media_id, variant_key, variant_label, variant_type, source, provider_id,
         provider_key, release_date, release_year, artwork_url, metadata, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14
       )
       ON CONFLICT (id)
       DO UPDATE SET
         media_id = EXCLUDED.media_id,
         variant_key = EXCLUDED.variant_key,
         variant_label = EXCLUDED.variant_label,
         variant_type = EXCLUDED.variant_type,
         source = EXCLUDED.source,
         provider_id = EXCLUDED.provider_id,
         provider_key = EXCLUDED.provider_key,
         release_date = EXCLUDED.release_date,
         release_year = EXCLUDED.release_year,
         artwork_url = EXCLUDED.artwork_url,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        duplicateId,
        row.variant_key,
        row.variant_label,
        row.variant_type,
        row.source,
        row.provider_id,
        row.provider_key,
        row.release_date,
        row.release_year,
        row.artwork_url,
        JSON.stringify(row.metadata || {}),
        row.created_at,
        row.updated_at
      ]
    );
  }
}

async function restoreDuplicateSeasons(client, duplicateId, seasonRows = []) {
  for (const row of seasonRows) {
    await client.query(
      `INSERT INTO media_seasons (
         id, media_id, season_number, expected_episodes, available_episodes, is_complete,
         watch_state, watchlist, last_watched_at, source, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       ON CONFLICT (id)
       DO UPDATE SET
         media_id = EXCLUDED.media_id,
         season_number = EXCLUDED.season_number,
         expected_episodes = EXCLUDED.expected_episodes,
         available_episodes = EXCLUDED.available_episodes,
         is_complete = EXCLUDED.is_complete,
         watch_state = EXCLUDED.watch_state,
         watchlist = EXCLUDED.watchlist,
         last_watched_at = EXCLUDED.last_watched_at,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        duplicateId,
        row.season_number,
        row.expected_episodes,
        row.available_episodes,
        row.is_complete,
        row.watch_state,
        row.watchlist,
        row.last_watched_at,
        row.source,
        row.created_at,
        row.updated_at
      ]
    );
  }
}

async function restoreDuplicateTaxonomy(client, duplicateId, snapshot = {}) {
  for (const row of snapshot.media_genres || []) {
    await client.query(
      `INSERT INTO media_genres (media_id, genre_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, genre_id) DO NOTHING`,
      [duplicateId, row.genre_id]
    );
  }
  for (const row of snapshot.media_directors || []) {
    await client.query(
      `INSERT INTO media_directors (media_id, director_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, director_id) DO NOTHING`,
      [duplicateId, row.director_id]
    );
  }
  for (const row of snapshot.media_actors || []) {
    await client.query(
      `INSERT INTO media_actors (media_id, actor_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, actor_id) DO NOTHING`,
      [duplicateId, row.actor_id]
    );
  }
}

async function restoreDuplicateReferences(client, duplicateId, snapshot = {}) {
  const collectionItemIds = (snapshot.collection_items || []).map((row) => Number(row.id)).filter((value) => Number.isFinite(value));
  if (collectionItemIds.length > 0) {
    await client.query(
      `UPDATE collection_items
          SET media_id = $1,
              updated_at = NOW()
        WHERE id = ANY($2::int[])`,
      [duplicateId, collectionItemIds]
    );
  }

  const variantIds = (snapshot.media_variants || []).map((row) => Number(row.id)).filter((value) => Number.isFinite(value));
  if (variantIds.length > 0) {
    await client.query(
      `UPDATE media_variants
          SET media_id = $1,
              updated_at = NOW()
        WHERE id = ANY($2::int[])`,
      [duplicateId, variantIds]
    );
  }

  const childSeriesRefIds = (snapshot.child_series_refs || []).map((row) => Number(row.id)).filter((value) => Number.isFinite(value));
  if (childSeriesRefIds.length > 0) {
    await client.query(
      `UPDATE media
          SET series_id = $1,
              updated_at = NOW()
        WHERE id = ANY($2::int[])`,
      [duplicateId, childSeriesRefIds]
    );
  }
}

async function revertCanonicalTypeDetails(
  client,
  canonicalId,
  previousCanonicalTypeDetails,
  previousCanonicalFormat = null,
  previousCanonicalOwnedFormats = []
) {
  await client.query(
    `UPDATE media
        SET type_details = $2::jsonb,
            format = $3,
            owned_formats = $4::text[],
            updated_at = NOW()
      WHERE id = $1`,
    [
      canonicalId,
      JSON.stringify(previousCanonicalTypeDetails || {}),
      previousCanonicalFormat,
      Array.isArray(previousCanonicalOwnedFormats) ? previousCanonicalOwnedFormats : []
    ]
  );
}

function rebuildCanonicalFormatStateAfterRevert(canonicalRow, revertContext = {}, remainingHistories = []) {
  let state = {
    media_type: canonicalRow.media_type || 'movie',
    format: revertContext.previousCanonicalFormat || null,
    owned_formats: Array.isArray(revertContext.previousCanonicalOwnedFormats)
      ? revertContext.previousCanonicalOwnedFormats
      : []
  };

  for (const history of remainingHistories) {
    const remainingSnapshotMedia = history?.snapshot?.media || null;
    if (!remainingSnapshotMedia) continue;
    const mergedState = buildMergedFormatState(state, remainingSnapshotMedia);
    state = {
      media_type: state.media_type,
      format: mergedState.format,
      owned_formats: mergedState.ownedFormats
    };
  }

  return state;
}

async function revertCanonicalMetadata(client, canonicalId, snapshot = {}, previousCanonicalMetadata = []) {
  const previousMap = buildCanonicalMetadataMap(previousCanonicalMetadata);
  for (const entry of snapshot.media_metadata || []) {
    if (!entry?.key || String(entry.key).startsWith('historical_')) continue;
    if (previousMap.has(entry.key)) {
      await upsertCanonicalMetadata(client, canonicalId, entry.key, previousMap.get(entry.key));
    } else {
      await deleteCanonicalMetadata(client, canonicalId, entry.key);
    }
  }
}

async function revertCanonicalTaxonomyAndSeasons(client, canonicalId, snapshot = {}, context = {}) {
  const previousSeasonNumbers = new Set((context.previousCanonicalSeasonNumbers || []).map((value) => Number(value)));
  for (const row of snapshot.media_seasons || []) {
    const seasonNumber = Number(row.season_number);
    if (!previousSeasonNumbers.has(seasonNumber)) {
      await client.query(
        `DELETE FROM media_seasons
          WHERE media_id = $1
            AND season_number = $2`,
        [canonicalId, seasonNumber]
      );
    }
  }

  const previousGenreIds = new Set((context.previousCanonicalGenreIds || []).map((value) => Number(value)));
  for (const row of snapshot.media_genres || []) {
    const genreId = Number(row.genre_id);
    if (!previousGenreIds.has(genreId)) {
      await client.query(
        `DELETE FROM media_genres
          WHERE media_id = $1
            AND genre_id = $2`,
        [canonicalId, genreId]
      );
    }
  }

  const previousDirectorIds = new Set((context.previousCanonicalDirectorIds || []).map((value) => Number(value)));
  for (const row of snapshot.media_directors || []) {
    const directorId = Number(row.director_id);
    if (!previousDirectorIds.has(directorId)) {
      await client.query(
        `DELETE FROM media_directors
          WHERE media_id = $1
            AND director_id = $2`,
        [canonicalId, directorId]
      );
    }
  }

  const previousActorIds = new Set((context.previousCanonicalActorIds || []).map((value) => Number(value)));
  for (const row of snapshot.media_actors || []) {
    const actorId = Number(row.actor_id);
    if (!previousActorIds.has(actorId)) {
      await client.query(
        `DELETE FROM media_actors
          WHERE media_id = $1
            AND actor_id = $2`,
        [canonicalId, actorId]
      );
    }
  }
}

async function revertDuplicateAttachIntoSeparateRow(client, canonicalRow, duplicateId) {
  const history = await getDuplicateAttachHistory(client, canonicalRow.id, duplicateId);
  let snapshot = history?.snapshot || null;
  let context = history?.context || null;
  if (!snapshot || !context) {
    const snapshotKey = `historical_duplicate_attach_snapshot_${duplicateId}`;
    const contextKey = `historical_duplicate_attach_context_${duplicateId}`;
    const metadataRows = await client.query(
      `SELECT "key", "value"
         FROM media_metadata
        WHERE media_id = $1
          AND "key" = ANY($2::varchar[])
        ORDER BY "key" ASC`,
      [canonicalRow.id, [snapshotKey, contextKey]]
    );
    const metadataByKey = new Map((metadataRows.rows || []).map((row) => [String(row.key), row.value]));
    snapshot = snapshot || parseJsonText(metadataByKey.get(snapshotKey), null);
    context = context || parseJsonText(metadataByKey.get(contextKey), null);
  }

  if (!snapshot?.media?.id || Number(snapshot.media.id) !== Number(duplicateId)) {
    throw new Error(`Missing valid duplicate attach snapshot for duplicate ${duplicateId}`);
  }
  if (!context) {
    throw new Error(`Missing duplicate attach context for duplicate ${duplicateId}`);
  }
  const remainingActiveHistories = await listActiveDuplicateAttachHistories(client, canonicalRow.id, {
    excludeDuplicateId: duplicateId
  });
  const restoredCanonicalFormatState = rebuildCanonicalFormatStateAfterRevert(
    canonicalRow,
    context,
    remainingActiveHistories
  );

  const duplicateExists = await client.query('SELECT id FROM media WHERE id = $1', [duplicateId]);
  if ((duplicateExists.rows || []).length > 0) {
    throw new Error(`Cannot revert duplicate attach because media ${duplicateId} already exists`);
  }

  await restoreDuplicateMediaRow(client, snapshot.media);
  await restoreDuplicateMetadata(client, duplicateId, snapshot.media_metadata || []);
  await restoreDuplicateVariants(client, duplicateId, snapshot.media_variants || []);
  await restoreDuplicateSeasons(client, duplicateId, snapshot.media_seasons || []);
  await restoreDuplicateTaxonomy(client, duplicateId, snapshot);
  await restoreDuplicateReferences(client, duplicateId, snapshot);

  await revertCanonicalTypeDetails(
    client,
    canonicalRow.id,
    context.previousCanonicalTypeDetails || {},
    restoredCanonicalFormatState.format,
    restoredCanonicalFormatState.owned_formats
  );
  await revertCanonicalMetadata(client, canonicalRow.id, snapshot, context.previousCanonicalMetadata || []);
  await revertCanonicalTaxonomyAndSeasons(client, canonicalRow.id, snapshot, context);
  if (history) {
    await markDuplicateAttachHistoryReverted(client, canonicalRow.id, duplicateId);
  } else {
    const revertedKey = `historical_duplicate_attach_reverted_at_${duplicateId}`;
    await upsertCanonicalMetadata(client, canonicalRow.id, revertedKey, new Date().toISOString());
  }

  return {
    duplicateId,
    restored: true,
    usedHistoryTable: Boolean(history)
  };
}

async function runRepairBookComicDuplicates(options = {}) {
  const client = await pool.connect();
  try {
    const rows = await loadRows(client, options.ids || []);
    let cluster = null;
    let canonical = null;
    let duplicates = [];
    let plan = null;
    let alreadyAppliedDuplicateIds = [];

    if (!options.revert && rows.length !== (options.ids || []).length) {
      if (!(options.apply && options.canonicalId)) {
        throw new Error(`Expected ${options.ids.length} rows, found ${rows.length}`);
      }

      canonical = rows.find((row) => Number(row.id) === Number(options.canonicalId));
      if (!canonical) {
        throw new Error(`Expected ${options.ids.length} rows, found ${rows.length}`);
      }

      const foundIds = new Set(rows.map((row) => Number(row.id)));
      const requestedDuplicateIds = (options.ids || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0 && value !== Number(canonical.id));
      const missingDuplicateIds = requestedDuplicateIds.filter((id) => !foundIds.has(id));

      if (missingDuplicateIds.length === 0) {
        throw new Error(`Expected ${options.ids.length} rows, found ${rows.length}`);
      }

      for (const duplicateId of missingDuplicateIds) {
        const existingHistory = await getExistingDuplicateAttachHistory(client, canonical.id, duplicateId);
        if (!existingHistory) {
          throw new Error(`Expected ${options.ids.length} rows, found ${rows.length}`);
        }
      }

      alreadyAppliedDuplicateIds = missingDuplicateIds;
      duplicates = rows.filter((row) => Number(row.id) !== Number(canonical.id));
      if (duplicates.length === 0) {
        return {
          mode: 'apply',
          confidence: 'high',
          key: null,
          canonical: { id: canonical.id, title: canonical.title, media_type: canonical.media_type },
          duplicates: missingDuplicateIds.map((id) => ({ id })),
          attached: 0,
          reverted: 0,
          appliedDetails: [],
          alreadyAppliedDuplicateIds,
          status: 'already_attached'
        };
      }
    }

    if (options.revert) {
      canonical = options.canonicalId
        ? rows.find((row) => Number(row.id) === Number(options.canonicalId))
        : chooseCanonicalRow(rows);
      if (!canonical) {
        throw new Error('Duplicate attach revert requires an existing canonical row');
      }
      duplicates = (options.ids || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0 && value !== Number(canonical.id))
        .map((id) => ({ id }));
      if (duplicates.length === 0) {
        throw new Error('Duplicate attach revert requires at least one duplicate id besides the canonical id');
      }
    } else {
      cluster = buildClusterFromRows(rows);
      canonical = options.canonicalId
        ? rows.find((row) => Number(row.id) === Number(options.canonicalId))
        : chooseCanonicalRow(rows);
      if (!canonical) {
        throw new Error('Unable to determine canonical row for duplicate attach repair');
      }
      duplicates = rows.filter((row) => Number(row.id) !== Number(canonical.id));
      if (duplicates.length === 0) {
        throw new Error('Duplicate attach repair requires at least one duplicate row after canonical selection');
      }

      plan = buildDuplicateRepairPlan({
        ...cluster,
        rows
      });
    }

    const result = {
      mode: options.revert ? 'revert' : options.apply ? 'apply' : 'dry-run',
      confidence: cluster?.confidence || 'high',
      key: cluster?.key || null,
      canonical: plan?.canonical || { id: canonical.id, title: canonical.title, media_type: canonical.media_type },
      duplicates: plan?.duplicates || duplicates.map((row) => ({ id: Number(row.id || 0) || null })),
      attached: 0,
      reverted: 0,
      appliedDetails: [],
      alreadyAppliedDuplicateIds
    };

    if (!options.apply && !options.revert) {
      return result;
    }

    await client.query('BEGIN');
    try {
      const refreshedCanonicalRows = await loadRows(client, [canonical.id]);
      const refreshedCanonical = refreshedCanonicalRows[0];
      for (const duplicate of duplicates) {
        const mergeEvidence = (!options.revert && cluster && plan)
          ? buildPersistedMergeEvidence({
              canonicalRow: refreshedCanonical,
              duplicateRow: duplicate,
              confidence: cluster.confidence,
              kind: cluster.kind,
              key: cluster.key,
              rationale: cluster.rationale,
              action: plan.action
            })
          : null;
        const detail = options.revert
          ? await revertDuplicateAttachIntoSeparateRow(client, refreshedCanonical, duplicate.id)
          : await mergeDuplicateIntoCanonical(client, refreshedCanonical, duplicate, mergeEvidence);
        result.appliedDetails.push(detail);
        if (options.revert) {
          result.reverted += 1;
        } else {
          result.attached += 1;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return result;
  } finally {
    client.release();
  }
}

async function runManualMediaMergeApply(options = {}) {
  const canonicalId = Number(options.canonicalId || 0);
  const duplicateId = Number(options.duplicateId || 0);
  if (!Number.isFinite(canonicalId) || canonicalId <= 0) {
    throw new Error('Manual merge apply requires a valid canonicalId');
  }
  if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
    throw new Error('Manual merge apply requires a valid duplicateId');
  }
  if (canonicalId === duplicateId) {
    throw new Error('Manual merge apply requires different canonical and duplicate ids');
  }

  const client = await pool.connect();
  try {
    const rows = await loadRows(client, [canonicalId, duplicateId]);
    if (rows.length !== 2) {
      throw new Error('Manual merge apply requires both records to exist');
    }

    const canonicalRow = rows.find((row) => Number(row.id) === canonicalId);
    const duplicateRow = rows.find((row) => Number(row.id) === duplicateId);
    if (!canonicalRow || !duplicateRow) {
      throw new Error('Manual merge apply requires both records to exist');
    }

    const canonicalMediaType = String(canonicalRow.media_type || '').trim();
    const duplicateMediaType = String(duplicateRow.media_type || '').trim();
    if (!canonicalMediaType || canonicalMediaType !== duplicateMediaType) {
      throw new Error('Manual merge apply requires a same-type pair');
    }

    const mergeEvidence = options.mergeEvidence && typeof options.mergeEvidence === 'object'
      ? {
          ...options.mergeEvidence,
          action: String(options.mergeEvidence.action || 'manual_merge').trim() || 'manual_merge',
          canonical_selection: {
            ...(options.mergeEvidence.canonical_selection || {}),
            canonical_id: canonicalId,
            duplicate_id: duplicateId
          }
        }
      : {
          action: 'manual_merge',
          canonical_selection: {
            canonical_id: canonicalId,
            duplicate_id: duplicateId
          }
        };

    const result = {
      mode: 'manual-apply',
      canonical: {
        id: canonicalRow.id,
        title: canonicalRow.title,
        media_type: canonicalRow.media_type
      },
      duplicate: {
        id: duplicateRow.id,
        title: duplicateRow.title,
        media_type: duplicateRow.media_type
      },
      attached: 0,
      appliedDetails: []
    };

    await client.query('BEGIN');
    try {
      const detail = await mergeDuplicateIntoCanonical(client, canonicalRow, duplicateRow, mergeEvidence);
      result.appliedDetails.push(detail);
      result.attached = 1;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return result;
  } finally {
    client.release();
  }
}

async function runManualMediaMergeRevert(options = {}) {
  const canonicalId = Number(options.canonicalId || 0);
  const duplicateId = Number(options.duplicateId || 0);
  if (!Number.isFinite(canonicalId) || canonicalId <= 0) {
    throw new Error('Manual merge revert requires a valid canonicalId');
  }
  if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
    throw new Error('Manual merge revert requires a valid duplicateId');
  }
  if (canonicalId === duplicateId) {
    throw new Error('Manual merge revert requires different canonical and duplicate ids');
  }

  return runRepairBookComicDuplicates({
    ids: [canonicalId, duplicateId],
    canonicalId,
    revert: true
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRepairBookComicDuplicates(options);
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
  buildClusterFromRows,
  mergeMissingObjectFields,
  runRepairBookComicDuplicates,
  runManualMediaMergeApply,
  runManualMediaMergeRevert
};
