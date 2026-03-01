'use strict';

const pool = require('../db/pool');
const { loadAdminIntegrationConfig } = require('../services/integrations');
const { fetchMetronIssueDetails } = require('../services/comics');

function parseArgs(argv = []) {
  const args = {
    apply: false,
    limit: 500
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--apply') {
      args.apply = true;
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
  return args;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadAdminIntegrationConfig();
  if (String(config.comicsProvider || '').toLowerCase() !== 'metron') {
    throw new Error('Comics provider is not set to metron');
  }

  const rows = await pool.query(
    `SELECT id, title, poster_path, type_details
     FROM media
     WHERE media_type = 'comic_book'
       AND COALESCE(NULLIF(trim(poster_path), ''), '') = ''
       AND COALESCE(type_details->>'provider_issue_id', '') <> ''
     ORDER BY id ASC
     LIMIT $1`,
    [options.limit]
  );

  const candidates = rows.rows || [];
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: candidates.length,
    foundPoster: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
    sample: []
  };

  for (const row of candidates) {
    const providerIssueId = String(row.type_details?.provider_issue_id || '').trim();
    if (!providerIssueId) {
      summary.notFound += 1;
      continue;
    }
    try {
      const detail = await fetchMetronIssueDetails(config, providerIssueId);
      const poster = String(detail?.poster_path || '').trim();
      if (!poster) {
        summary.notFound += 1;
        summary.sample.push({ id: row.id, title: row.title, providerIssueId, poster: null });
        continue;
      }
      summary.foundPoster += 1;
      if (options.apply) {
        await pool.query(
          `UPDATE media
           SET poster_path = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, poster]
        );
        summary.updated += 1;
      }
      if (summary.sample.length < 20) {
        summary.sample.push({ id: row.id, title: row.title, providerIssueId, poster });
      }
    } catch (error) {
      summary.errors += 1;
      if (summary.sample.length < 20) {
        summary.sample.push({ id: row.id, title: row.title, providerIssueId, error: error.message || 'lookup failed' });
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error('repair-comic-posters failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // ignore close errors
    }
  });

