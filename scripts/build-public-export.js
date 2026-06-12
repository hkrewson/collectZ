#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const defaultOutput = path.join(root, 'public-export');
const reportDir = path.join(root, 'artifacts', 'public-export');
const reportPath = path.join(reportDir, 'public-export-report.json');

function parseArgs(argv) {
  const options = {
    output: defaultOutput,
    commit: false,
    force: false,
    skipLocalGateCheck: false,
    message: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = path.resolve(root, argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = path.resolve(root, arg.slice('--output='.length));
    } else if (arg === '--commit') {
      options.commit = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--skip-local-gate-check') {
      options.skipLocalGateCheck = true;
    } else if (arg === '--message') {
      options.message = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith('--message=')) {
      options.message = arg.slice('--message='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  });
}

function trackedFiles() {
  return run('git', ['ls-files'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizePrefix(value) {
  return value.replace(/\/$/, '');
}

function isUnderPrefix(relativePath, prefixes) {
  return prefixes
    .map(normalizePrefix)
    .some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function isAllowed(relativePath, manifest) {
  return (manifest.allowedPathPrefixes || []).some((entry) => {
    if (entry.endsWith('/')) return relativePath.startsWith(entry);
    return relativePath === entry;
  });
}

function isDenied(relativePath, manifest) {
  const deniedExact = manifest.deniedExactPaths || [];
  const deniedPrefixes = manifest.deniedPathPrefixes || [];
  return deniedExact.includes(relativePath) || isUnderPrefix(relativePath, deniedPrefixes);
}

function ensureSafeOutput(outputPath, force) {
  const resolved = path.resolve(outputPath);
  if (resolved === root || resolved === path.dirname(root) || resolved === path.parse(resolved).root) {
    throw new Error(`Refusing unsafe output path: ${resolved}`);
  }
  if (resolved.includes(`${path.sep}.git${path.sep}`) || resolved.endsWith(`${path.sep}.git`)) {
    throw new Error(`Refusing output path inside a git metadata directory: ${resolved}`);
  }

  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0 && !force) {
      throw new Error(`Output directory is not empty: ${resolved}. Use --force to replace it.`);
    }
    if (force) fs.rmSync(resolved, { recursive: true, force: true });
  }

  fs.mkdirSync(resolved, { recursive: true });
}

function assertLocalGateCurrent(version, skipLocalGateCheck) {
  if (skipLocalGateCheck) return { skipped: true };

  const gatePath = path.join(root, 'artifacts', 'local-ci', 'local-release-gate.md');
  if (!fs.existsSync(gatePath)) {
    throw new Error('Local release gate report is missing. Run npm run release:local-gate first or pass --skip-local-gate-check.');
  }

  const report = fs.readFileSync(gatePath, 'utf8');
  if (!/Summary:\s+\d+ passed,\s+0 failed,\s+0 blocked/.test(report)) {
    throw new Error('Local release gate report is not fully passing. Run npm run release:local-gate before exporting.');
  }
  if (!report.includes(`all version metadata is ${version}`)) {
    throw new Error(`Local release gate report does not match current version ${version}. Run npm run release:local-gate first.`);
  }

  return { skipped: false, report: 'artifacts/local-ci/local-release-gate.md' };
}

function copyTrackedFiles(files, outputPath) {
  const copied = [];
  for (const relativePath of files) {
    const source = path.join(root, relativePath);
    const target = path.join(outputPath, relativePath);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to export symlink: ${relativePath}`);
    }
    if (!stat.isFile()) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, stat.mode);
    copied.push(relativePath);
  }
  return copied;
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
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
  return /\.(cjs|css|html|js|json|md|mjs|sh|txt|yaml|yml)$/i.test(relativePath) || !path.extname(relativePath);
}

function validateExportTree(outputPath, manifest) {
  const files = walkFiles(outputPath);
  const deniedContentPatterns = manifest.deniedContentPatterns || [];
  const contentScanPrefixes = manifest.contentScanPathPrefixes || [];
  const secretPatterns = [
    /postgresql:\/\/[^:$\s]+:[^@$<\s][^@\s]+@/i,
    /\bBearer\s+[A-Za-z0-9._-]{12,}/
  ];
  const secretAssignmentPattern = /\b(DATABASE_URL|DB_PASSWORD|JWT_SECRET|SESSION_SECRET|INTEGRATION_ENCRYPTION_KEY)=("[^"]*"|'[^']*'|[^\s`]+)/gi;

  for (const file of files) {
    if (isDenied(file, manifest)) {
      throw new Error(`Export contains denied path: ${file}`);
    }
  }

  for (const file of files) {
    if (!looksTextual(file) || !isUnderPrefix(file, contentScanPrefixes)) continue;
    const source = fs.readFileSync(path.join(outputPath, file), 'utf8');
    for (const pattern of deniedContentPatterns) {
      if (source.includes(pattern)) {
        throw new Error(`Export content scan found denied pattern ${pattern} in ${file}`);
      }
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(source)) {
        throw new Error(`Export content scan found secret-like content in ${file}: ${pattern}`);
      }
    }
    for (const match of source.matchAll(secretAssignmentPattern)) {
      const value = String(match[2] || '').replace(/^['"]|['"]$/g, '');
      if (value && !value.includes('$') && !value.includes('<') && !value.includes('[REDACTED]')) {
        throw new Error(`Export content scan found secret-like assignment for ${match[1]} in ${file}`);
      }
    }
  }

  return files;
}

function createCleanCommit(outputPath, version, message) {
  const branch = 'main';
  run('git', ['init'], { cwd: outputPath });
  run('git', ['checkout', '-B', branch], { cwd: outputPath });
  run('git', ['add', '.'], { cwd: outputPath });
  run('git', [
    '-c',
    'user.name=collectZ Public Export',
    '-c',
    'user.email=public-export@collectz.local',
    'commit',
    '-m',
    message || `collectZ public export v${version}`
  ], { cwd: outputPath });
  const commit = run('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: outputPath }).trim();
  return { branch, commit };
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson('public-export.manifest.json');
  const meta = readJson('app-meta.json');

  run(process.execPath, [path.join(root, 'scripts', 'validate-public-export-surface.js')]);
  const localGate = assertLocalGateCurrent(meta.version, options.skipLocalGateCheck);
  ensureSafeOutput(options.output, options.force);

  const filesToCopy = trackedFiles()
    .filter((file) => isAllowed(file, manifest))
    .filter((file) => !isDenied(file, manifest))
    .filter((file) => fs.existsSync(path.join(root, file)));
  const copied = copyTrackedFiles(filesToCopy, options.output);
  const exportFiles = validateExportTree(options.output, manifest);
  const git = options.commit ? createCleanCommit(options.output, meta.version, options.message) : null;

  const report = {
    ok: true,
    version: meta.version,
    output: path.relative(root, options.output) || '.',
    copiedFiles: copied.length,
    exportFiles: exportFiles.length,
    localGate,
    cleanCommit: git,
    pushed: false,
    report: path.relative(root, reportPath)
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Public export build failed: ${error.message}`);
  process.exit(1);
}
