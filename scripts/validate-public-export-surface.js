#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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

const rootComposeFiles = trackedFiles(['docker-compose*.yml', 'docker-compose*.yaml'])
  .filter((file) => !file.includes('/'))
  .filter((file) => fs.existsSync(path.join(root, file)));
if (rootComposeFiles.length !== 1 || rootComposeFiles[0] !== 'docker-compose.yml') {
  fail(`Public export must have exactly one tracked root compose file, docker-compose.yml. Found: ${rootComposeFiles.join(', ') || '(none)'}`);
}

for (const relativePath of ['docker-compose.yml', 'env.example']) {
  const source = read(relativePath);
  if (source.includes('APP_EDITION')) {
    fail(`${relativePath} must not expose APP_EDITION in the public homelab surface.`);
  }
  if (source.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN')) {
    fail(`${relativePath} must not expose Playwright bypass controls in the public homelab surface.`);
  }
  if (source.includes('ALLOW_SESSION_BEARER_FALLBACK')) {
    fail(`${relativePath} must not expose session bearer fallback controls in the public homelab surface.`);
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
  'docs/wiki/48-Public-Homelab-Environment-Reference.md',
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
