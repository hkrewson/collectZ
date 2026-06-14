#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'README.md',
  'SECURITY.md',
  'docker-compose.yml',
  'env.example',
  'setup.sh',
  'app-meta.json',
  'backend/openapi/openapi.yaml',
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/src/main.jsx',
  'frontend/src/App.jsx',
  '.github/workflows/public-mirror-ci.yml',
  '.github/workflows/codeql.yml',
  '.github/dependabot.yml'
];

const blockedPatterns = [
  ['APP', 'EDITION'].join('_'),
  ['PLAYWRIGHT', 'E2E', 'BYPASS', 'TOKEN'].join('_'),
  ['ALLOW', 'SESSION', 'BEARER', 'FALLBACK'].join('_'),
  ['runtime', 'smoke'].join('-'),
  ['control', 'plane'].join('-'),
  ['docs', 'wiki'].join('/'),
  ['support', 'admin'].join('_'),
  ['server', 'admin'].join('-'),
  ['product', 'edition'].join('_'),
  ['init', 'sql'].join('.')
];

const secretPatterns = [
  /postgresql:\/\/[^:$\s]+:[^@$<\s][^@\s]+@/i,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/
];

const secretAssignmentPattern = /\b(DATABASE_URL|DB_PASSWORD|JWT_SECRET|SESSION_SECRET|INTEGRATION_ENCRYPTION_KEY)=("[^"]*"|'[^']*'|[^\s`]+)/gi;

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, fullPath).split(path.sep).join('/'));
    }
  }
  return out;
}

function looksTextual(relativePath) {
  return /\.(cjs|css|html|js|json|jsx|md|mjs|sh|txt|yaml|yml)$/i.test(relativePath) || !path.extname(relativePath);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertRequiredFiles() {
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length > 0) {
    throw new Error(`Missing required public mirror file(s): ${missing.join(', ')}`);
  }
}

function assertOpenApiShape() {
  const source = read('backend/openapi/openapi.yaml');
  try {
    const parsed = JSON.parse(source);
    if (!parsed.openapi || !parsed.info || !parsed.paths) {
      throw new Error('OpenAPI contract JSON is missing openapi, info, or paths.');
    }
    return;
  } catch (error) {
    if (!String(error?.message || '').includes('Unexpected')) {
      throw error;
    }
  }

  for (const marker of [/^openapi:/m, /^info:/m, /^paths:/m]) {
    if (!marker.test(source)) {
      throw new Error(`OpenAPI contract is missing expected marker: ${marker}`);
    }
  }
}

function assertPublicContent() {
  const files = walkFiles(root).filter(looksTextual);
  for (const file of files) {
    const source = read(file);
    for (const pattern of blockedPatterns) {
      if (source.includes(pattern)) {
        throw new Error(`Blocked private-source term found in public mirror: ${pattern} (${file})`);
      }
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(source)) {
        throw new Error(`Secret-like value found in public mirror: ${file}`);
      }
    }
    for (const match of source.matchAll(secretAssignmentPattern)) {
      const value = String(match[2] || '').replace(/^['"]|['"]$/g, '');
      if (value && !value.includes('$') && !value.includes('<') && !value.includes('[REDACTED]')) {
        throw new Error(`Secret-like assignment for ${match[1]} found in public mirror: ${file}`);
      }
    }
  }
}

function main() {
  assertRequiredFiles();
  assertOpenApiShape();
  assertPublicContent();
  console.log('Public mirror hygiene check passed.');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
