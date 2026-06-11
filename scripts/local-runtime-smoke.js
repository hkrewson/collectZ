#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const appMeta = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app-meta.json'), 'utf8'));
const envExamplePath = path.join(repoRoot, 'env.example');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    env: options.env || process.env,
    maxBuffer: 30 * 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = result.error ? result.error.message : `${command} ${args.join(' ')} failed`;
    throw new Error(detail);
  }
  return result;
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function writeRuntimeEnv({ runtime }) {
  const envPath = path.join(os.tmpdir(), `collectz-local-runtime-${runtime}-${process.pid}.env`);
  const base = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8').trimEnd() : '';
  const lines = [
    base,
    `DB_PASSWORD=${randomHex(16)}`,
    `SESSION_SECRET=${randomHex(32)}`,
    `INTEGRATION_ENCRYPTION_KEY=${randomHex(32)}`,
    `APP_VERSION=${appMeta.version}`,
    `GIT_SHA=local-runtime`,
    `BUILD_DATE=${new Date().toISOString()}`,
    'NODE_ENV=production',
    'SESSION_COOKIE_SECURE=true',
    'TRUST_PROXY=1',
    'DEBUG=1',
    `PLAYWRIGHT_E2E_BYPASS_TOKEN=${randomHex(16)}`
  ];
  if (runtime === 'control-plane') {
    lines.push('APP_EDITION=platform');
  }
  fs.writeFileSync(envPath, `${lines.filter(Boolean).join('\n')}\n`, { mode: 0o600 });
  return envPath;
}

function writeNoHostPortsOverride({ runtime }) {
  const overridePath = path.join(os.tmpdir(), `collectz-local-runtime-${runtime}-${process.pid}.ports.yml`);
  fs.writeFileSync(overridePath, 'services:\n  frontend:\n    ports: !reset []\n', { mode: 0o600 });
  return overridePath;
}

function composeArgs({ project, envPath, runtime, portsOverridePath }) {
  const args = [
    'compose',
    '-p',
    project,
    '--env-file',
    envPath,
    '-f',
    'docker-compose.yml',
    '-f',
    '.ci/docker-compose.build.yml',
    '-f',
    portsOverridePath
  ];
  if (runtime === 'control-plane') {
    args.push('-f', '.ci/docker-compose.platform.yml');
  }
  return args;
}

function waitForHealthy(containerId, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const status = runCapture('docker', ['inspect', '-f', '{{.State.Health.Status}}', containerId]);
    if (status === 'healthy') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  throw new Error(`${label} did not become healthy`);
}

function runRuntime({ runtime }) {
  const project = `collectz-local-runtime-${runtime}-${process.pid}`;
  const envPath = writeRuntimeEnv({ runtime });
  const portsOverridePath = writeNoHostPortsOverride({ runtime });
  const baseCompose = composeArgs({ project, envPath, runtime, portsOverridePath });
  const expectedEdition = runtime === 'control-plane' ? 'platform' : 'homelab';
  const smokeScript = runtime === 'control-plane' ? 'test:control-plane-runtime-smoke' : 'test:core-runtime-smoke';

  try {
    console.log(`Running ${runtime} runtime smoke in isolated project ${project}...`);
    run('node', ['scripts/write-ci-compose-overrides.js']);
    run('docker', [...baseCompose, 'up', '-d', '--build']);

    const backendId = runCapture('docker', [...baseCompose, 'ps', '-q', 'backend']);
    const frontendId = runCapture('docker', [...baseCompose, 'ps', '-q', 'frontend']);
    if (!backendId) throw new Error('backend container id not found');
    if (!frontendId) throw new Error('frontend container id not found');

    waitForHealthy(backendId, 'backend');
    waitForHealthy(frontendId, 'frontend');
    run('docker', [
      ...baseCompose,
      'exec',
      '-T',
      'backend',
      'node',
      '-e',
      `const {getProductEdition}=require('./config/productEdition'); const actual=getProductEdition(); if(actual!=='${expectedEdition}'){console.error('Expected ${expectedEdition} runtime mode, got '+actual); process.exit(1);}`
    ]);
    run('docker', [
      ...baseCompose,
      'exec',
      '-T',
      '-e',
      'BASE_URL=http://frontend:3000',
      'backend',
      'npm',
      'run',
      smokeScript
    ]);
  } finally {
    run('docker', [...baseCompose, 'down', '-v', '--remove-orphans']);
    fs.rmSync(envPath, { force: true });
    fs.rmSync(portsOverridePath, { force: true });
  }
}

function main() {
  runRuntime({ runtime: 'core' });
  runRuntime({ runtime: 'control-plane' });
  console.log('Local runtime smoke passed.');
}

main();
