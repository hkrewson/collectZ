'use strict';

const pool = require('../db/pool');
const {
  buildMissingIdentifierReviewSql,
  buildSparseMetadataReviewSql
} = require('../services/reviewClues');

async function main() {
  const missingIdentifierSql = buildMissingIdentifierReviewSql('m');
  const sparseMetadataSql = buildSparseMetadataReviewSql('m');
  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${missingIdentifierSql})::int AS missing_identifier,
      COUNT(*) FILTER (WHERE ${sparseMetadataSql})::int AS sparse_metadata,
      COUNT(*) FILTER (
        WHERE m.media_type = 'audio'
          AND COALESCE(m.owned_formats, ARRAY[]::text[]) @> ARRAY['digital']::text[]
          AND ${missingIdentifierSql}
      )::int AS digital_audio_missing_identifier,
      COUNT(*) FILTER (
        WHERE m.media_type = 'audio'
          AND COALESCE(m.owned_formats, ARRAY[]::text[]) @> ARRAY['digital']::text[]
          AND ${sparseMetadataSql}
      )::int AS digital_audio_sparse_metadata,
      COUNT(*) FILTER (
        WHERE m.media_type = 'audio'
          AND COALESCE(m.owned_formats, ARRAY[]::text[]) && ARRAY['cd', 'vinyl', 'cassette', 'eight_track', 'four_track', 'vhs']::text[]
          AND ${missingIdentifierSql}
      )::int AS physical_audio_missing_identifier
    FROM media m
  `);

  const samples = await pool.query(`
    SELECT
      m.media_type,
      COALESCE(array_to_string(m.owned_formats, ','), '') AS formats,
      COALESCE(m.import_source, '') AS import_source,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${missingIdentifierSql})::int AS missing_identifier,
      COUNT(*) FILTER (WHERE ${sparseMetadataSql})::int AS sparse_metadata
    FROM media m
    GROUP BY 1, 2, 3
    HAVING COUNT(*) FILTER (WHERE ${missingIdentifierSql}) > 0
        OR COUNT(*) FILTER (WHERE ${sparseMetadataSql}) > 0
    ORDER BY missing_identifier DESC, sparse_metadata DESC, total DESC
    LIMIT 12
  `);

  console.log(JSON.stringify({ summary: summary.rows[0], samples: samples.rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
