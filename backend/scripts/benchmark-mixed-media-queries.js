#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const ITERATIONS = Math.max(1, Number(process.env.MIXED_MEDIA_BENCH_ITERATIONS || 5));
const OUT_PATH = process.env.MIXED_MEDIA_BENCH_OUT || path.join(__dirname, '..', 'artifacts', '2.4.0b-mixed-media-query-benchmark.json');

function hrMs(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e6;
}

async function timedQuery(text, params = [], iterations = ITERATIONS) {
  const timings = [];
  let rows = 0;
  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint();
    const res = await pool.query(text, params);
    const ms = hrMs(start);
    timings.push(ms);
    rows = Array.isArray(res.rows) ? res.rows.length : 0;
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const avgMs = timings.reduce((sum, n) => sum + n, 0) / timings.length;
  const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    iterations,
    rows,
    avg_ms: Number(avgMs.toFixed(2)),
    min_ms: Number(sorted[0].toFixed(2)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(2)),
    p95_ms: Number(p95Ms.toFixed(2))
  };
}

async function main() {
  const queries = {
    movie_title_sort: {
      sql: `SELECT id, title
            FROM media
            WHERE media_type = 'movie'
            ORDER BY regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ASC, lower(title) ASC
            LIMIT 200`
    },
    game_search_title: {
      sql: `SELECT id, title
            FROM media
            WHERE media_type = 'game'
              AND title ILIKE $1
            ORDER BY lower(title) ASC
            LIMIT 200`,
      params: ['%halo%']
    },
    audio_search_title: {
      sql: `SELECT id, title
            FROM media
            WHERE media_type = 'audio'
              AND title ILIKE $1
            ORDER BY lower(title) ASC
            LIMIT 200`,
      params: ['%the%']
    },
    mixed_fulltext_search: {
      sql: `SELECT id, title, media_type
            FROM media
            WHERE to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(original_title,'') || ' ' || coalesce(notes,''))
                  @@ plainto_tsquery('simple', $1)
            ORDER BY lower(title) ASC
            LIMIT 200`,
      params: ['thor']
    },
    director_filter_normalized: {
      sql: `SELECT m.id, m.title
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_directors md
              JOIN directors d ON d.id = md.director_id
              WHERE md.media_id = m.id
                AND d.name ILIKE $1
            )
            ORDER BY lower(m.title) ASC
            LIMIT 200`,
      params: ['%spielberg%']
    },
    genre_filter_normalized: {
      sql: `SELECT m.id, m.title
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.media_id = m.id
                AND g.name ILIKE $1
            )
            ORDER BY lower(m.title) ASC
            LIMIT 200`,
      params: ['%action%']
    },
    cast_filter_normalized: {
      sql: `SELECT m.id, m.title
            FROM media m
            WHERE EXISTS (
              SELECT 1
              FROM media_actors ma
              JOIN actors a ON a.id = ma.actor_id
              WHERE ma.media_id = m.id
                AND a.name ILIKE $1
            )
            ORDER BY lower(m.title) ASC
            LIMIT 200`,
      params: ['%tom%']
    },
    collections_list_movies: {
      sql: `SELECT id, name, media_type
            FROM collections
            WHERE media_type = 'movie'
            ORDER BY id DESC
            LIMIT 200`
    }
  };

  const startedAt = new Date().toISOString();
  const datasetCounts = await pool.query(`
    SELECT media_type, COUNT(*)::int AS count
    FROM media
    GROUP BY media_type
    ORDER BY media_type
  `);

  const results = {};
  for (const [key, query] of Object.entries(queries)) {
    // eslint-disable-next-line no-await-in-loop
    results[key] = await timedQuery(query.sql, query.params || []);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    iterations: ITERATIONS,
    dataset: {
      media_counts: datasetCounts.rows
    },
    queries: results
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote benchmark artifact: ${OUT_PATH}`);
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch (_) {}
  });
