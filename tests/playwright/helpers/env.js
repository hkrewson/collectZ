'use strict';

const fs = require('fs');
const path = require('path');

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function primeEnvFromRootFile(filename = '.env') {
  const filePath = path.resolve(__dirname, '..', '..', '..', filename);
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = stripQuotes(trimmed.slice(equalsIndex + 1));
    process.env[key] = value;
  }
}

module.exports = {
  primeEnvFromRootFile
};
