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

if (!fs.existsSync(gitDir)) {
  console.error('Cannot install hook: .git directory was not found.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });

if (fs.existsSync(hookPath)) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  if (!existing.includes(marker) && !force) {
    console.error('A custom pre-push hook already exists. Re-run with --force only if you intend to replace it.');
    process.exit(1);
  }
}

const hook = `#!/bin/sh
${marker}

if [ -n "$COLLECTZ_SKIP_LOCAL_GATE" ]; then
  echo "collectZ local release gate skipped: $COLLECTZ_SKIP_LOCAL_GATE"
  exit 0
fi

echo "Running collectZ local release gate before push..."
npm run release:local-gate
`;

// codeql[js/file-system-race]
fs.writeFileSync(hookPath, hook, { mode: 0o755 });
console.log(`Installed collectZ pre-push hook at ${path.relative(repoRoot, hookPath)}`);
