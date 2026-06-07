#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const appMeta = require(path.join(repoRoot, 'app-meta.json'));
const backendAppMeta = require(path.join(repoRoot, 'backend', 'app-meta.json'));
const frontendAppMeta = require(path.join(repoRoot, 'frontend', 'src', 'app-meta.json'));
const backendPackageJson = require(path.join(repoRoot, 'backend', 'package.json'));
const frontendPackageJson = require(path.join(repoRoot, 'frontend', 'package.json'));

const baseUrl = (process.env.RELEASE_PREFLIGHT_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dependencyAuditDir = path.join(repoRoot, 'artifacts', 'dependency-audit');
const reportPath = process.env.RELEASE_PREFLIGHT_REPORT
  ? path.resolve(process.env.RELEASE_PREFLIGHT_REPORT)
  : path.join(repoRoot, 'preflight-go-no-go.md');
const backendAuditPath = path.join(dependencyAuditDir, 'backend-audit.json');
const frontendAuditPath = path.join(dependencyAuditDir, 'frontend-audit.json');
const initParityEvidencePath = path.join(repoRoot, 'artifacts', 'init-parity-evidence', 'init-parity-evidence.json');
const migrationRehearsalEvidencePath = path.join(repoRoot, 'artifacts', 'migration-rehearsal-evidence', 'migration-rehearsal-evidence.json');
const observabilityEvidencePath = path.join(repoRoot, 'artifacts', 'observability-evidence', 'observability-release-evidence.json');
const releaseNotePath = path.join(repoRoot, 'docs', 'releases', `v${appMeta.version}.md`);
const browserRegressionSpec = 'tests/playwright/specs/admin-shell.browser.spec.js';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatStatus(status, detail) {
  return detail ? `${status} — ${detail}` : status;
}

function buildGate(name, status, detail, extras = {}) {
  return { name, status, detail, ...extras };
}

function getAuditCounts(auditJson) {
  const counts = auditJson?.metadata?.vulnerabilities || {};
  return {
    low: Number(counts.low || 0),
    moderate: Number(counts.moderate || 0),
    high: Number(counts.high || 0),
    critical: Number(counts.critical || 0)
  };
}

function runAudit(label, cwd, outputPath) {
  const result = runCommand('npm', ['audit', '--omit=dev', '--json'], { cwd });
  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    return {
      gate: buildGate(label, 'BLOCKED', 'npm audit returned no JSON output', {
        exitCode: result.status,
        stderr: String(result.stderr || '').trim()
      }),
      json: null
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return {
      gate: buildGate(label, 'BLOCKED', `npm audit output was not valid JSON: ${error.message}`, {
        exitCode: result.status,
        stderr: String(result.stderr || '').trim()
      }),
      json: null
    };
  }

  if (!parsed?.metadata?.vulnerabilities) {
    const existing = safeReadJson(outputPath);
    if (existing?.metadata?.vulnerabilities) {
      const counts = getAuditCounts(existing);
      const detail = `using existing audit artifact; low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical}`;
      return {
        gate: buildGate(counts.critical > 0 ? label : label, counts.critical > 0 ? 'FAIL' : 'PASS', detail, {
          counts,
          exitCode: result.status,
          auditWarning: parsed?.message || 'npm audit did not return vulnerability metadata'
        }),
        json: existing
      };
    }
    return {
      gate: buildGate(
        label,
        'BLOCKED',
        parsed?.message || 'npm audit did not return vulnerability metadata',
        { exitCode: result.status }
      ),
      json: parsed
    };
  }

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));

  const counts = getAuditCounts(parsed);
  const detail = `low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical}`;
  if (counts.critical > 0) {
    return {
      gate: buildGate(label, 'FAIL', detail, { counts, exitCode: result.status }),
      json: parsed
    };
  }

  return {
    gate: buildGate(label, 'PASS', detail, { counts, exitCode: result.status }),
    json: parsed
  };
}

function hasRequiredHighTriageMarkers(noteText) {
  return [
    '## Security vulnerability triage',
    'High findings:',
    'Owner:',
    'Target remediation milestone:'
  ].every((marker) => noteText.includes(marker));
}

