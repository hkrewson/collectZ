#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const appMeta = require(path.join(repoRoot, 'app-meta.json'));

const outputPath = process.env.OBSERVABILITY_EVIDENCE_OUTPUT
  ? path.resolve(process.env.OBSERVABILITY_EVIDENCE_OUTPUT)
  : path.join(repoRoot, 'artifacts', 'observability-evidence', 'observability-release-evidence.json');
const mainStackHealthUrl = String(
  process.env.OBSERVABILITY_HEALTH_URL
  || (process.env.RELEASE_PREFLIGHT_BASE_URL ? `${process.env.RELEASE_PREFLIGHT_BASE_URL.replace(/\/+$/, '')}/api/health` : '')
  || 'http://localhost:3000/api/health'
);

const ciBuildComposePath = path.join(repoRoot, '.ci', 'docker-compose.build.yml');
const ciPlatformComposePath = path.join(repoRoot, '.ci', 'docker-compose.platform.yml');
const releaseComposeProject = String(process.env.RELEASE_COMPOSE_PROJECT || '').trim();
const releaseComposeExtraFiles = String(process.env.RELEASE_COMPOSE_EXTRA_FILES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const dockerBase = [
  'compose',
  ...(releaseComposeProject ? ['-p', releaseComposeProject] : []),
  '--env-file',
  '.env',
  '-f',
  'docker-compose.yml',
  ...(fs.existsSync(ciBuildComposePath) ? ['-f', '.ci/docker-compose.build.yml'] : []),
  ...(fs.existsSync(ciPlatformComposePath) ? ['-f', '.ci/docker-compose.platform.yml'] : []),
  ...releaseComposeExtraFiles.flatMap((filePath) => ['-f', filePath])
];
const restoreEnv = {
  APP_VERSION: appMeta.version,
  LOG_EXPORT_BACKEND: 'gelf_udp',
  LOG_EXPORT_HOST: 'graylog',
  LOG_EXPORT_PORT: '12201',
  LOG_EXPORT_DEBUG: '0',
  LOG_EXPORT_SETTINGS_READ_ONLY: 'false'
};

function smokeEnv(overrides = {}) {
  return {
    APP_VERSION: appMeta.version,
    LOG_EXPORT_SETTINGS_READ_ONLY: 'true',
    LOG_EXPORT_DEBUG: '0',
    ...overrides
  };
}

function runProcess(command, args, { env = process.env, cwd = repoRoot } = {}) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

function detectAppDockerNetwork() {
  const psResult = runProcess('docker', [...dockerBase, 'ps', '-q', 'backend']);
  const containerId = String(psResult.stdout || '').trim().split(/\s+/).find(Boolean);
  if (psResult.status !== 0 || !containerId) return '';

  const inspectResult = runProcess('docker', ['inspect', containerId, '--format', '{{json .NetworkSettings.Networks}}']);
  if (inspectResult.status !== 0) return '';

  try {
    const networks = JSON.parse(String(inspectResult.stdout || '{}'));
    return Object.keys(networks).find((name) => /_internal$/.test(name)) || Object.keys(networks)[0] || '';
  } catch (_error) {
    return '';
  }
}

function ensureAppDockerNetworkEnv() {
  if (String(process.env.APP_DOCKER_NETWORK || '').trim()) return;
  const detectedNetwork = detectAppDockerNetwork();
  if (detectedNetwork) {
    process.env.APP_DOCKER_NETWORK = detectedNetwork;
  }
}

function randomRuntimeSecret(prefix = 'collectz') {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}!A9`;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/(ADMIN_PASSWORD=)\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"/g, '$1"[REDACTED]"')
    .replace(/(GRAYLOG_PASSWORD=)\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"/g, '$1"[REDACTED]"')
    .replace(/(ADMIN_PASSWORD=)"[^"]*"/g, '$1"[REDACTED]"')
    .replace(/(GRAYLOG_PASSWORD=)"[^"]*"/g, '$1"[REDACTED]"')
    .replace(/(-u\s+[^:\s]+:)([^\s]+)/g, '$1[REDACTED]')
    .replace(/(Authorization:\s*basic\s+)([A-Za-z0-9+/=]+)/gi, '$1[REDACTED]');
}

function automatedResult(name, command, args, result, startedAt, durationMs) {
  return {
    name,
    kind: 'automated',
    status: result.status === 0 ? 'passed' : 'failed',
    command: sanitizeText([command, ...args].join(' ')),
    startedAt,
    durationMs,
    exitCode: result.status,
    stdout: sanitizeText(String(result.stdout || '')),
    stderr: sanitizeText(String(result.stderr || ''))
  };
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc.total += 1;
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 });
}

function runCommand(name, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const result = runProcess(command, args, options);
  const durationMs = Date.now() - startMs;
  return automatedResult(name, command, args, result, startedAt, durationMs);
}

function dockerCommand(name, args, options = {}) {
  return runCommand(name, 'docker', args, options);
}

function graylogRootSecretSha2(rootSecret) {
  return crypto.hash('sha256', rootSecret, 'hex');
}

function graylogStackEnv(rootSecret, passwordSecret) {
  return {
    ...process.env,
    GRAYLOG_PASSWORD_SECRET: passwordSecret,
    GRAYLOG_ROOT_PASSWORD_SHA2: graylogRootSecretSha2(rootSecret),
    GRAYLOG_HTTP_EXTERNAL_URI: 'http://127.0.0.1:9000/'
  };
}

function waitForMainStackHealth(name, attempts = 20, delaySeconds = 1) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let lastResult = null;
  for (let index = 0; index < attempts; index += 1) {
    lastResult = runProcess('curl', ['-fsS', mainStackHealthUrl]);
    if (lastResult.status === 0) {
      try {
        const parsed = JSON.parse(String(lastResult.stdout || '{}'));
        if (parsed && parsed.status === 'ok') {
          return automatedResult(
            name,
            'curl',
            ['-fsS', mainStackHealthUrl],
            lastResult,
            startedAt,
            Date.now() - startMs
          );
        }
      } catch (_error) {
        // Keep retrying until the endpoint returns valid health JSON.
      }
    }
    if (index < attempts - 1) {
      runProcess('sleep', [String(delaySeconds)]);
    }
  }
  return automatedResult(
    name,
    'curl',
    ['-fsS', mainStackHealthUrl],
    lastResult || { status: 1, stdout: '', stderr: 'health check did not execute' },
    startedAt,
    Date.now() - startMs
  );
}

function waitForGraylogReady(name, password, attempts = 120, delaySeconds = 2) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let lastResult = null;
  const args = [
    '-fsS',
    '-u',
    `admin:${password}`,
    '-H',
    'X-Requested-By: collectz-evidence',
    'http://localhost:9000/api/system/inputs'
  ];
  for (let index = 0; index < attempts; index += 1) {
    lastResult = runProcess('curl', args);
    if (lastResult.status === 0) {
      return automatedResult(name, 'curl', args, lastResult, startedAt, Date.now() - startMs);
    }
    if (index < attempts - 1) {
      runProcess('sleep', [String(delaySeconds)]);
    }
  }
  return automatedResult(
    name,
    'curl',
    args,
    lastResult || { status: 1, stdout: '', stderr: 'graylog readiness check did not execute' },
    startedAt,
    Date.now() - startMs
  );
}

function backendRebuildCheck(name, envOverrides) {
  const env = { ...process.env, ...envOverrides };
  return runCommand(
    name,
    'docker',
    [...dockerBase, 'up', '-d', '--build', 'backend'],
    { env }
  );
}

function createTempAdmin() {
  const suffix = Date.now();
  const email = `observability-evidence-${suffix}@example.com`;
  const password = randomRuntimeSecret('collectz-admin');
  const script = [
    'const bcrypt=require("bcrypt");',
    'const pool=require("./db/pool");',
    'const { ensureUserDefaultScope } = require("./services/libraries");',
    '(async()=>{',
    `const email=${JSON.stringify(email)};`,
    `const password=${JSON.stringify(password)};`,
    'const hash=await bcrypt.hash(password,12);',
    'const result=await pool.query("INSERT INTO users (email, password, name, role, email_verified, email_verified_at) VALUES ($1,$2,$3,$4,true,NOW()) RETURNING id,email",[email,hash,"Observability Evidence Admin","admin"]);',
    'await ensureUserDefaultScope(result.rows[0].id);',
    'console.log(JSON.stringify({id: result.rows[0].id, email, password}));',
    'await pool.end();',
    '})().catch(async (error)=>{ console.error(error); try { await pool.end(); } catch (_) {} process.exit(1); });'
  ].join('');
  const result = runProcess('docker', [...dockerBase, 'exec', '-T', 'backend', 'node', '-e', script]);
  if (result.status !== 0) {
    throw new Error(`Temp admin bootstrap failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  const parsed = JSON.parse(String(result.stdout || '{}').trim());
  return {
    id: Number(parsed.id),
    email: parsed.email,
    password: parsed.password
  };
}

