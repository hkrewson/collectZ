#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const defaultOutputPath = path.join(root, 'artifacts', 'public-export', 'public-source-boundary-audit.json');

const DEFAULT_CANDIDATES = [
  'frontend/src/',
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/index.html',
  'frontend/vite.config.js',
  'frontend/tailwind.config.js',
  'backend/openapi/'
];

const SOURCE_BOUNDARY_PATTERNS = [
  {
    pattern: 'APP_EDITION',
    category: 'runtime selector',
    disposition: 'Rename or remove before source publication.'
  },
  {
    pattern: 'product_edition',
    category: 'runtime contract',
    disposition: 'Replace with public-safe deployment/runtime terminology or keep implementation private.'
  },
  {
    pattern: 'edition_contract',
    category: 'runtime contract',
    disposition: 'Replace with public-safe deployment/runtime terminology or keep implementation private.'
  },
  {
    pattern: 'homelab',
    category: 'private product language',
    disposition: 'Replace with self-hosted/user-facing language before source publication.'
  },
  {
    pattern: 'platform edition',
    category: 'private product language',
    disposition: 'Replace with public-safe deployment/runtime terminology before source publication.'
  },
  {
    pattern: 'control-plane',
    category: 'private operations language',
    disposition: 'Replace with neutral runtime/admin wording before source publication.'
  },
  {
    pattern: 'control plane',
    category: 'private operations language',
    disposition: 'Replace with neutral runtime/admin wording before source publication.'
  },
  {
    pattern: 'PLAYWRIGHT_E2E_BYPASS_TOKEN',
    category: 'test bypass surface',
    disposition: 'Keep test bypass internals out of public source or remove the public-facing string.'
  },
  {
    pattern: 'ALLOW_SESSION_BEARER_FALLBACK',
    category: 'auth fallback surface',
    disposition: 'Keep auth fallback internals out of public source or remove the public-facing string.'
  },
  {
    pattern: 'docs/wiki',
    category: 'private documentation path',
    disposition: 'Replace with public docs references before source publication.'
  },
  {
    pattern: 'support_admin',
    category: 'private role label',
    disposition: 'Avoid exposing internal role identifiers in public source.'
  },
  {
    pattern: 'server-admin',
    category: 'private operations label',
    disposition: 'Replace with neutral admin wording before source publication.'
  }
];

function parseArgs(argv) {
  const options = {
    output: defaultOutputPath,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = path.resolve(root, argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = path.resolve(root, arg.slice('--output='.length));
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function walkFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [relativePath];
  if (!stat.isDirectory()) return [];

  const out = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    out.push(...walkFiles(path.posix.join(relativePath.replace(/\/$/, ''), entry.name)));
  }
  return out;
}

function looksTextual(relativePath) {
  return /\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx|txt|yaml|yml)$/i.test(relativePath) || !path.extname(relativePath);
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

function audit() {
  const files = Array.from(new Set(DEFAULT_CANDIDATES.flatMap(walkFiles)))
    .filter(looksTextual)
    .sort();
  const findings = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const rule of SOURCE_BOUNDARY_PATTERNS) {
      let index = source.indexOf(rule.pattern);
      while (index !== -1) {
        findings.push({
          file,
          line: lineNumberForIndex(source, index),
          pattern: rule.pattern,
          category: rule.category,
          disposition: rule.disposition
        });
        index = source.indexOf(rule.pattern, index + rule.pattern.length);
      }
    }
  }

  const byPattern = {};
  const byCategory = {};
  const blockedFiles = new Set();
  for (const finding of findings) {
    byPattern[finding.pattern] = (byPattern[finding.pattern] || 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
    blockedFiles.add(finding.file);
  }

  return {
    ok: findings.length === 0,
    candidatePrefixes: DEFAULT_CANDIDATES,
    scannedFiles: files.length,
    blockedFileCount: blockedFiles.size,
    findingCount: findings.length,
    byPattern,
    byCategory,
    findings
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = audit();
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`Public source boundary audit: ${report.findingCount} finding(s) across ${report.blockedFileCount} file(s).`);
    console.log(`Report: ${path.relative(root, options.output)}`);
    for (const [pattern, count] of Object.entries(report.byPattern)) {
      console.log(`- ${pattern}: ${count}`);
    }
  }
}

main();
