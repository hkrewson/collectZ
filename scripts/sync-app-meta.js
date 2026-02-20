#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const metaPath = path.join(root, 'app-meta.json');
const backendPkgPath = path.join(root, 'backend', 'package.json');
const frontendPkgPath = path.join(root, 'frontend', 'package.json');
const backendMetaOut = path.join(root, 'backend', 'app-meta.json');
const frontendMetaOut = path.join(root, 'frontend', 'src', 'app-meta.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const meta = readJson(metaPath);
if (!meta.version || typeof meta.version !== 'string') {
  throw new Error('app-meta.json must contain a string "version" field');
}

const backendPkg = readJson(backendPkgPath);
backendPkg.version = meta.version;
writeJson(backendPkgPath, backendPkg);

const frontendPkg = readJson(frontendPkgPath);
frontendPkg.version = meta.version;
writeJson(frontendPkgPath, frontendPkg);

writeJson(backendMetaOut, meta);
writeJson(frontendMetaOut, meta);

console.log(`Synced app metadata version ${meta.version}`);