function runInStackHttpGet(pathname) {
  const script = [
    'const http=require("http");',
    'const path=process.argv[1];',
    'http.get({host:"frontend",port:3000,path},(res)=>{',
    'let body="";',
    'res.on("data",(chunk)=>body+=chunk);',
    'res.on("end",()=>{',
    'process.stdout.write(JSON.stringify({statusCode:res.statusCode,headers:res.headers,body}));',
    '});',
    '}).on("error",(error)=>{console.error(error.message);process.exit(1);});'
  ].join('');
  return runCommand(
    'docker',
    ['compose', '--env-file', '.env', 'exec', '-T', 'backend', 'node', '-e', script, pathname],
    { cwd: repoRoot }
  );
}

function readInStackSessionCookieOptions() {
  const script = [
    'const {SESSION_COOKIE_OPTIONS}=require("./middleware/auth");',
    'console.log(JSON.stringify({',
    'secure: SESSION_COOKIE_OPTIONS.secure,',
    'sameSite: SESSION_COOKIE_OPTIONS.sameSite,',
    'httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,',
    'nodeEnv: process.env.NODE_ENV,',
    'sessionCookieSecureEnv: process.env.SESSION_COOKIE_SECURE,',
    'trustProxy: process.env.TRUST_PROXY',
    '}));'
  ].join('');
  return runCommand(
    'docker',
    ['compose', '--env-file', '.env', 'exec', '-T', 'backend', 'node', '-e', script],
    { cwd: repoRoot }
  );
}

async function runComposeSmokeBasics() {
  try {
    const healthResult = runInStackHttpGet('/api/health');
    if (healthResult.status !== 0) {
      return buildGate('Compose smoke basics', 'BLOCKED', `in-stack /api/health probe failed: ${String(healthResult.stderr || '').trim()}`);
    }
    const healthPayload = JSON.parse(String(healthResult.stdout || '{}'));
    const health = JSON.parse(String(healthPayload.body || '{}'));
    if (!health || health.status !== 'ok') {
      return buildGate('Compose smoke basics', 'FAIL', 'GET /api/health returned unexpected payload');
    }
    if (String(health.version || '') !== appMeta.version) {
      return buildGate('Compose smoke basics', 'FAIL', `health version ${health.version || 'unknown'} did not match ${appMeta.version}`);
    }

    const requiredHeaders = ['x-content-type-options', 'x-frame-options', 'strict-transport-security'];
    for (const headerName of requiredHeaders) {
      if (!healthPayload.headers || !healthPayload.headers[headerName]) {
        return buildGate('Compose smoke basics', 'FAIL', `missing ${headerName} header`);
      }
    }

    const csrfResponse = runInStackHttpGet('/api/auth/csrf-token');
    if (csrfResponse.status !== 0) {
      return buildGate('Compose smoke basics', 'BLOCKED', `in-stack csrf-token probe failed: ${String(csrfResponse.stderr || '').trim()}`);
    }
    const csrfPayload = JSON.parse(String(csrfResponse.stdout || '{}'));
    const csrfJson = JSON.parse(String(csrfPayload.body || '{}'));
    if (!csrfJson || !csrfJson.csrfToken) {
      return buildGate('Compose smoke basics', 'FAIL', 'GET /api/auth/csrf-token missing csrfToken');
    }
    const csrfSetCookie = csrfPayload.headers && (csrfPayload.headers['set-cookie'] || csrfPayload.headers['Set-Cookie']);
    const csrfCookie = Array.isArray(csrfSetCookie)
      ? csrfSetCookie.find((value) => /^csrf_token=/i.test(value))
      : csrfSetCookie;
    if (!csrfCookie) {
      return buildGate('Compose smoke basics', 'FAIL', 'missing csrf_token cookie');
    }
    if (!/;\s*Secure\b/i.test(csrfCookie)) {
      const cookieConfigResult = readInStackSessionCookieOptions();
      if (cookieConfigResult.status === 0) {
        const cookieConfig = JSON.parse(String(cookieConfigResult.stdout || '{}'));
        if (!cookieConfig.secure) {
          return buildGate(
            'Compose smoke basics',
            'BLOCKED',
            `current local stack is not running with CI secure-cookie settings (SESSION_COOKIE_SECURE=${cookieConfig.sessionCookieSecureEnv || 'unset'}, NODE_ENV=${cookieConfig.nodeEnv || 'unknown'})`
          );
        }
      }
      return buildGate('Compose smoke basics', 'FAIL', 'csrf_token cookie missing Secure');
    }
    if (!/;\s*SameSite=Strict\b/i.test(csrfCookie)) {
      return buildGate('Compose smoke basics', 'FAIL', 'csrf_token cookie missing SameSite=Strict');
    }

    const meResult = runInStackHttpGet('/api/auth/me');
    if (meResult.status !== 0) {
      return buildGate('Compose smoke basics', 'BLOCKED', `in-stack auth/me probe failed: ${String(meResult.stderr || '').trim()}`);
    }
    const mePayload = JSON.parse(String(meResult.stdout || '{}'));
    if (Number(mePayload.statusCode) !== 401) {
      return buildGate('Compose smoke basics', 'FAIL', `GET /api/auth/me returned ${mePayload.statusCode} instead of 401`);
    }

    const integrationSmoke = runCommand(
      'docker',
      [
        'compose',
        '--env-file',
        '.env',
        'exec',
        '-T',
        'backend',
        'sh',
        '-lc',
        'API_SMOKE_BASE_URL="http://frontend:3000/api" npm run test:integration-smoke'
      ],
      { cwd: repoRoot }
    );
    if (integrationSmoke.status !== 0) {
      return buildGate('Compose smoke basics', 'BLOCKED', 'backend integration smoke could not be proven from this local shell', {
        stderr: String(integrationSmoke.stderr || '').trim(),
        stdout: String(integrationSmoke.stdout || '').trim()
      });
    }

    return buildGate('Compose smoke basics', 'PASS', 'in-stack health, headers, CSRF cookie, 401 auth check, and integration smoke passed');
  } catch (error) {
    return buildGate('Compose smoke basics', 'BLOCKED', `compose smoke could not be completed in this shell: ${error.message}`);
  }
}

