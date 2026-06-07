#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

const DEFAULT_TABLES = [
  'users',
  'spaces',
  'space_memberships',
  'libraries',
  'library_memberships',
  'media',
  'media_loans',
  'wanted_items',
  'capture_items',
  'artworks',
  'collectible_trait_records',
  'app_integrations',
  'sync_jobs',
  'activity_log'
];

function parseArgs(argv) {
  const args = {
    output: '',
    compare: '',
    failOnRisk: false,
    includeNames: false,
    pretty: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      args.output = argv[++i] || '';
    } else if (arg === '--compare') {
      args.compare = argv[++i] || '';
    } else if (arg === '--fail-on-risk') {
      args.failOnRisk = true;
    } else if (arg === '--include-names') {
      args.includeNames = true;
    } else if (arg === '--compact') {
      args.pretty = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  npm run test:upgrade-preservation-audit -- --output artifacts/upgrade/baseline.json
  npm run test:upgrade-preservation-audit -- --compare artifacts/upgrade/baseline.json --output artifacts/upgrade/after.json --fail-on-risk

Options:
  --output <file>      Write the audit report JSON to a file.
  --compare <file>     Compare the current database against a previous audit report.
  --fail-on-risk       Exit non-zero when high-risk findings are present.
  --include-names      Include workspace/library names in the report. Default redacts names.
  --compact            Write compact JSON instead of pretty JSON.
`);
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function int(value) {
  return Number(value || 0);
}

async function connect() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useDatabaseSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  return client;
}

async function loadSchema(client) {
  const result = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const schema = new Map();
  for (const row of result.rows) {
    if (!schema.has(row.table_name)) schema.set(row.table_name, new Set());
    schema.get(row.table_name).add(row.column_name);
  }
  return schema;
}

function hasTable(schema, table) {
  return schema.has(table);
}

function hasColumn(schema, table, column) {
  return schema.get(table)?.has(column) || false;
}

async function scalar(client, sql, params = [], fallback = 0) {
  try {
    const result = await client.query(sql, params);
    const first = result.rows[0];
    if (!first) return fallback;
    const value = Object.values(first)[0];
    return int(value);
  } catch (error) {
    return fallback;
  }
}

async function collectTableCounts(client, schema) {
  const counts = {};
  for (const table of DEFAULT_TABLES) {
    if (!hasTable(schema, table)) {
      counts[table] = null;
      continue;
    }
    counts[table] = await scalar(client, `SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)}`);
  }
  return counts;
}

async function collectMigrationInfo(client, schema) {
  if (!hasTable(schema, 'schema_migrations')) {
    return { maxVersion: null, appliedCount: null };
  }
  const result = await client.query(
    `SELECT COALESCE(MAX(version), 0)::int AS max_version,
            COUNT(*)::int AS applied_count
     FROM schema_migrations`
  );
  return {
    maxVersion: result.rows[0]?.max_version ?? null,
    appliedCount: result.rows[0]?.applied_count ?? null
  };
}

async function collectScopeIntegrity(client, schema) {
  const checks = {
    mediaRowsMissingLibrary: null,
    mediaRowsWithInvalidLibrary: null,
    mediaRowsWithInvalidSpace: null,
    librariesWithoutMembers: null,
    librariesWithoutOwnerOrAdmin: null,
    librariesWithInvalidSpace: null,
    spacesWithoutMembers: null,
    usersWithInvalidActiveLibrary: null,
    usersWithInvalidActiveSpace: null
  };

  if (hasTable(schema, 'media') && hasColumn(schema, 'media', 'library_id')) {
    checks.mediaRowsMissingLibrary = await scalar(client, 'SELECT COUNT(*)::int FROM media WHERE library_id IS NULL');
    if (hasTable(schema, 'libraries')) {
      checks.mediaRowsWithInvalidLibrary = await scalar(
        client,
        `SELECT COUNT(*)::int
         FROM media m
         LEFT JOIN libraries l ON l.id = m.library_id
         WHERE m.library_id IS NOT NULL
           AND l.id IS NULL`
      );
    }
  }

  if (hasTable(schema, 'media') && hasColumn(schema, 'media', 'space_id') && hasTable(schema, 'spaces')) {
    checks.mediaRowsWithInvalidSpace = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM media m
       LEFT JOIN spaces s ON s.id = m.space_id
       WHERE m.space_id IS NOT NULL
         AND s.id IS NULL`
    );
  }

  if (hasTable(schema, 'libraries') && hasColumn(schema, 'libraries', 'space_id') && hasTable(schema, 'spaces')) {
    checks.librariesWithInvalidSpace = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM libraries l
       LEFT JOIN spaces s ON s.id = l.space_id
       WHERE l.space_id IS NOT NULL
         AND s.id IS NULL`
    );
  }

  if (hasTable(schema, 'libraries') && hasTable(schema, 'library_memberships')) {
    const archivedClause = hasColumn(schema, 'libraries', 'archived_at') ? 'WHERE l.archived_at IS NULL' : '';
    checks.librariesWithoutMembers = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM (
         SELECT l.id
         FROM libraries l
         LEFT JOIN library_memberships lm ON lm.library_id = l.id
         ${archivedClause}
         GROUP BY l.id
         HAVING COUNT(lm.user_id) = 0
       ) missing_members`
    );

    if (hasColumn(schema, 'library_memberships', 'role')) {
      checks.librariesWithoutOwnerOrAdmin = await scalar(
        client,
        `SELECT COUNT(*)::int
         FROM (
           SELECT l.id
           FROM libraries l
           LEFT JOIN library_memberships lm
             ON lm.library_id = l.id
            AND lm.role IN ('owner', 'admin')
           ${archivedClause}
           GROUP BY l.id
           HAVING COUNT(lm.user_id) = 0
         ) missing_owner`
      );
    }
  }

  if (hasTable(schema, 'spaces') && hasTable(schema, 'space_memberships')) {
    checks.spacesWithoutMembers = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM (
         SELECT s.id
         FROM spaces s
         LEFT JOIN space_memberships sm ON sm.space_id = s.id
         GROUP BY s.id
         HAVING COUNT(sm.user_id) = 0
       ) missing_members`
    );
  }

  if (hasTable(schema, 'users') && hasColumn(schema, 'users', 'active_library_id') && hasTable(schema, 'libraries')) {
    checks.usersWithInvalidActiveLibrary = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM users u
       LEFT JOIN libraries l ON l.id = u.active_library_id
       WHERE u.active_library_id IS NOT NULL
         AND l.id IS NULL`
    );
  }

  if (hasTable(schema, 'users') && hasColumn(schema, 'users', 'active_space_id') && hasTable(schema, 'spaces')) {
    checks.usersWithInvalidActiveSpace = await scalar(
      client,
      `SELECT COUNT(*)::int
       FROM users u
       LEFT JOIN spaces s ON s.id = u.active_space_id
       WHERE u.active_space_id IS NOT NULL
         AND s.id IS NULL`
    );
  }

  return checks;
}

