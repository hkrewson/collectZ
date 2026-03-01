'use strict';

const pool = require('../db/pool');
const { loadAdminIntegrationConfig } = require('../services/integrations');
const { searchComicsByTitle } = require('../services/comics');

function parseArgs(argv = []) {
  const args = {
    apply: false,
    fixProvider: false,
    libraryId: null,
    limit: 10000
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--fix-provider') {
      args.fixProvider = true;
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
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 50000);
      continue;
    }
    if (token === '--limit') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 50000);
      i += 1;
    }
  }
  return args;
}

function normalizeIssueToken(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim()
    .toLowerCase();
}

function extractIssueTokenFromTitle(title) {
  const value = String(title || '').trim();
  if (!value) return '';

  const hashMatch = value.match(/#\s*([A-Za-z0-9.-]+)/);
  if (hashMatch?.[1]) return normalizeIssueToken(hashMatch[1]);

  const issueMatch = value.match(/\b(?:issue|no\.?)\s*([A-Za-z0-9.-]+)/i);
  if (issueMatch?.[1]) return normalizeIssueToken(issueMatch[1]);

  return '';
}

function extractSeriesNameFromTitle(title) {
  const value = String(title || '').trim();
  if (!value) return '';
  const stripped = value
    .replace(/\s*#\s*[A-Za-z0-9.-]+.*$/i, '')
    .replace(/\s*:\s*.*$/, '')
    .trim();
  return stripped || value;
}

function normalizeSeriesName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickProviderRemapCandidate(matches = [], rowTitle, titleIssueToken) {
  if (!Array.isArray(matches) || !matches.length || !titleIssueToken) return null;
  const targetSeries = normalizeSeriesName(extractSeriesNameFromTitle(rowTitle));
  for (const match of matches) {
    const issue = normalizeIssueToken(match?.type_details?.issue_number || '');
    if (!issue || issue !== titleIssueToken) continue;
    const providerIssueId = String(match?.type_details?.provider_issue_id || match?.id || '').trim();
    if (!providerIssueId) continue;
    const series = normalizeSeriesName(match?.type_details?.series || extractSeriesNameFromTitle(match?.title || ''));
    if (targetSeries && series && targetSeries !== series) continue;
    return {
      providerIssueId,
      issue
    };
  }
  return null;
}

function buildWhereClause({ libraryId }) {
  const conditions = ['media_type = $1'];
  const params = ['comic_book'];
  if (libraryId) {
    params.push(libraryId);
    conditions.push(`library_id = $${params.length}`);
  }
  return {
    where: `WHERE ${conditions.join(' AND ')}`,
    params
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const integrationConfig = options.fixProvider ? await loadAdminIntegrationConfig() : null;
  const { where, params } = buildWhereClause(options);
  params.push(options.limit);

  const result = await pool.query(
    `SELECT id, title, library_id, import_source, type_details
     FROM media
     ${where}
     ORDER BY id ASC
     LIMIT $${params.length}`,
    params
  );

  const rows = result.rows || [];
  const mismatches = [];
  const providerDrift = [];
  const missingInTitle = [];
  const providerRemapCache = new Map();

  for (const row of rows) {
    const titleIssue = extractIssueTokenFromTitle(row.title);
    const storedIssue = normalizeIssueToken(row.type_details?.issue_number || '');
    if (!titleIssue) {
      if (storedIssue) {
        missingInTitle.push({
          id: row.id,
          title: row.title,
          storedIssue
        });
      }
      continue;
    }

    const storedProviderIssueId = String(row.type_details?.provider_issue_id || '').trim();
    const storedEdition = normalizeIssueToken(row.type_details?.edition || '');
    let desiredProviderIssueId = null;
    if (options.fixProvider && integrationConfig) {
      const seriesName = extractSeriesNameFromTitle(row.title);
      const cacheKey = normalizeSeriesName(seriesName);
      let matches = providerRemapCache.get(cacheKey);
      if (!matches) {
        matches = await searchComicsByTitle(seriesName, integrationConfig, 200);
        providerRemapCache.set(cacheKey, matches);
      }
      const candidate = pickProviderRemapCandidate(matches, row.title, titleIssue);
      desiredProviderIssueId = String(candidate?.providerIssueId || '').trim();
    }
    if (!storedIssue || storedIssue !== titleIssue) {
      mismatches.push({
        id: row.id,
        title: row.title,
        libraryId: row.library_id,
        importSource: row.import_source,
        providerIssueId: storedProviderIssueId || null,
        desiredProviderIssueId: desiredProviderIssueId || null,
        edition: row.type_details?.edition || null,
        from: storedIssue || null,
        to: titleIssue
      });
      continue;
    }

    const hasEditionDrift = !storedEdition || storedEdition !== titleIssue;
    const hasProviderDrift = Boolean(options.fixProvider && desiredProviderIssueId && desiredProviderIssueId !== storedProviderIssueId);
    if (hasEditionDrift || hasProviderDrift) {
      providerDrift.push({
        id: row.id,
        title: row.title,
        libraryId: row.library_id,
        importSource: row.import_source,
        providerIssueId: storedProviderIssueId || null,
        desiredProviderIssueId: desiredProviderIssueId || null,
        edition: row.type_details?.edition || null,
        issue: titleIssue
      });
    }
  }

  let updated = 0;
  let providerRemapped = 0;
  let providerDriftUpdated = 0;
  const applyRows = options.fixProvider
    ? [...mismatches, ...providerDrift]
    : mismatches;
  if (options.apply && applyRows.length) {
    await pool.query('BEGIN');
    try {
      for (const row of applyRows) {
        let nextProviderIssueId = null;
        let shouldUpdateIssue = Object.prototype.hasOwnProperty.call(row, 'to');
        const targetIssue = row.to || row.issue;
        const currentProviderIssueId = String(row.providerIssueId || '').trim();
        const desiredProviderIssueId = String(row.desiredProviderIssueId || '').trim();
        if (options.fixProvider && desiredProviderIssueId && desiredProviderIssueId !== currentProviderIssueId) {
          nextProviderIssueId = desiredProviderIssueId;
        }

        const issueValue = targetIssue;
        const editionValue = issueValue ? `Issue ${issueValue}` : null;
        const providerValue = nextProviderIssueId || currentProviderIssueId || null;
        await pool.query(
          `UPDATE media
           SET type_details = jsonb_set(
                 jsonb_set(
                   jsonb_set(COALESCE(type_details, '{}'::jsonb), '{issue_number}', to_jsonb($2::text), true),
                   '{edition}',
                   to_jsonb($3::text),
                   true
                 ),
                 '{provider_issue_id}',
                 to_jsonb($4::text),
                 true
               ),
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, issueValue, editionValue, providerValue]
        );
        updated += 1;
        if (nextProviderIssueId) providerRemapped += 1;
        if (!shouldUpdateIssue && (nextProviderIssueId || editionValue)) providerDriftUpdated += 1;
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    mismatches: mismatches.length,
    providerDrift: providerDrift.length,
    updated,
    providerRemapped,
    providerDriftUpdated,
    storedIssueWithoutTitleIssue: missingInTitle.length,
    libraryId: options.libraryId || null,
    sample: mismatches.slice(0, 25),
    sampleStoredWithoutTitle: missingInTitle.slice(0, 10)
  };

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error('repair-comic-issue-mismatches failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // ignore close errors
    }
  });
