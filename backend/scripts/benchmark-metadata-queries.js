const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

function parseArgs(argv) {
  const out = {
    term: 'tom',
    output: path.resolve(process.cwd(), '../docs/reports/2.1.0-metadata-query-benchmark.json')
  };
  for (const raw of argv.slice(2)) {
    const arg = String(raw || '');
    if (arg.startsWith('--term=')) out.term = arg.slice('--term='.length).trim() || out.term;
    if (arg.startsWith('--output=')) out.output = path.resolve(process.cwd(), arg.slice('--output='.length).trim());
  }
  return out;
}

async function explainAnalyze(sql, params) {
  const result = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params
  );
  const payload = result.rows?.[0]?.['QUERY PLAN']?.[0] || {};
  return {
    planningMs: payload?.['Planning Time'] ?? null,
    executionMs: payload?.['Execution Time'] ?? null,
    planRows: payload?.Plan?.['Actual Rows'] ?? null,
    sharedHitBlocks: payload?.Plan?.['Shared Hit Blocks'] ?? null,
    sharedReadBlocks: payload?.Plan?.['Shared Read Blocks'] ?? null
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const likeTerm = `%${args.term}%`;
  const samples = [
    {
      key: 'director_filter_dual_read',
      sql: `SELECT id
            FROM media m
            WHERE (
              m.director ILIKE $1
              OR EXISTS (
                SELECT 1
                FROM media_directors md
                JOIN directors d ON d.id = md.director_id
                WHERE md.media_id = m.id
                  AND d.name ILIKE $1
              )
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    },
    {
      key: 'director_filter_normalized_read',
      sql: `SELECT id
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_directors md
              JOIN directors d ON d.id = md.director_id
              WHERE md.media_id = m.id
                AND d.name ILIKE $1
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    },
    {
      key: 'genre_filter_dual_read',
      sql: `SELECT id
            FROM media m
            WHERE (
              m.genre ILIKE $1
              OR EXISTS (
                SELECT 1
                FROM media_genres mg
                JOIN genres g ON g.id = mg.genre_id
                WHERE mg.media_id = m.id
                  AND g.name ILIKE $1
              )
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    },
    {
      key: 'genre_filter_normalized_read',
      sql: `SELECT id
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.media_id = m.id
                AND g.name ILIKE $1
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    },
    {
      key: 'cast_filter_dual_read',
      sql: `SELECT id
            FROM media m
            WHERE (
              m.cast_members ILIKE $1
              OR EXISTS (
                SELECT 1
                FROM media_actors ma
                JOIN actors a ON a.id = ma.actor_id
                WHERE ma.media_id = m.id
                  AND a.name ILIKE $1
              )
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    },
    {
      key: 'cast_filter_normalized_read',
      sql: `SELECT id
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_actors ma
              JOIN actors a ON a.id = ma.actor_id
              WHERE ma.media_id = m.id
                AND a.name ILIKE $1
            )
            ORDER BY m.id DESC
            LIMIT 200`,
      params: [likeTerm]
    }
  ];

  const output = {
    generatedAt: new Date().toISOString(),
    searchTerm: args.term,
    results: {}
  };

  for (const sample of samples) {
    output.results[sample.key] = await explainAnalyze(sample.sql, sample.params);
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote benchmark evidence to ${args.output}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {}
  });