function cleanupTempAdmin(userId) {
  if (!Number.isFinite(Number(userId)) || Number(userId) <= 0) return;
  const script = [
    'const pool=require("./db/pool");',
    '(async()=>{',
    `const userId=${Number(userId)};`,
    'await pool.query("DELETE FROM media WHERE library_id IN (SELECT id FROM libraries WHERE created_by = $1)",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM invites WHERE created_by = $1 OR used_by = $1",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM library_memberships WHERE user_id = $1",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM library_memberships WHERE library_id IN (SELECT id FROM libraries WHERE created_by = $1)",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM libraries WHERE created_by = $1",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM space_memberships WHERE user_id = $1",[userId]).catch(()=>{});',
    'await pool.query("DELETE FROM users WHERE id = $1",[userId]).catch(()=>{});',
    'await pool.end();',
    '})().catch(async (error)=>{ console.error(error); try { await pool.end(); } catch (_) {} process.exit(1); });'
  ].join('');
  runProcess('docker', [...dockerBase, 'exec', '-T', 'backend', 'node', '-e', script]);
}

function runBackendSmoke(name, scriptName, tempAdmin, extraEnv = {}) {
  const assignments = Object.entries({
    BASE_URL: 'http://frontend:3000',
    ADMIN_EMAIL: tempAdmin.email,
    ADMIN_PASSWORD: tempAdmin.password,
    ...extraEnv
  }).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
  const shellCommand = `${assignments.join(' ')} node scripts/${scriptName}`;
  return dockerCommand(name, [...dockerBase, 'exec', '-T', 'backend', 'sh', '-lc', shellCommand]);
}

