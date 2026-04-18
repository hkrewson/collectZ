'use strict';

const pool = require('../db/pool');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  chooseCanonicalRow,
  buildDuplicateRepairPlan
} = require('../services/bookComicNormalization');

function parseArgs(argv = []) {
  const args = {
    apply: false,
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

async function mergeDuplicateIntoCanonical(client, canonicalRow, duplicateRow) {
  const canonicalTypeDetails = toPlainTypeDetails(canonicalRow.type_details);
  const duplicateTypeDetails = toPlainTypeDetails(duplicateRow.type_details);
  const mergedTypeDetails = mergeMissingObjectFields(canonicalTypeDetails, duplicateTypeDetails);

  await client.query(
    `UPDATE media
     SET type_details = $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [canonicalRow.id, JSON.stringify(mergedTypeDetails)]
  );

  const snapshot = await snapshotDuplicateState(client, duplicateRow.id);
  const snapshotKey = `historical_duplicate_attach_snapshot_${duplicateRow.id}`;
  const appliedKey = `historical_duplicate_attach_applied_at_${duplicateRow.id}`;
  await upsertCanonicalMetadata(client, canonicalRow.id, snapshotKey, JSON.stringify(snapshot));
  await upsertCanonicalMetadata(client, canonicalRow.id, appliedKey, new Date().toISOString());

  const mergedMetadataEntries = await mergeDuplicateMetadataIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const mergedTaxonomy = await mergeDuplicateTaxonomyIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const mergedSeasons = await mergeDuplicateSeasonsIntoCanonical(client, canonicalRow.id, duplicateRow.id);
  const rewired = await rewireDuplicateReferences(client, canonicalRow.id, duplicateRow.id);

  await client.query('DELETE FROM media WHERE id = $1', [duplicateRow.id]);

  return {
    duplicateId: Number(duplicateRow.id || 0) || null,
    snapshotKey,
    mergedMetadataEntries,
    mergedTaxonomy,
    mergedSeasons,
    rewired
  };
}

async function runRepairBookComicDuplicates(options = {}) {
  const client = await pool.connect();
  try {
    const rows = await loadRows(client, options.ids || []);
    if (rows.length !== (options.ids || []).length) {
      throw new Error(`Expected ${options.ids.length} rows, found ${rows.length}`);
    }

    const cluster = buildClusterFromRows(rows);
    const canonical = options.canonicalId
      ? rows.find((row) => Number(row.id) === Number(options.canonicalId))
      : chooseCanonicalRow(rows);
    if (!canonical) {
      throw new Error('Unable to determine canonical row for duplicate attach repair');
    }
    const duplicates = rows.filter((row) => Number(row.id) !== Number(canonical.id));
    if (duplicates.length === 0) {
      throw new Error('Duplicate attach repair requires at least one duplicate row after canonical selection');
    }

    const plan = buildDuplicateRepairPlan({
      ...cluster,
      rows
    });

    const result = {
      mode: options.apply ? 'apply' : 'dry-run',
      confidence: cluster.confidence,
      key: cluster.key,
      canonical: plan.canonical,
      duplicates: plan.duplicates,
      attached: 0,
      appliedDetails: []
    };

    if (!options.apply) {
      return result;
    }

    await client.query('BEGIN');
    try {
      const refreshedCanonicalRows = await loadRows(client, [canonical.id]);
      const refreshedCanonical = refreshedCanonicalRows[0];
      for (const duplicate of duplicates) {
        const detail = await mergeDuplicateIntoCanonical(client, refreshedCanonical, duplicate);
        result.appliedDetails.push(detail);
        result.attached += 1;
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
  runRepairBookComicDuplicates
};
