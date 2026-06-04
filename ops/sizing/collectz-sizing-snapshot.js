#!/usr/bin/env node

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

function findRepoRoot() {
  if (process.env.COLLECTZ_REPO_ROOT) {
    return path.resolve(process.env.COLLECTZ_REPO_ROOT);
  }

  for (const start of [process.cwd(), path.resolve(__dirname, '..', '..')]) {
    let current = path.resolve(start);
    while (current !== path.dirname(current)) {
      if (
        fs.existsSync(path.join(current, 'docker-compose.yml')) &&
        fs.existsSync(path.join(current, 'package.json'))
      ) {
        return current;
      }
      current = path.dirname(current);
    }
  }

  return process.cwd();
}

const repoRoot = findRepoRoot();

function parseArgs(argv) {
  const args = {
    envFile: '.env',
    composeFiles: ['docker-compose.yml'],
    services: ['frontend', 'backend', 'db'],
    outputDir: path.join(repoRoot, 'artifacts', 'sizing'),
    sampleIntervalSeconds: 5,
    samples: 3,
    baseUrl: process.env.COLLECTZ_BASE_URL || 'http://localhost:3000',
    loadPath: '/api/health',
    loadConcurrency: 0,
    loadDurationSeconds: 30,
    includeExactCounts: false
  };

  for (const raw of argv.slice(2)) {
    const arg = String(raw || '');
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--env-file=')) args.envFile = arg.slice('--env-file='.length);
    else if (arg.startsWith('--compose-file=')) args.composeFiles.push(arg.slice('--compose-file='.length));
    else if (arg.startsWith('--services=')) args.services = arg.slice('--services='.length).split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg.startsWith('--output-dir=')) args.outputDir = path.resolve(repoRoot, arg.slice('--output-dir='.length));
    else if (arg.startsWith('--sample-interval=')) args.sampleIntervalSeconds = Math.max(1, Number(arg.slice('--sample-interval='.length)) || args.sampleIntervalSeconds);
    else if (arg.startsWith('--samples=')) args.samples = Math.max(1, Number(arg.slice('--samples='.length)) || args.samples);
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
    else if (arg.startsWith('--load-path=')) args.loadPath = arg.slice('--load-path='.length) || args.loadPath;
    else if (arg.startsWith('--load-concurrency=')) args.loadConcurrency = Math.max(0, Number(arg.slice('--load-concurrency='.length)) || 0);
    else if (arg.startsWith('--load-duration=')) args.loadDurationSeconds = Math.max(1, Number(arg.slice('--load-duration='.length)) || args.loadDurationSeconds);
    else if (arg === '--include-exact-counts') args.includeExactCounts = true;
  }

  return args;
}

function usage() {
  return `
Usage:
  node ops/sizing/collectz-sizing-snapshot.js [options]

Options:
  --env-file=.env                    Compose env file.
  --compose-file=PATH                Additional compose file. Can be repeated.
  --services=frontend,backend,db     Compose services to sample.
  --output-dir=artifacts/sizing      Evidence output directory.
  --sample-interval=5                Seconds between docker stats samples.
  --samples=3                        Number of docker stats samples.
  --base-url=http://localhost:3000   Browser-facing collectZ URL.
  --load-concurrency=0               Optional unauthenticated HTTP load concurrency.
  --load-duration=30                 Optional load duration in seconds.
  --load-path=/api/health            Optional load path for --load-concurrency.
  --include-exact-counts             Include exact counts for selected tables.
`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  return {
    command,
    args,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function dockerComposeArgs(args, suffix = []) {
  const compose = ['compose', '--env-file', args.envFile];
  for (const file of args.composeFiles) {
    compose.push('-f', file);
  }
  return [...compose, ...suffix];
}

function sleep(seconds) {
  spawnSync('sleep', [String(seconds)], { encoding: 'utf8' });
}

function parseBytes(input) {
  const value = String(input || '').trim();
  const match = value.match(/^([\d.]+)\s*([kmgtp]?i?b|b)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = String(match[2] || 'B').toLowerCase();
  const factors = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4
  };
  return Math.round(number * (factors[unit] || 1));
}

function parsePair(input) {
  const [left, right] = String(input || '').split('/').map((part) => part.trim());
  return {
    raw: input,
    leftBytes: parseBytes(left),
    rightBytes: parseBytes(right)
  };
}

function parseDockerStatsLine(line) {
  const row = JSON.parse(line);
  const mem = parsePair(row.MemUsage);
  const net = parsePair(row.NetIO);
  const block = parsePair(row.BlockIO);
  return {
    id: row.ID,
    name: row.Name,
    cpuPercent: Number(String(row.CPUPerc || '').replace('%', '')) || 0,
    memoryUsageBytes: mem.leftBytes,
    memoryLimitBytes: mem.rightBytes,
    memoryPercent: Number(String(row.MemPerc || '').replace('%', '')) || 0,
    networkReadBytes: net.leftBytes,
    networkWriteBytes: net.rightBytes,
    blockReadBytes: block.leftBytes,
    blockWriteBytes: block.rightBytes,
    pids: Number(row.PIDs) || 0,
    raw: row
  };
}

function parseJsonLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return { parseError: true, raw: line };
      }
    });
}