function withTempAdmin(name, callback) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let tempAdmin = null;
  try {
    tempAdmin = createTempAdmin();
    const result = callback(tempAdmin);
    const durationMs = Date.now() - startMs;
    return {
      ...result,
      startedAt,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startMs;
    return {
      name,
      kind: 'automated',
      status: 'failed',
      startedAt,
      durationMs,
      exitCode: 1,
      stdout: '',
      stderr: String(error?.stack || error?.message || error)
    };
  } finally {
    if (tempAdmin?.id) cleanupTempAdmin(tempAdmin.id);
  }
}

function automatedComposite(name, steps) {
  const failed = steps.find((step) => step.status !== 'passed');
  return {
    name,
    kind: 'automated',
    status: failed ? 'failed' : 'passed',
    steps
  };
}

function runLokiCollectorSmoke() {
  return withTempAdmin('loki_collector_smoke', (tempAdmin) => {
    const steps = [];
    steps.push(backendRebuildCheck('backend_rebuild_stdout_json', smokeEnv({
      LOG_EXPORT_BACKEND: 'stdout_json',
      LOG_EXPORT_HOST: '127.0.0.1',
      LOG_EXPORT_PORT: '12201'
    })));
    steps.push(waitForMainStackHealth('backend_ready_stdout_json'));
    steps.push(dockerCommand('loki_stack_up', ['compose', '-f', 'ops/logging/docker-compose.loki.yml', 'up', '-d']));
    steps.push(runBackendSmoke('loki_smoke', 'structured-log-loki-smoke.js', tempAdmin, {
      LOKI_URL: 'http://loki:3100'
    }));
    steps.push(dockerCommand('loki_stack_down', ['compose', '-f', 'ops/logging/docker-compose.loki.yml', 'down']));
    return automatedComposite('loki_collector_smoke', steps);
  });
}

