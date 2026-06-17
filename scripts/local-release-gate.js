#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(repoRoot, 'artifacts', 'local-ci');
const reportJsonPath = path.join(artifactsDir, 'local-release-gate.json');
const reportMdPath = path.join(artifactsDir, 'local-release-gate.md');

const args = process.argv.slice(2);

function parseArgs(argv) {
  const options = {
    profile: 'standard',
    failOnBlocked: false,
    only: null,
    skip: new Set(),
    list: false
  };

  for (const arg of argv) {
    if (arg === '--full') {
      options.profile = 'full';
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length).trim() || 'standard';
    } else if (arg === '--fail-on-blocked') {
      options.failOnBlocked = true;
    } else if (arg.startsWith('--only=')) {
      options.only = new Set(arg.slice('--only='.length).split(',').map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith('--skip=')) {
      for (const value of arg.slice('--skip='.length).split(',')) {
        const trimmed = value.trim();
        if (trimmed) options.skip.add(trimmed);
      }
    } else if (arg === '--list') {
      options.list = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['standard', 'full'].includes(options.profile)) {
    throw new Error(`Unsupported profile: ${options.profile}`);
  }
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return result.status === 0;
}

function redact(value) {
  return String(value || '')
    .replace(/(password|passwd|secret|token|key)=([^\s]+)/gi, '$1=<redacted>')
    .replace(/postgresql:\/\/([^:]+):([^@]+)@/gi, 'postgresql://$1:<redacted>@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .slice(-6000);
}

function runCommand(command, args, options = {}) {
  const startedAt = new Date();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024
  });
  const endedAt = new Date();
  return {
    status: result.status,
    signal: result.signal,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
    durationMs: endedAt.getTime() - startedAt.getTime()
  };
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return runCommand(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return runCommand('npm', args, options);
}

function pass(id, name, detail, extras = {}) {
  return { id, name, status: 'PASS', detail, ...extras };
}

function fail(id, name, detail, extras = {}) {
  return { id, name, status: 'FAIL', detail, ...extras };
}

function blocked(id, name, detail, extras = {}) {
  return { id, name, status: 'BLOCKED', detail, ...extras };
}

function runNpmScript(id, name, npmArgs, options = {}) {
  const result = runNpm(npmArgs, options);
  if (result.status === 0) {
    return pass(id, name, options.passDetail || 'completed', { durationMs: result.durationMs });
  }
  return fail(id, name, options.failDetail || `command failed: npm ${npmArgs.join(' ')}`, {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  });
}

function checkPackageJson() {
  try {
    readJson('package.json');
    readJson('backend/package.json');
    readJson('frontend/package.json');
    readJson('app-meta.json');
    readJson('backend/app-meta.json');
    readJson('frontend/src/app-meta.json');
    return pass('package-json', 'Package and app metadata parse', 'package/app metadata JSON parsed');
  } catch (error) {
    return fail('package-json', 'Package and app metadata parse', error.message);
  }
}

function checkVersionSync() {
  const rootMeta = readJson('app-meta.json');
  const backendMeta = readJson('backend/app-meta.json');
  const frontendMeta = readJson('frontend/src/app-meta.json');
  const backendPackage = readJson('backend/package.json');
  const frontendPackage = readJson('frontend/package.json');
  const versions = [
    rootMeta.version,
    backendMeta.version,
    frontendMeta.version,
    backendPackage.version,
    frontendPackage.version
  ];
  const unique = Array.from(new Set(versions));
  if (unique.length === 1) {
    return pass('version-sync', 'Version metadata sync', `all version metadata is ${unique[0]}`);
  }
  return fail('version-sync', 'Version metadata sync', `version mismatch: ${versions.join(', ')}`);
}

function checkReleaseNote() {
  const version = readJson('app-meta.json').version;
  const releaseNote = path.join(repoRoot, 'docs', 'releases', `v${version}.md`);
  if (!fs.existsSync(releaseNote)) {
    return fail('release-note', 'Release note presence', `missing docs/releases/v${version}.md`);
  }
  const text = fs.readFileSync(releaseNote, 'utf8');
  const required = ['## Version and date', '## Milestone target and status', '## Summary'];
  const missing = required.filter((heading) => !text.includes(heading));
  if (missing.length > 0) {
    return fail('release-note', 'Release note presence', `missing required heading(s): ${missing.join(', ')}`);
  }
  return pass('release-note', 'Release note presence', `docs/releases/v${version}.md has required headings`);
}

function checkReleaseFeed() {
  const version = readJson('app-meta.json').version;
  const feed = readJson('backend/release-feed.json');
  const versions = JSON.stringify(feed);
  if (!versions.includes(version)) {
    return fail('release-feed', 'Help release feed', `backend/release-feed.json does not include ${version}`);
  }
  return pass('release-feed', 'Help release feed', `release feed includes ${version}`);
}

function checkGitDiff() {
  const result = runCommand('git', ['diff', '--check']);
  if (result.status === 0) {
    return pass('diff-check', 'Git diff whitespace check', 'git diff --check passed', { durationMs: result.durationMs });
  }
  return fail('diff-check', 'Git diff whitespace check', 'git diff --check failed', {
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  });
}

function runDependencyAudit(id, name, npmArgs) {
  const result = runNpm(npmArgs);
  if (result.status === 0) {
    return pass(id, name, 'npm audit passed', { durationMs: result.durationMs });
  }
  return fail(id, name, 'npm audit found vulnerabilities or could not complete', {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  });
}

function runCodeQl() {
  const name = 'CodeQL maintained-source analysis';
  if (!commandExists('gh')) {
    return blocked('codeql', name, '`gh` is not installed');
  }

  const codeqlCheck = runCommand('gh', ['codeql', 'version']);
  if (codeqlCheck.status !== 0) {
    return blocked('codeql', name, '`gh codeql` is unavailable', {
      stdout: codeqlCheck.stdout,
      stderr: codeqlCheck.stderr
    });
  }

  const dbPath = path.join(artifactsDir, 'codeql-db');
  const sarifPath = path.join(artifactsDir, 'codeql-results.sarif');
  fs.rmSync(dbPath, { recursive: true, force: true });
  fs.rmSync(sarifPath, { force: true });

  const create = runCommand('gh', [
    'codeql',
    'database',
    'create',
    dbPath,
    '--language=javascript-typescript',
    '--source-root=.',
    '--codescanning-config=.github/codeql/codeql-config.yml'
  ]);
  if (create.status !== 0) {
    return fail('codeql', name, 'CodeQL database creation failed', {
      stdout: create.stdout,
      stderr: create.stderr,
      durationMs: create.durationMs
    });
  }

  const analyze = runCommand('gh', [
    'codeql',
    'database',
    'analyze',
    dbPath,
    '.github/codeql/collectz-maintained-source.qls',
    '--format=sarif-latest',
    `--output=${sarifPath}`
  ]);
  if (analyze.status !== 0) {
    return fail('codeql', name, 'CodeQL analysis failed', {
      stdout: analyze.stdout,
      stderr: analyze.stderr,
      durationMs: create.durationMs + analyze.durationMs
    });
  }

  const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
  const results = sarif.runs?.flatMap((run) => run.results || []) || [];
  const activeResults = results.filter((result) => !Array.isArray(result.suppressions) || result.suppressions.length === 0);
  if (activeResults.length > 0) {
    const rules = activeResults.map((result) => result.ruleId).filter(Boolean);
    return fail('codeql', name, `${activeResults.length} active CodeQL finding(s): ${Array.from(new Set(rules)).join(', ')}`, {
      sarif: path.relative(repoRoot, sarifPath),
      durationMs: create.durationMs + analyze.durationMs
    });
  }
  return pass('codeql', name, `${results.length} total result(s), ${activeResults.length} active`, {
    sarif: path.relative(repoRoot, sarifPath),
    durationMs: create.durationMs + analyze.durationMs
  });
}

function runSecretScan() {
  const name = 'Secret scan';
  if (!commandExists('gitleaks')) {
    return blocked('secret-scan', name, '`gitleaks` is not installed locally');
  }
  const sarifPath = path.join(artifactsDir, 'gitleaks.sarif');
  fs.rmSync(sarifPath, { force: true });
  const result = runCommand('gitleaks', [
    'detect',
    '--source',
    '.',
    '--redact',
    '--report-format',
    'sarif',
    '--report-path',
    sarifPath
  ]);
  if (result.status === 0) {
    return pass('secret-scan', name, 'gitleaks detected 0 findings', {
      sarif: path.relative(repoRoot, sarifPath),
      durationMs: result.durationMs
    });
  }
  return fail('secret-scan', name, 'gitleaks detected findings or failed to run', {
    stdout: result.stdout,
    stderr: result.stderr,
    sarif: path.relative(repoRoot, sarifPath),
    durationMs: result.durationMs
  });
}

function runImageScanReadiness() {
  const name = 'Image security and SBOM';
  if (!commandExists('trivy')) {
    return blocked('image-security-and-sbom', name, '`trivy` is not installed locally');
  }
  return blocked('image-security-and-sbom', name, 'local image/SBOM scan wiring is intentionally deferred to the next local-gate slice');
}

function runBrowserRegression() {
  const name = 'Browser regression';
  if (!String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim()) {
    return blocked('browser-regression', name, 'missing PLAYWRIGHT_E2E_BYPASS_TOKEN');
  }
  return runNpmScript('browser-regression', name, ['run', 'test:browser'], {
    passDetail: 'Playwright browser regression passed'
  });
}

const gateDefinitions = [
  { id: 'package-json', profile: 'standard', run: checkPackageJson },
  { id: 'version-sync', profile: 'standard', run: checkVersionSync },
  { id: 'release-note', profile: 'standard', run: checkReleaseNote },
  { id: 'release-feed', profile: 'standard', run: checkReleaseFeed },
  {
    id: 'backend-unit',
    profile: 'standard',
    run: () => runNpmScript('backend-unit', 'Backend unit tests', ['--prefix', 'backend', 'run', 'test:unit'], {
      passDetail: 'backend unit tests passed'
    })
  },
  {
    id: 'openapi',
    profile: 'standard',
    run: () => runNpmScript('openapi', 'OpenAPI validation', ['--prefix', 'backend', 'run', 'test:openapi'], {
      passDetail: 'OpenAPI validation passed'
    })
  },
  {
    id: 'frontend-build',
    profile: 'standard',
    run: () => runNpmScript('frontend-build', 'Frontend production build', ['--prefix', 'frontend', 'run', 'build'], {
      passDetail: 'frontend production build passed'
    })
  },
  {
    id: 'backend-audit',
    profile: 'standard',
    run: () => runDependencyAudit('backend-audit', 'Backend dependency audit', ['--prefix', 'backend', 'audit', '--omit=dev'])
  },
  {
    id: 'frontend-audit',
    profile: 'standard',
    run: () => runDependencyAudit('frontend-audit', 'Frontend dependency audit', ['--prefix', 'frontend', 'audit', '--omit=dev'])
  },
  {
    id: 'release-preflight',
    profile: 'standard',
    run: () => runNpmScript('release-preflight', 'Local release preflight', ['--prefix', 'backend', 'run', 'test:release-preflight-local'], {
      passDetail: 'local release preflight completed'
    })
  },
  { id: 'diff-check', profile: 'standard', run: checkGitDiff },
  { id: 'codeql', profile: 'full', run: runCodeQl },
  { id: 'secret-scan', profile: 'full', run: runSecretScan },
  {
    id: 'runtime-smoke',
    profile: 'full',
    run: () => runNpmScript('runtime-smoke', 'Runtime smoke', ['run', 'test:runtime-smoke:local'], {
      passDetail: 'core and control-plane runtime smoke passed'
    })
  },
  { id: 'browser-regression', profile: 'full', run: runBrowserRegression },
  { id: 'image-security-and-sbom', profile: 'full', run: runImageScanReadiness }
];

function selectedDefinitions(options) {
  const includedProfiles = options.profile === 'full' ? new Set(['standard', 'full']) : new Set(['standard']);
  return gateDefinitions.filter((definition) => {
    if (!includedProfiles.has(definition.profile)) return false;
    if (options.only && !options.only.has(definition.id)) return false;
    if (options.skip.has(definition.id)) return false;
    return true;
  });
}

function writeReports({ options, gates }) {
  ensureDir(artifactsDir);
  const failed = gates.filter((gate) => gate.status === 'FAIL');
  const blockedGates = gates.filter((gate) => gate.status === 'BLOCKED');
  const payload = {
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    failOnBlocked: options.failOnBlocked,
    summary: {
      total: gates.length,
      passed: gates.filter((gate) => gate.status === 'PASS').length,
      failed: failed.length,
      blocked: blockedGates.length
    },
    gates
  };
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [];
  lines.push('# Local CI/CD Release Gate');
  lines.push('');
  lines.push(`- Generated: \`${payload.generatedAt}\``);
  lines.push(`- Profile: \`${options.profile}\``);
  lines.push(`- Summary: ${payload.summary.passed} passed, ${payload.summary.failed} failed, ${payload.summary.blocked} blocked`);
  lines.push('');
  lines.push('## Gates');
  lines.push('');
  for (const gate of gates) {
    lines.push(`- ${gate.status}: ${gate.name} (${gate.id})${gate.detail ? ` — ${gate.detail}` : ''}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This report intentionally omits environment variables and redacts common secret-bearing output patterns.');
  lines.push('- `BLOCKED` means the local machine lacks a required tool, runtime state, or opt-in variable for that gate.');
  lines.push('- Use `npm run release:local-gate:full -- --fail-on-blocked` when you want missing heavy gates to stop the run.');
  fs.writeFileSync(reportMdPath, `${lines.join('\n')}\n`);

  return payload;
}

function main() {
  const options = parseArgs(args);
  const definitions = selectedDefinitions(options);

  if (options.list) {
    for (const definition of gateDefinitions) {
      console.log(`${definition.id}\t${definition.profile}`);
    }
    return;
  }

  if (definitions.length === 0) {
    throw new Error('No local gate checks selected.');
  }

  ensureDir(artifactsDir);
  const gates = [];
  for (const definition of definitions) {
    process.stdout.write(`▶ ${definition.id}\n`);
    try {
      const gate = definition.run();
      gates.push(gate);
      process.stdout.write(`  ${gate.status}: ${gate.detail || gate.name}\n`);
    } catch (error) {
      const gate = fail(definition.id, definition.id, error.stack || error.message || String(error));
      gates.push(gate);
      process.stdout.write(`  FAIL: ${gate.detail}\n`);
    }
  }

  const report = writeReports({ options, gates });
  console.log(`Local CI/CD report written to ${path.relative(repoRoot, reportMdPath)}`);

  if (report.summary.failed > 0) {
    process.exit(1);
  }
  if (options.failOnBlocked && report.summary.blocked > 0) {
    process.exit(2);
  }
}

main();