function summarizeSamples(samples) {
  const byName = new Map();
  for (const sample of samples) {
    for (const row of sample.rows || []) {
      if (!byName.has(row.name)) {
        byName.set(row.name, {
          name: row.name,
          sampleCount: 0,
          maxCpuPercent: 0,
          avgCpuPercent: 0,
          maxMemoryBytes: 0,
          avgMemoryBytes: 0,
          maxMemoryPercent: 0,
          maxPids: 0
        });
      }
      const current = byName.get(row.name);
      current.sampleCount += 1;
      current.avgCpuPercent += row.cpuPercent;
      current.avgMemoryBytes += row.memoryUsageBytes || 0;
      current.maxCpuPercent = Math.max(current.maxCpuPercent, row.cpuPercent);
      current.maxMemoryBytes = Math.max(current.maxMemoryBytes, row.memoryUsageBytes || 0);
      current.maxMemoryPercent = Math.max(current.maxMemoryPercent, row.memoryPercent || 0);
      current.maxPids = Math.max(current.maxPids, row.pids || 0);
    }
  }
  return Array.from(byName.values()).map((row) => ({
    ...row,
    avgCpuPercent: row.sampleCount ? row.avgCpuPercent / row.sampleCount : 0,
    avgMemoryBytes: row.sampleCount ? Math.round(row.avgMemoryBytes / row.sampleCount) : 0
  }));
}

function composePs(args) {
  const result = run('docker', dockerComposeArgs(args, ['ps', '--format', 'json']));
  return {
    status: result.status,
    stderr: result.stderr.trim(),
    rows: parseJsonLines(result.stdout)
  };
}

function collectDockerStats(args, containers) {
  const samples = [];
  const ids = containers.map((row) => row.ID || row.Id || row.Name).filter(Boolean);
  if (ids.length === 0) {
    return samples;
  }

  for (let index = 0; index < args.samples; index += 1) {
    const result = run('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...ids]);
    const rows = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseDockerStatsLine);
    samples.push({
      capturedAt: new Date().toISOString(),
      status: result.status,
      stderr: result.stderr.trim(),
      rows
    });
    if (index < args.samples - 1) {
      sleep(args.sampleIntervalSeconds);
    }
  }
  return samples;
}

function execService(args, service, command) {
  return run('docker', dockerComposeArgs(args, ['exec', '-T', service, 'sh', '-lc', command]));
}

function collectDb(args) {
  const query = `
WITH db_size AS (
  SELECT pg_database_size(current_database()) AS bytes
),
selected_counts AS (
  SELECT 'users' AS table_name, COUNT(*)::bigint AS exact_rows FROM users
  UNION ALL SELECT 'spaces', COUNT(*)::bigint FROM spaces
  UNION ALL SELECT 'libraries', COUNT(*)::bigint FROM libraries
  UNION ALL SELECT 'media', COUNT(*)::bigint FROM media
  UNION ALL SELECT 'activity_log', COUNT(*)::bigint FROM activity_log
),
relation_sizes AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.reltuples::bigint AS estimated_rows,
    pg_total_relation_size(c.oid) AS total_bytes,
    pg_relation_size(c.oid) AS table_bytes,
    pg_indexes_size(c.oid) AS index_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
)
SELECT json_build_object(
  'database', current_database(),
  'postgresVersion', version(),
  'databaseBytes', (SELECT bytes FROM db_size),
  'selectedExactCounts', (SELECT json_object_agg(table_name, exact_rows) FROM selected_counts),
  'largestRelations', (
    SELECT json_agg(row_to_json(r))
    FROM (
      SELECT schema_name, table_name, estimated_rows, total_bytes, table_bytes, index_bytes
      FROM relation_sizes
      ORDER BY total_bytes DESC
      LIMIT 20
    ) r
  )
)::text;
`;
  const sql = query.replace(/\s+/g, ' ').trim();
  const result = execService(args, 'db', `psql -U "$${'POSTGRES_USER'}" -d "$${'POSTGRES_DB'}" -At -c ${JSON.stringify(sql)}`);
  let parsed = null;
  if (result.status === 0) {
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch (_error) {
      parsed = null;
    }
  }
  return {
    status: result.status,
    stderr: result.stderr.trim(),
    data: parsed
  };
}

