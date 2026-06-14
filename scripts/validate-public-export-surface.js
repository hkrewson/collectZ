#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const errors = [];
const manifestPath = path.join(root, 'public-export.manifest.json');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function fail(message) {
  errors.push(message);
}

function trackedFiles(patterns) {
  try {
    return execFileSync('git', ['ls-files', ...patterns], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    fail(`Unable to inspect tracked files: ${error.message}`);
    return [];
  }
}

function isUnderDeniedPrefix(relativePath, deniedPrefixes) {
  const normalizedPath = relativePath.replace(/\/$/, '');
  return deniedPrefixes
    .map((item) => item.replace(/\/$/, ''))
    .some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function validateManifest() {
  if (!fs.existsSync(manifestPath)) {
    fail('public-export.manifest.json is required for public mirror boundary validation.');
    return;
  }

  let manifest;
  try {
    manifest = readJson('public-export.manifest.json');
  } catch (error) {
    fail(`public-export.manifest.json is not valid JSON: ${error.message}`);
    return;
  }

  if (manifest.strategy !== 'private-source-to-clean-public-mirror') {
    fail('public-export.manifest.json must declare strategy private-source-to-clean-public-mirror.');
  }
  if (manifest.publicHistoryPolicy !== 'clean-commits-only') {
    fail('public-export.manifest.json must require clean-commits-only public history.');
  }
  if (manifest.publicMirror?.includeGitHistory !== false) {
    fail('public-export.manifest.json must explicitly disable private git history in the public mirror.');
  }
  if (manifest.publicMirror?.publishFromLocalGate !== true) {
    fail('public-export.manifest.json must require public export after the local release gate.');
  }

  const allowPrefixes = manifest.allowedPathPrefixes || [];
  const denyPrefixes = manifest.deniedPathPrefixes || [];
  const denyExact = manifest.deniedExactPaths || [];
  const deniedContentPatterns = manifest.deniedContentPatterns || [];
  const requiredPublicDocs = manifest.requiredPublicDocs || [];
  const contentScanPrefixes = manifest.contentScanPathPrefixes || [];
  const mappedPathPrefixes = manifest.mappedPathPrefixes || [];

  for (const required of ['docs/public/', 'public-mirror/', 'docker-compose.yml', 'env.example', 'README.md']) {
    if (!allowPrefixes.includes(required)) {
      fail(`public-export.manifest.json must allow required public surface ${required}.`);
    }
  }
  for (const broadSourcePrefix of ['backend/', 'frontend/']) {
    if (allowPrefixes.includes(broadSourcePrefix)) {
      fail(`public-export.manifest.json must use curated ${broadSourcePrefix} paths instead of exporting the entire directory.`);
    }
  }
  for (const privateSourcePrefix of [
    'backend/.dockerignore',
    'backend/Dockerfile',
    'backend/app-meta.json',
    'backend/config/',
    'backend/db/',
    'backend/healthcheck.js',
    'backend/middleware/',
    'backend/package-lock.json',
    'backend/package.json',
    'backend/release-feed.json',
    'backend/routes/',
    'backend/scripts/',
    'backend/server.js',
    'backend/services/',
    'backend/test/',
    'frontend/.dockerignore',
    'frontend/Dockerfile',
    'frontend/nginx.conf',
    'frontend/public/',
    'frontend/dist/'
  ]) {
    if (!denyPrefixes.includes(privateSourcePrefix)) {
      fail(`public-export.manifest.json must deny private/generated source path ${privateSourcePrefix}.`);
    }
  }

  if (allowPrefixes.includes('.github/') || allowPrefixes.includes('.github')) {
    fail('public-export.manifest.json must not export private .github/ directly; use public-mirror/ mapped paths.');
  }

  const publicMirrorMapping = mappedPathPrefixes.find((mapping) => mapping.source === 'public-mirror/' && mapping.target === '');
  if (!publicMirrorMapping) {
    fail('public-export.manifest.json must map public-mirror/ to the public repository root.');
  }

  for (const required of ['.ci/', 'artifacts/', 'backend/artifacts/', 'docs/wiki/', 'ops/', 'public-export/']) {
    if (!denyPrefixes.includes(required)) {
      fail(`public-export.manifest.json must deny private source path ${required}.`);
    }
  }

  for (const required of [
    'public-mirror/.github/workflows/public-mirror-ci.yml',
    'public-mirror/.github/workflows/codeql.yml',
    'public-mirror/.github/dependabot.yml',
    'public-mirror/scripts/check-public-mirror.js'
  ]) {
    if (!fs.existsSync(path.join(root, required))) {
      fail(`Required public mirror automation source does not exist: ${required}`);
    }
  }

  for (const required of ['.env', 'docker-compose.localhost.yml', 'preflight-go-no-go.md']) {
    if (!denyExact.includes(required)) {
      fail(`public-export.manifest.json must deny private/generated file ${required}.`);
    }
  }

  for (const required of [
    'APP_EDITION',
    'PLAYWRIGHT_E2E_BYPASS_TOKEN',
    'ALLOW_SESSION_BEARER_FALLBACK',
    'runtime-smoke',
    'control-plane',
    'docs/wiki',
    'support_admin',
    'server-admin',
    'homelab edition',
    'platform edition'
  ]) {
    if (!deniedContentPatterns.includes(required)) {
      fail(`public-export.manifest.json must deny content pattern ${required}.`);
    }
  }

  for (const required of ['README.md', 'SECURITY.md']) {
    if (!requiredPublicDocs.includes(required)) {
      fail(`public-export.manifest.json must require public doc ${required}.`);
    }
  }

  if (!contentScanPrefixes.includes('*')) {
    fail('public-export.manifest.json must content-scan all exported text files with "*".');
  }

  for (const required of requiredPublicDocs) {
    if (!fs.existsSync(path.join(root, required))) {
      fail(`Required public doc path does not exist: ${required}`);
    }
  }

  for (const allowed of allowPrefixes) {
    const normalizedAllowed = allowed.replace(/\/$/, '');
    if (denyExact.includes(normalizedAllowed) || isUnderDeniedPrefix(normalizedAllowed, denyPrefixes)) {
      fail(`public-export.manifest.json allows denied path ${allowed}.`);
    }
  }
}

validateManifest();

const rootComposeFiles = trackedFiles(['docker-compose*.yml', 'docker-compose*.yaml'])
  .filter((file) => !file.includes('/'))
  .filter((file) => fs.existsSync(path.join(root, file)));
if (rootComposeFiles.length !== 1 || rootComposeFiles[0] !== 'docker-compose.yml') {
  fail(`Public export must have exactly one tracked root compose file, docker-compose.yml. Found: ${rootComposeFiles.join(', ') || '(none)'}`);
}

for (const relativePath of ['docker-compose.yml', 'env.example']) {
  const source = read(relativePath);
  if (source.includes('APP_EDITION')) {
    fail(`${relativePath} must not expose APP_EDITION in the public setup surface.`);
  }
  if (source.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN')) {
    fail(`${relativePath} must not expose Playwright bypass controls in the public setup surface.`);
  }
  if (source.includes('ALLOW_SESSION_BEARER_FALLBACK')) {
    fail(`${relativePath} must not expose session bearer fallback controls in the public setup surface.`);
  }
  for (const variableName of ['IMAGE_REGISTRY', 'IMAGE_NAMESPACE', 'IMAGE_TAG']) {
    if (source.includes(variableName)) {
      fail(`${relativePath} must not expose ${variableName}; public images are fixed to GHCR latest.`);
    }
  }
}

const publicDocs = [
  'README.md',
  'setup.sh',
  'docs/wiki/03-Docker-Compose-Setup.md',
  'docs/wiki/04-Docker-CLI-and-Portainer-Deploy.md',
  'docs/wiki/48-Deployment-Environment-Reference.md',
  'docs/wiki/10-CI-CD-and-Registry-Deploy.md'
].filter((relativePath) => fs.existsSync(path.join(root, relativePath)));

const forbiddenDocPatterns = [
  /docker-compose\.registry\.ya?ml/,
  /docker-compose\.homelab\.ya?ml/,
  /APP_EDITION\s*=/,
  /APP_EDITION\s*:/,
  /PLAYWRIGHT_E2E_BYPASS_TOKEN/,
  /ALLOW_SESSION_BEARER_FALLBACK/,
  /IMAGE_REGISTRY/,
  /IMAGE_NAMESPACE/,
  /IMAGE_TAG/,
  /-f\s+docker-compose\.ya?ml\s+-f\s+docker-compose\.homelab\.ya?ml/
];

for (const relativePath of publicDocs) {
  const source = read(relativePath);
  for (const pattern of forbiddenDocPatterns) {
    if (pattern.test(source)) {
      fail(`${relativePath} contains public-surface deployment text that should be scrubbed: ${pattern}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Public export surface validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Public export surface validation passed.');
