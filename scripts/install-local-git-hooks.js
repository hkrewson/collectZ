#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gitDir = path.join(repoRoot, '.git');
const hooksDir = path.join(gitDir, 'hooks');
const hookPath = path.join(hooksDir, 'pre-push');
const force = process.argv.includes('--force');
const marker = '# collectZ managed local release gate hook';

try {
  const gitStat = fs.statSync(gitDir);
  if (!gitStat.isDirectory()) {
    throw new Error('.git is not a directory');
  }
} catch (_) {
  console.error('Cannot install hook: .git directory was not found.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });

const hook = `#!/bin/sh
${marker}

if [ -n "$COLLECTZ_SKIP_LOCAL_GATE" ]; then
  echo "collectZ local release gate skipped: $COLLECTZ_SKIP_LOCAL_GATE"
  exit 0
fi

echo "Running collectZ local release gate before push..."
npm run release:local-gate
`;

function writeHookAtomically() {
  const tempPath = path.join(hooksDir, `.pre-push.${process.pid}.${Date.now()}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o755);
    fs.writeFileSync(fd, hook, 'utf8');
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(tempPath, 0o755);
    fs.renameSync(tempPath, hookPath);
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function writeHookIfMissing() {
  let fd = null;
  try {
    fd = fs.openSync(hookPath, 'wx', 0o755);
    fs.writeFileSync(fd, hook, 'utf8');
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(hookPath, 0o755);
    return true;
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

if (!force && !writeHookIfMissing()) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  if (!existing.includes(marker)) {
    console.error('A custom pre-push hook already exists. Re-run with --force only if you intend to replace it.');
    process.exit(1);
  }
} else if (force) {
  writeHookAtomically();
}

console.log(`Installed collectZ pre-push hook at ${path.relative(repoRoot, hookPath)}`);