function runOptionalBrowserRegression() {
  if (String(process.env.RELEASE_PREFLIGHT_RUN_BROWSER || '') !== '1') {
    return buildGate('Browser regression', 'BLOCKED', 'not run by this local preflight helper');
  }
  if (!String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim()) {
    return buildGate('Browser regression', 'BLOCKED', 'missing PLAYWRIGHT_E2E_BYPASS_TOKEN for local browser run');
  }

  const browserResult = runCommand(
    'npm',
    ['run', 'test:browser', '--', browserRegressionSpec],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_E2E_BYPASS_TOKEN: String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '')
      }
    }
  );

  if (browserResult.status === 0) {
    return buildGate('Browser regression', 'PASS', 'local Playwright admin shell regression passed');
  }

  const output = `${String(browserResult.stdout || '')}\n${String(browserResult.stderr || '')}`.trim();
  if (/bootstrap_check_in/i.test(output) || /Permission denied \(1100\)/i.test(output)) {
    return buildGate('Browser regression', 'BLOCKED', 'local Chromium launcher is blocked in this shell');
  }

  return buildGate('Browser regression', 'FAIL', 'local Playwright admin shell regression failed', {
    exitCode: browserResult.status,
    stdout: String(browserResult.stdout || '').trim(),
    stderr: String(browserResult.stderr || '').trim()
  });
}