async function collectLibrarySummaries(client, schema, includeNames) {
  if (!hasTable(schema, 'libraries')) return [];
  const fields = [
    'l.id',
    hasColumn(schema, 'libraries', 'space_id') ? 'l.space_id' : 'NULL::int AS space_id',
    hasColumn(schema, 'libraries', 'archived_at') ? '(l.archived_at IS NOT NULL) AS archived' : 'false AS archived',
    includeNames && hasColumn(schema, 'libraries', 'name') ? 'l.name' : 'NULL::text AS name',
    hasTable(schema, 'media') && hasColumn(schema, 'media', 'library_id') ? 'COUNT(DISTINCT m.id)::int AS media_count' : '0::int AS media_count',
    hasTable(schema, 'library_memberships') ? 'COUNT(DISTINCT lm.user_id)::int AS member_count' : '0::int AS member_count'
  ];

  const mediaJoin = hasTable(schema, 'media') && hasColumn(schema, 'media', 'library_id')
    ? 'LEFT JOIN media m ON m.library_id = l.id'
    : '';
  const memberJoin = hasTable(schema, 'library_memberships')
    ? 'LEFT JOIN library_memberships lm ON lm.library_id = l.id'
    : '';
  const result = await client.query(
    `SELECT ${fields.join(', ')}
     FROM libraries l
     ${mediaJoin}
     ${memberJoin}
     GROUP BY l.id
     ORDER BY l.id`
  );

  return result.rows.map((row) => ({
    id: int(row.id),
    space_id: row.space_id === null ? null : int(row.space_id),
    archived: Boolean(row.archived),
    name: includeNames ? row.name || null : undefined,
    media_count: int(row.media_count),
    member_count: int(row.member_count)
  }));
}