function collectExactCounts(args) {
  const query = `
SELECT json_object_agg(table_name, exact_rows)::text
FROM (
  SELECT 'media_metadata' AS table_name, COUNT(*)::bigint AS exact_rows FROM media_metadata
  UNION ALL SELECT 'media_variants', COUNT(*)::bigint FROM media_variants
  UNION ALL SELECT 'media_genres', COUNT(*)::bigint FROM media_genres
  UNION ALL SELECT 'media_directors', COUNT(*)::bigint FROM media_directors
  UNION ALL SELECT 'media_actors', COUNT(*)::bigint FROM media_actors
  UNION ALL SELECT 'capture_items', COUNT(*)::bigint FROM capture_items
) rows;
`;
  const sql = query.replace(/\s+/g, ' ').trim();
  const result = execService(args, 'db', `psql -U "$${'POSTGRES_USER'}" -d "$${'POSTGRES_DB'}" -At -c ${JSON.stringify(sql)}`);
  if (result.status !== 0) {
    return { status: result.status, stderr: result.stderr.trim(), data: null };
  }
  try {
    return { status: result.status, stderr: '', data: JSON.parse(result.stdout.trim()) };
  } catch (_error) {
    return { status: result.status, stderr: 'Could not parse exact count JSON', data: null };
  }
}

function collectServiceDisk(args) {
  const backend = execService(args, 'backend', 'du -sb uploads 2>/dev/null || true; find uploads -type f 2>/dev/null | wc -l || true');
  const db = execService(args, 'db', 'du -sb "$PGDATA" 2>/dev/null || du -sb /var/lib/postgresql/data 2>/dev/null || true');
  const parseDu = (text) => {
    const first = String(text || '').trim().split(/\r?\n/)[0] || '';
    const bytes = Number(first.split(/\s+/)[0]);
    return Number.isFinite(bytes) ? bytes : null;
  };
  const uploadLines = String(backend.stdout || '').trim().split(/\r?\n/);
  return {
    backendUploadsBytes: parseDu(backend.stdout),
    backendUploadFiles: Number(uploadLines[1]) || null,
    backendStatus: backend.status,
    backendStderr: backend.stderr.trim(),
    postgresDataBytes: parseDu(db.stdout),
    postgresStatus: db.status,
    postgresStderr: db.stderr.trim()
  };
}

function collectBackendRuntime(args) {
  const script = `
const allow = ['NODE_ENV','APP_VERSION','STORAGE_PROVIDER','DATABASE_SSL','SESSION_COOKIE_SECURE','TRUST_PROXY','ALLOWED_ORIGINS'];
const out = {};
for (const key of allow) out[key] = process.env[key] || null;
console.log(JSON.stringify(out));
`;
  const result = run('docker', dockerComposeArgs(args, ['exec', '-T', 'backend', 'node', '-e', script]));
  if (result.status !== 0) {
    return { status: result.status, stderr: result.stderr.trim(), data: null };
  }
  try {
    return { status: result.status, stderr: '', data: JSON.parse(result.stdout.trim()) };
  } catch (_error) {
    return { status: result.status, stderr: 'Could not parse backend runtime JSON', data: null };
  }
}

function requestOnce(url) {
  return new Promise((resolve) => {
    const started = performance.now();
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
      });
      res.on('end', () => {
        resolve({
          url,
          statusCode: res.statusCode,
          durationMs: performance.now() - started,
          bytes
        });
      });
    });
    req.on('error', (error) => {
      resolve({
        url,
        statusCode: null,
        durationMs: performance.now() - started,
        bytes: 0,
        error: String(error.message || error)
      });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('request timed out'));
    });
  });
}