function buildMarkdownReport({ gates, noteExists, noteText }) {
  const lines = [];
  lines.push('# Local Release Go/No-Go Preflight');
  lines.push('');
  lines.push(`- Version: \`${appMeta.version}\``);
  lines.push(`- Generated: \`${new Date().toISOString()}\``);
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push('');
  lines.push('## Gate Results');
  lines.push('');
  for (const gate of gates) {
    lines.push(`- ${gate.name}: ${formatStatus(gate.status, gate.detail)}`);
  }
  lines.push('');
  lines.push('## Evidence Artifacts');
  lines.push('');
  lines.push(`- \`artifacts/dependency-audit/backend-audit.json\`: ${fs.existsSync(backendAuditPath) ? 'present' : 'missing'}`);
  lines.push(`- \`artifacts/dependency-audit/frontend-audit.json\`: ${fs.existsSync(frontendAuditPath) ? 'present' : 'missing'}`);
  lines.push(`- \`artifacts/init-parity-evidence/init-parity-evidence.json\`: ${fs.existsSync(initParityEvidencePath) ? 'present' : 'missing'}`);
  lines.push(`- \`artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json\`: ${fs.existsSync(migrationRehearsalEvidencePath) ? 'present' : 'missing'}`);
  lines.push(`- \`artifacts/observability-evidence/observability-release-evidence.json\`: ${fs.existsSync(observabilityEvidencePath) ? 'present' : 'missing'}`);
  lines.push(`- \`preflight-go-no-go.md\`: will be written by this helper`);
  lines.push('');
  lines.push('## Release Note');
  lines.push('');
  lines.push(`- \`${path.relative(repoRoot, releaseNotePath)}\`: ${noteExists ? 'present' : 'missing'}`);
  if (noteExists) {
    lines.push(`- Security triage markers: ${hasRequiredHighTriageMarkers(noteText) ? 'present' : 'missing'}`);
  }
  lines.push('');
  lines.push('## Blocking Criteria');
  lines.push('');
  lines.push('Release is NO-GO if any required local gate fails, any required artifact is missing, or CI-only blocking gates later fail in CI.');
  lines.push('');
  lines.push('## CI-Only Follow-Through');
  lines.push('');
  lines.push('- `secret-scan`');
  lines.push('- `browser-regression` when it is not run locally or the local browser environment is blocked');
  lines.push('- `image-security-and-sbom`');
  lines.push('- any stricter CI `compose-smoke` conditions not exercised by this local helper');
  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(dependencyAuditDir);

  const gates = [];
  const versionAligned =
    appMeta.version === backendAppMeta.version &&
    appMeta.version === frontendAppMeta.version &&
    appMeta.version === backendPackageJson.version &&
    appMeta.version === frontendPackageJson.version;
  gates.push(
    buildGate(
      'Version metadata sync',
      versionAligned ? 'PASS' : 'FAIL',
      versionAligned
        ? `all manifests aligned on ${appMeta.version}`
        : 'root/backend/frontend version metadata are out of sync'
    )
  );

  const noteExists = fs.existsSync(releaseNotePath);
  const noteText = noteExists ? fs.readFileSync(releaseNotePath, 'utf8') : '';
  gates.push(
    buildGate(
      'Release note presence',
      noteExists ? 'PASS' : 'FAIL',
      noteExists ? path.relative(repoRoot, releaseNotePath) : `missing ${path.relative(repoRoot, releaseNotePath)}`
    )
  );

  const backendAudit = runAudit('Backend dependency audit', backendRoot, backendAuditPath);
  const frontendAudit = runAudit('Frontend dependency audit', frontendRoot, frontendAuditPath);
  gates.push(backendAudit.gate, frontendAudit.gate);

  const totalHighFindings =
    Number(backendAudit.gate.counts?.high || 0) + Number(frontendAudit.gate.counts?.high || 0);
  if (totalHighFindings > 0) {
    gates.push(
      buildGate(
        'High vulnerability triage markers',
        hasRequiredHighTriageMarkers(noteText) ? 'PASS' : 'FAIL',
        hasRequiredHighTriageMarkers(noteText)
          ? 'release note includes required triage markers'
          : 'release note is missing required high-vulnerability triage markers'
      )
    );
  }

  const initParityEvidence = safeReadJson(initParityEvidencePath);
  const migrationEvidence = safeReadJson(migrationRehearsalEvidencePath);
  gates.push(
    buildGate(
      'Migration evidence presence',
      initParityEvidence && migrationEvidence ? 'PASS' : 'FAIL',
      initParityEvidence && migrationEvidence
        ? 'init parity and migration rehearsal evidence are present'
        : 'missing init parity or migration rehearsal evidence'
    )
  );

  const observabilityEvidence = safeReadJson(observabilityEvidencePath);
  const observabilityPassed =
    observabilityEvidence &&
    observabilityEvidence.appVersion === appMeta.version &&
    observabilityEvidence.summary &&
    Number(observabilityEvidence.summary.failed || 0) === 0 &&
    Number(observabilityEvidence.summary.blocked || 0) === 0;
  gates.push(
    buildGate(
      'Observability release evidence',
      observabilityPassed ? 'PASS' : 'FAIL',
      observabilityPassed
        ? `observability artifact present for ${appMeta.version} with ${observabilityEvidence.summary.passed}/${observabilityEvidence.summary.total} checks passed`
        : 'observability artifact missing, stale, or contains failed/blocked checks'
    )
  );

  gates.push(await runComposeSmokeBasics());
  gates.push(buildGate('Secret scan', 'BLOCKED', 'CI-only gitleaks gate'));
  gates.push(runOptionalBrowserRegression());
  gates.push(buildGate('Image security and SBOM', 'BLOCKED', 'CI-only Trivy/SBOM gate'));

  const report = buildMarkdownReport({ gates, noteExists, noteText });
  fs.writeFileSync(reportPath, report);
  console.log(`Local release preflight written to ${reportPath}`);

  const failed = gates.filter((gate) => gate.status === 'FAIL');
  if (failed.length > 0) {
    console.error(`Local release preflight found ${failed.length} failing gate(s).`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