async function collectUserVisibility(client, schema) {
  if (!hasTable(schema, 'users')) return [];
  const emailColumn = hasColumn(schema, 'users', 'email') ? 'email' : null;
  const rows = await client.query(
    `SELECT id,
            ${emailColumn ? 'email' : "NULL::text AS email"},
            ${hasColumn(schema, 'users', 'active_space_id') ? 'active_space_id' : 'NULL::int AS active_space_id'},
            ${hasColumn(schema, 'users', 'active_library_id') ? 'active_library_id' : 'NULL::int AS active_library_id'}
     FROM users
     ORDER BY id`
  );

  const summaries = [];
  for (const row of rows.rows) {
    const userId = int(row.id);
    let accessibleLibraries = null;
    let visibleMedia = null;
    let manageableSpaces = null;

    if (hasTable(schema, 'library_memberships')) {
      accessibleLibraries = await scalar(
        client,
        `SELECT COUNT(DISTINCT library_id)::int
         FROM library_memberships
         WHERE user_id = $1`,
        [userId]
      );
    }

    if (hasTable(schema, 'media') && hasColumn(schema, 'media', 'library_id') && hasTable(schema, 'library_memberships')) {
      visibleMedia = await scalar(
        client,
        `SELECT COUNT(DISTINCT m.id)::int
         FROM media m
         JOIN library_memberships lm ON lm.library_id = m.library_id
         WHERE lm.user_id = $1`,
        [userId]
      );
    } else if (hasTable(schema, 'media') && hasColumn(schema, 'media', 'added_by')) {
      visibleMedia = await scalar(client, 'SELECT COUNT(*)::int FROM media WHERE added_by = $1', [userId]);
    }

    if (hasTable(schema, 'space_memberships')) {
      manageableSpaces = await scalar(
        client,
        `SELECT COUNT(DISTINCT space_id)::int
         FROM space_memberships
         WHERE user_id = $1`,
        [userId]
      );
    }

    summaries.push({
      user_id: userId,
      email_hash: sha(row.email || `user:${userId}`),
      active_space_id: row.active_space_id === null ? null : int(row.active_space_id),
      active_library_id: row.active_library_id === null ? null : int(row.active_library_id),
      accessible_library_count: accessibleLibraries,
      manageable_space_count: manageableSpaces,
      visible_media_count: visibleMedia
    });
  }

  return summaries;
}

function mapBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) map.set(keyFn(item), item);
  return map;
}

function compareReports(before, after) {
  const findings = [];
  const criticalTables = ['users', 'spaces', 'space_memberships', 'libraries', 'library_memberships', 'media', 'wanted_items', 'artworks'];

  for (const table of criticalTables) {
    const beforeCount = before.tableCounts?.[table];
    const afterCount = after.tableCounts?.[table];
    if (beforeCount === null || beforeCount === undefined || afterCount === null || afterCount === undefined) continue;
    if (afterCount < beforeCount) {
      findings.push({
        severity: 'high',
        code: 'table_count_decreased',
        table,
        before: beforeCount,
        after: afterCount,
        message: `${table} row count decreased from ${beforeCount} to ${afterCount}`
      });
    }
  }

  const beforeUsers = mapBy(before.userVisibility, (row) => `${row.user_id}:${row.email_hash}`);
  const afterUsers = mapBy(after.userVisibility, (row) => `${row.user_id}:${row.email_hash}`);
  for (const [key, beforeUser] of beforeUsers.entries()) {
    const afterUser = afterUsers.get(key);
    if (!afterUser) {
      findings.push({
        severity: 'high',
        code: 'user_missing_after_upgrade',
        user_key: key,
        message: `User ${key} was present before upgrade and missing after upgrade`
      });
      continue;
    }
    if (Number.isFinite(beforeUser.visible_media_count) && Number.isFinite(afterUser.visible_media_count)
      && afterUser.visible_media_count < beforeUser.visible_media_count) {
      findings.push({
        severity: 'high',
        code: 'visible_media_decreased',
        user_key: key,
        before: beforeUser.visible_media_count,
        after: afterUser.visible_media_count,
        message: `Visible media count decreased for user ${key}`
      });
    }
    if (Number.isFinite(beforeUser.accessible_library_count) && Number.isFinite(afterUser.accessible_library_count)
      && afterUser.accessible_library_count < beforeUser.accessible_library_count) {
      findings.push({
        severity: 'medium',
        code: 'accessible_libraries_decreased',
        user_key: key,
        before: beforeUser.accessible_library_count,
        after: afterUser.accessible_library_count,
        message: `Accessible library count decreased for user ${key}`
      });
    }
  }

  const beforeLibraries = mapBy(before.librarySummaries, (row) => String(row.id));
  const afterLibraries = mapBy(after.librarySummaries, (row) => String(row.id));
  for (const [libraryId, beforeLibrary] of beforeLibraries.entries()) {
    const afterLibrary = afterLibraries.get(libraryId);
    if (!afterLibrary) {
      findings.push({
        severity: 'high',
        code: 'library_missing_after_upgrade',
        library_id: Number(libraryId),
        message: `Library ${libraryId} was present before upgrade and missing after upgrade`
      });
      continue;
    }
    if (afterLibrary.media_count < beforeLibrary.media_count) {
      findings.push({
        severity: 'high',
        code: 'library_media_count_decreased',
        library_id: Number(libraryId),
        before: beforeLibrary.media_count,
        after: afterLibrary.media_count,
        message: `Library ${libraryId} media count decreased`
      });
    }
    if (beforeLibrary.member_count > 0 && afterLibrary.member_count === 0) {
      findings.push({
        severity: 'high',
        code: 'library_lost_all_members',
        library_id: Number(libraryId),
        before: beforeLibrary.member_count,
        after: afterLibrary.member_count,
        message: `Library ${libraryId} lost all memberships`
      });
    }
  }

  return findings;
}