async function collectHttpProbes(args) {
  const urls = [`${args.baseUrl}/api/health`, `${args.baseUrl}/`];
  const results = [];
  for (const url of urls) {
    results.push(await requestOnce(url));
  }
  return results;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function runLoadProbe(args) {
  if (!args.loadConcurrency) return null;
  const url = `${args.baseUrl}${args.loadPath.startsWith('/') ? args.loadPath : `/${args.loadPath}`}`;
  const endAt = Date.now() + args.loadDurationSeconds * 1000;
  const results = [];
  let inFlight = 0;

  async function worker() {
    while (Date.now() < endAt) {
      inFlight += 1;
      try {
        results.push(await requestOnce(url));
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: args.loadConcurrency }, () => worker()));
  while (inFlight > 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const durations = results.map((row) => row.durationMs).filter((value) => Number.isFinite(value));
  const ok = results.filter((row) => row.statusCode && row.statusCode >= 200 && row.statusCode < 400).length;
  const errors = results.length - ok;
  return {
    url,
    concurrency: args.loadConcurrency,
    durationSeconds: args.loadDurationSeconds,
    requests: results.length,
    ok,
    errors,
    requestsPerSecond: results.length / args.loadDurationSeconds,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? Math.max(...durations) : null,
    statusCodes: results.reduce((acc, row) => {
      const key = row.statusCode || 'error';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };
}

function writeMarkdown(report, outputPath) {
  const lines = [];
  lines.push(`# collectZ Sizing Snapshot`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Base URL: ${report.inputs.baseUrl}`);
  lines.push('');
  lines.push(`## Container Summary`);
  lines.push('');
  lines.push('| Container | Samples | Avg CPU % | Max CPU % | Avg Mem | Max Mem | Max PIDs |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.containerSummary) {
    lines.push(`| ${row.name} | ${row.sampleCount} | ${row.avgCpuPercent.toFixed(2)} | ${row.maxCpuPercent.toFixed(2)} | ${formatBytes(row.avgMemoryBytes)} | ${formatBytes(row.maxMemoryBytes)} | ${row.maxPids} |`);
  }
  lines.push('');
  lines.push(`## Data Footprint`);
  lines.push('');
  lines.push(`- Postgres database size: ${formatBytes(report.database?.data?.databaseBytes)}`);
  lines.push(`- Postgres data directory: ${formatBytes(report.disk?.postgresDataBytes)}`);
  lines.push(`- Local upload files: ${report.disk?.backendUploadFiles ?? 'unknown'}`);
  lines.push(`- Local upload bytes: ${formatBytes(report.disk?.backendUploadsBytes)}`);
  lines.push('');
  if (report.database?.data?.selectedExactCounts) {
    lines.push(`## Selected Counts`);
    lines.push('');
    for (const [key, value] of Object.entries(report.database.data.selectedExactCounts)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push('');
  }
  lines.push(`## HTTP Probes`);
  lines.push('');
  for (const probe of report.httpProbes || []) {
    lines.push(`- ${probe.url}: status ${probe.statusCode || 'error'}, ${probe.durationMs.toFixed(1)} ms, ${probe.bytes} bytes`);
  }
  lines.push('');
  if (report.loadProbe) {
    lines.push(`## Load Probe`);
    lines.push('');
    lines.push(`- URL: ${report.loadProbe.url}`);
    lines.push(`- Concurrency: ${report.loadProbe.concurrency}`);
    lines.push(`- Requests: ${report.loadProbe.requests}`);
    lines.push(`- Requests/sec: ${report.loadProbe.requestsPerSecond.toFixed(2)}`);
    lines.push(`- p95: ${report.loadProbe.p95Ms?.toFixed(1) ?? 'n/a'} ms`);
    lines.push(`- Errors: ${report.loadProbe.errors}`);
    lines.push('');
  }
  lines.push(`## Notes`);
  lines.push('');
  lines.push('- This report intentionally records aggregate counts and non-secret runtime posture only.');
  lines.push('- Use multiple snapshots over normal usage, import/sync activity, and synthetic load to estimate hosted costs.');
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  fs.mkdirSync(args.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ps = composePs(args);
  const containers = ps.rows.filter((row) => args.services.includes(row.Service));
  const statsSamples = collectDockerStats(args, containers);
  const database = collectDb(args);
  const exactCounts = args.includeExactCounts ? collectExactCounts(args) : null;
  const disk = collectServiceDisk(args);
  const backendRuntime = collectBackendRuntime(args);
  const httpProbes = await collectHttpProbes(args);
  const loadProbe = await runLoadProbe(args);

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      envFile: args.envFile,
      composeFiles: args.composeFiles,
      services: args.services,
      sampleIntervalSeconds: args.sampleIntervalSeconds,
      samples: args.samples,
      baseUrl: args.baseUrl,
      loadPath: args.loadPath,
      loadConcurrency: args.loadConcurrency,
      loadDurationSeconds: args.loadDurationSeconds,
      includeExactCounts: args.includeExactCounts
    },
    composePs: ps,
    backendRuntime,
    database,
    exactCounts,
    disk,
    dockerStatsSamples: statsSamples,
    containerSummary: summarizeSamples(statsSamples),
    httpProbes,
    loadProbe
  };

  const jsonPath = path.join(args.outputDir, `collectz-sizing-${stamp}.json`);
  const mdPath = path.join(args.outputDir, `collectz-sizing-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeMarkdown(report, mdPath);
  console.log(`Wrote sizing JSON to ${jsonPath}`);
  console.log(`Wrote sizing summary to ${mdPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
