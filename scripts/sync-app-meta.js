#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'app-meta.json');
const targets = [
  path.join(root, 'backend', 'app-meta.json'),
  path.join(root, 'frontend', 'src', 'app-meta.json')
];
const backendPkgPath = path.join(root, 'backend', 'package.json');
const frontendPkgPath = path.join(root, 'frontend', 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const meta = readJson(sourcePath);
for (const required of ['app', 'version', 'frontend', 'backend', 'userAgent']) {
  if (!Object.prototype.hasOwnProperty.call(meta, required)) {
    throw new Error(`app-meta.json missing required key: ${required}`);
  }
}

for (const target of targets) writeJson(target, meta);

const backendPkg = readJson(backendPkgPath);
backendPkg.version = String(meta.backend || meta.version);
writeJson(backendPkgPath, backendPkg);

const frontendPkg = readJson(frontendPkgPath);
frontendPkg.version = String(meta.frontend || meta.version);
writeJson(frontendPkgPath, frontendPkg);

console.log(`Synced app meta + package versions (backend=${backendPkg.version}, frontend=${frontendPkg.version}).`);
