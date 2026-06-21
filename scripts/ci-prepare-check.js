#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const appMeta = readJson('app-meta.json');
const backendMeta = readJson('backend/app-meta.json');
const frontendMeta = readJson('frontend/src/app-meta.json');
const backendPackage = readJson('backend/package.json');
const frontendPackage = readJson('frontend/package.json');

const version = String(appMeta.version || '');
const versions = [
  ['root', appMeta.version],
  ['root-frontend', appMeta.frontend],
  ['root-backend', appMeta.backend],
  ['backend-package', backendPackage.version],
  ['frontend-package', frontendPackage.version],
  ['backend-meta', backendMeta.version],
  ['frontend-meta', frontendMeta.version]
];
const mismatched = versions.filter(([, value]) => String(value || '') !== version);
if (!version || mismatched.length > 0) {
  fail(`Version mismatch: ${versions.map(([name, value]) => `${name}=${value}`).join(' ')}`);
}
if (JSON.stringify(appMeta) !== JSON.stringify(backendMeta) || JSON.stringify(appMeta) !== JSON.stringify(frontendMeta)) {
  fail('app-meta mirror files are not in sync with root app-meta.json');
}

const releaseNotePath = path.join(repoRoot, 'docs', 'releases', `v${version}.md`);
if (!fs.existsSync(releaseNotePath)) fail(`Missing release notes file: ${path.relative(repoRoot, releaseNotePath)}`);
const releaseNote = fs.readFileSync(releaseNotePath, 'utf8');
const requiredSections = [
  '## Version and date',
  '## Milestone target and status',
  '## Summary',
  '## What changed',
  '## Breaking changes',
  '## Environment/config changes',
  '## Migration and data impact',
  '## Deployment and verification',
  '## Rollback guidance',
  '## Known issues and follow-up'
];
const missingSections = requiredSections.filter((section) => !releaseNote.includes(section));
if (missingSections.length > 0) {
  fail(`Release notes missing section(s) in docs/releases/v${version}.md: ${missingSections.join(', ')}`);
}

for (const lockfile of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
  if (!fs.existsSync(path.join(repoRoot, lockfile))) fail(`Missing required lockfile: ${lockfile}`);
}

const dockerCompose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
const envExample = fs.readFileSync(path.join(repoRoot, 'env.example'), 'utf8');
if (/^[ \t]+container_name:/m.test(dockerCompose)) {
  fail('container_name is forbidden in compose files (breaks portable topology and parallel stacks).');
}
if (/^[ \t]+redis:/m.test(dockerCompose)) {
  fail('Redis service found in compose files, but runtime policy is Postgres-only.');
}
if (/REDIS_URL|REDIS_PASSWORD/.test(`${dockerCompose}\n${envExample}`)) {
  fail('Redis runtime env vars found in compose/env files.');
}
const backendDeps = { ...(backendPackage.dependencies || {}), ...(backendPackage.devDependencies || {}) };
if (backendDeps.redis || backendDeps['connect-redis']) {
  fail('Forbidden backend deps found (redis/connect-redis).');
}

const appFile = path.join(repoRoot, 'frontend/src/App.jsx');
const exceptionFile = path.join(repoRoot, '.ci/exceptions/app-shell-budget.json');
const hardBudget = 550;
const lineCount = fs.readFileSync(appFile, 'utf8').split('\n').length;
if (lineCount <= hardBudget) {
  if (fs.existsSync(exceptionFile)) {
    fail(`App shell is within hard budget; remove stale exception file: ${path.relative(repoRoot, exceptionFile)}`);
  }
} else {
  if (!fs.existsSync(exceptionFile)) {
    fail(`App shell exceeds hard budget and no exception file exists: ${path.relative(repoRoot, exceptionFile)}`);
  }
  const exception = readJson('.ci/exceptions/app-shell-budget.json');
  for (const key of ['reason', 'approved_by', 'expires_on', 'max_lines', 'target_milestone']) {
    if (!exception[key]) fail(`App shell exception missing required field: ${key}`);
  }
  const expires = new Date(exception.expires_on);
  if (Number.isNaN(expires.getTime())) fail('App shell exception expires_on is not a valid date (YYYY-MM-DD expected).');
  if (expires.getTime() < Date.now()) fail(`App shell exception expired on ${exception.expires_on}.`);
  if (!Number.isInteger(exception.max_lines) || exception.max_lines < hardBudget) {
    fail(`App shell exception max_lines must be an integer >= ${hardBudget}.`);
  }
  if (lineCount > exception.max_lines) {
    fail(`App shell line count ${lineCount} exceeds exception max_lines ${exception.max_lines}.`);
  }
}

const owner = process.env.GITHUB_REPOSITORY_OWNER || '';
const ownerLc = owner.toLowerCase();
if (owner && owner !== ownerLc && ownerLc.length === 0) fail('Unable to derive lowercase owner.');

execFileSync('git', ['diff', '--check'], { cwd: repoRoot, stdio: 'inherit' });
console.log(`CI prepare check passed for ${version}.`);
