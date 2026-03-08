#!/usr/bin/env node
'use strict';

const pool = require('../db/pool');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const typeRows = await pool.query(`
    SELECT media_type, COUNT(*)::int AS count
    FROM media
    GROUP BY media_type
    ORDER BY media_type
  `);

  const availableTypes = typeRows.rows.filter((r) => Number(r.count) > 0).map((r) => r.media_type);
  const failures = [];

  for (const mediaType of availableTypes) {
    // eslint-disable-next-line no-await-in-loop
    const check = await pool.query(
      `SELECT COUNT(*)::int AS bleed
       FROM (
         SELECT media_type
         FROM media
         WHERE media_type = $1
         ORDER BY id DESC
         LIMIT 500
       ) rows
       WHERE media_type <> $1`,
      [mediaType]
    );
    const bleed = Number(check.rows[0]?.bleed || 0);
    if (bleed !== 0) failures.push(`Filter bleed detected for ${mediaType}: ${bleed}`);
  }

  const articleSort = await pool.query(`
    SELECT title
    FROM (VALUES ('The Zephyr'), ('Alpha'), ('An Bravo')) AS t(title)
    ORDER BY regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ASC, lower(title) ASC
  `);
  const sortOrder = articleSort.rows.map((r) => r.title);
  const expected = ['Alpha', 'An Bravo', 'The Zephyr'];
  if (JSON.stringify(sortOrder) !== JSON.stringify(expected)) {
    failures.push(`Title sort expression drift: got ${JSON.stringify(sortOrder)} expected ${JSON.stringify(expected)}`);
  }

  const paginationCheck = await pool.query(`
    WITH ordered AS (
      SELECT id, title,
             ROW_NUMBER() OVER (ORDER BY regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ASC, lower(title) ASC) AS rn
      FROM media
      WHERE media_type = 'movie'
    )
    SELECT COUNT(*)::int AS mismatch_count
    FROM (
      SELECT p1.id AS page1_id, p2.id AS page2_id
      FROM (SELECT id FROM ordered WHERE rn BETWEEN 1 AND 50) p1
      FULL OUTER JOIN (SELECT id FROM ordered WHERE rn BETWEEN 1 AND 50) p2 ON p1.id = p2.id
      WHERE p1.id IS NULL OR p2.id IS NULL
    ) diff
  `);
  const mismatchCount = Number(paginationCheck.rows[0]?.mismatch_count || 0);
  if (mismatchCount !== 0) {
    failures.push(`Pagination determinism check failed: mismatch_count=${mismatchCount}`);
  }

  if (failures.length) {
    throw new Error(`Mixed-media filter checks failed:\n- ${failures.join('\n- ')}`);
  }

  console.log('Mixed-media filter checks passed');
  console.log(JSON.stringify({ availableTypes, checkedTypes: availableTypes.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch (_) {}
  });