function runGraylogCollectorSmoke() {
  const graylogPassword = randomRuntimeSecret('collectz-graylog');
  const graylogPasswordSecret = randomRuntimeSecret('collectz-graylog-secret');
  const stackEnv = graylogStackEnv(graylogPassword, graylogPasswordSecret);
  return withTempAdmin('graylog_collector_smoke', (tempAdmin) => {
    const steps = [];
    steps.push(dockerCommand('graylog_stack_reset', ['compose', '-f', 'ops/logging/docker-compose.graylog.yml', 'down', '-v', '--remove-orphans'], {
      env: stackEnv
    }));
    steps.push(dockerCommand('graylog_stack_up', ['compose', '-f', 'ops/logging/docker-compose.graylog.yml', 'up', '-d'], {
      env: stackEnv
    }));
    steps.push(waitForGraylogReady('graylog_ready', graylogPassword));
    steps.push(backendRebuildCheck('backend_rebuild_graylog_gelf', smokeEnv({
      LOG_EXPORT_BACKEND: 'gelf_udp',
      LOG_EXPORT_HOST: 'graylog',
      LOG_EXPORT_PORT: '12201'
    })));
    steps.push(waitForMainStackHealth('backend_ready_graylog_gelf'));
    steps.push(runBackendSmoke('graylog_smoke', 'structured-log-smoke.js', tempAdmin, {
      GRAYLOG_URL: 'http://graylog:9000',
      GRAYLOG_USERNAME: 'admin',
      GRAYLOG_PASSWORD: graylogPassword,
      OPENSEARCH_URL: 'http://opensearch:9200'
    }));
    steps.push(dockerCommand('graylog_stack_down', ['compose', '-f', 'ops/logging/docker-compose.graylog.yml', 'down'], {
      env: stackEnv
    }));
    return automatedComposite('graylog_collector_smoke', steps);
  });
}

function runSyslogCollectorSmoke() {
  return withTempAdmin('syslog_collector_smoke', (tempAdmin) => {
    const steps = [];
    steps.push(backendRebuildCheck('backend_rebuild_syslog_tcp', smokeEnv({
      LOG_EXPORT_BACKEND: 'syslog_tcp',
      LOG_EXPORT_HOST: 'syslog-collector',
      LOG_EXPORT_PORT: '1514'
    })));
    steps.push(waitForMainStackHealth('backend_ready_syslog_tcp'));
    steps.push(dockerCommand('syslog_stack_up', ['compose', '-f', 'ops/logging/docker-compose.syslog.yml', 'up', '-d', '--force-recreate', 'syslog-collector']));
    steps.push(runBackendSmoke('syslog_smoke', 'structured-log-syslog-smoke.js', tempAdmin));
    steps.push(dockerCommand('syslog_stack_down', ['compose', '-f', 'ops/logging/docker-compose.syslog.yml', 'down']));
    return automatedComposite('syslog_collector_smoke', steps);
  });
}

function runNonblockingFailureSmoke() {
  return withTempAdmin('nonblocking_export_failure_smoke', (tempAdmin) => {
    const steps = [];
    steps.push(backendRebuildCheck('backend_rebuild_unreachable_syslog', smokeEnv({
      LOG_EXPORT_BACKEND: 'syslog_tcp',
      LOG_EXPORT_HOST: '127.0.0.1',
      LOG_EXPORT_PORT: '1'
    })));
    steps.push(waitForMainStackHealth('backend_ready_unreachable_syslog'));
    steps.push(runBackendSmoke('nonblocking_smoke', 'structured-log-nonblocking-smoke.js', tempAdmin));
    return automatedComposite('nonblocking_export_failure_smoke', steps);
  });
}

function restoreBackend() {
  return backendRebuildCheck('backend_restore_graylog', restoreEnv);
}

function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  ensureAppDockerNetworkEnv();

  const checks = [];
  try {
    checks.push(runCommand(
      'monitoring_persistence_rehearsal',
      'bash',
      ['ops/monitoring/verify-monitoring-persistence.sh']
    ));
    checks.push(runCommand(
      'graylog_persistence_rehearsal',
      'bash',
      ['ops/logging/verify-graylog-persistence.sh']
    ));
    checks.push(runCommand(
      'loki_persistence_rehearsal',
      'bash',
      ['ops/logging/verify-loki-persistence.sh']
    ));
    checks.push(runGraylogCollectorSmoke());
    checks.push(runLokiCollectorSmoke());
    checks.push(runSyslogCollectorSmoke());
    checks.push(runNonblockingFailureSmoke());
  } finally {
    checks.push(restoreBackend());
    checks.push(waitForMainStackHealth('main_stack_health'));
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    appVersion: appMeta.version,
    scope: 'release_evidence_first',
    outputIntent: 'Local or release-shaped observability evidence artifact',
    checks,
    summary: summarize(checks)
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Observability release evidence written to ${outputPath}`);

  const failedChecks = checks.filter((check) => check.status === 'failed');
  if (failedChecks.length > 0) {
    console.error(`Observability release evidence failed: ${failedChecks.map((check) => check.name).join(', ')}`);
    process.exit(1);
  }
}

main();