function integrityFindings(report) {
  const findings = [];
  const highChecks = [
    'mediaRowsMissingLibrary',
    'mediaRowsWithInvalidLibrary',
    'mediaRowsWithInvalidSpace',
    'librariesWithoutMembers',
    'librariesWithInvalidSpace',
    'usersWithInvalidActiveLibrary',
    'usersWithInvalidActiveSpace'
  ];
  const mediumChecks = ['librariesWithoutOwnerOrAdmin', 'spacesWithoutMembers'];

  for (const key of highChecks) {
    const value = report.scopeIntegrity?.[key];
    if (Number(value) > 0) {
      findings.push({
        severity: 'high',
        code: key,
        count: Number(value),
        message: `${key} is ${value}`
      });
    }
  }

  for (const key of mediumChecks) {
    const value = report.scopeIntegrity?.[key];
    if (Number(value) > 0) {
      findings.push({
        severity: 'medium',
        code: key,
        count: Number(value),
        message: `${key} is ${value}`
      });
    }
  }

  return findings;
}

async function buildReport(client, args) {
  const schema = await loadSchema(client);
  const now = new Date().toISOString();
  const report = {
    generatedAt: now,
    database: {
      name: null,
      host: null
    },
    schema: {
      migration: await collectMigrationInfo(client, schema),
      tablesPresent: DEFAULT_TABLES.filter((table) => hasTable(schema, table))
    },
    tableCounts: await collectTableCounts(client, schema),
    scopeIntegrity: await collectScopeIntegrity(client, schema),
    librarySummaries: await collectLibrarySummaries(client, schema, args.includeNames),
    userVisibility: await collectUserVisibility(client, schema),
    findings: []
  };

  const dbResult = await client.query('SELECT current_database() AS database, inet_server_addr()::text AS host');
  report.database.name = dbResult.rows[0]?.database || null;
  report.database.host = dbResult.rows[0]?.host || null;
  report.findings.push(...integrityFindings(report));

  if (args.compare) {
    const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    report.comparedTo = {
      path: args.compare,
      generatedAt: baseline.generatedAt || null,
      migration: baseline.schema?.migration || null
    };
    report.findings.push(...compareReports(baseline, report));
  }

  report.summary = {
    high: report.findings.filter((finding) => finding.severity === 'high').length,
    medium: report.findings.filter((finding) => finding.severity === 'medium').length,
    low: report.findings.filter((finding) => finding.severity === 'low').length,
    ok: report.findings.filter((finding) => finding.severity === 'high').length === 0
  };

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await connect();
  try {
    const report = await buildReport(client, args);
    const json = JSON.stringify(report, null, args.pretty ? 2 : 0);
    if (args.output) {
      fs.mkdirSync(path.dirname(args.output), { recursive: true });
      fs.writeFileSync(args.output, `${json}\n`);
    }
    console.log(JSON.stringify({
      ok: report.summary.ok,
      high: report.summary.high,
      medium: report.summary.medium,
      migration: report.schema.migration,
      output: args.output || null
    }, null, 2));
    if (args.failOnRisk && !report.summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Upgrade preservation audit failed: ${error.message}`);
  process.exit(1);
});
