#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const appMeta = require(path.join(repoRoot, 'app-meta.json'));

const outputPath = process.env.OBSERVABILITY_EVIDENCE_OUTPUT
  ? path.resolve(process.env.OBSERVABILITY_EVIDENCE_OUTPUT)
  : path.join(repoRoot, 'artifacts', 'observability-evidence', 'observability-release-evidence.json');

function runCommand(name, command, args, { env = process.env, cwd = repoRoot } = {}) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8'
  });
  const durationMs = Date.now() - startMs;
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return {
    name,
    kind: 'automated',
    status: result.status === 0 ? 'passed' : 'failed',
    command: [command, ...args].join(' '),
    startedAt,
    durationMs,
    exitCode: result.status,
    stdout,
    stderr
  };
}

function blockedCheck(name, reason, guidance) {
  return {
    name,
    kind: 'manual_or_future_automation',
    status: 'blocked',
    reason,
    guidance
  };
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc.total += 1;
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 });
}

function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const checks = [
    runCommand(
      'monitoring_persistence_rehearsal',
      'bash',
      ['ops/monitoring/verify-monitoring-persistence.sh']
    ),
    runCommand(
      'graylog_persistence_rehearsal',
      'bash',
      ['ops/logging/verify-graylog-persistence.sh']
    ),
    runCommand(
      'loki_persistence_rehearsal',
      'bash',
      ['ops/logging/verify-loki-persistence.sh']
    ),
    runCommand(
      'main_stack_health',
      'curl',
      ['-sS', 'http://localhost:3000/api/health']
    ),
    blockedCheck(
      'graylog_collector_smoke',
      'Not yet orchestrated by the release evidence runner.',
      'Run the Graylog collector smoke with the required admin and Graylog credentials, then attach the evidence or promote that path into the runner later.'
    ),
    blockedCheck(
      'loki_collector_smoke',
      'Not yet orchestrated by the release evidence runner.',
      'Run the Loki collector smoke with the required backend export mode and admin credentials, then attach the evidence or promote that path into the runner later.'
    ),
    blockedCheck(
      'syslog_collector_smoke',
      'Not yet orchestrated by the release evidence runner.',
      'Run the syslog collector smoke with the required backend export mode and admin credentials, then attach the evidence or promote that path into the runner later.'
    ),
    blockedCheck(
      'nonblocking_export_failure_smoke',
      'Not yet orchestrated by the release evidence runner.',
      'Run the intentional bad-collector rehearsal plus structured-log-nonblocking-smoke and capture that evidence when doing a release-shaped closeout.'
    )
  ];

  const evidence = {
    generatedAt: new Date().toISOString(),
    appVersion: appMeta.version,
    scope: 'release_evidence_first',
    outputIntent: 'Local or release-shaped observability evidence artifact',
    checks,
    summary: summarize(checks)
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Observability release evidence written to ${outputPath}`);

  const failedChecks = checks.filter((check) => check.status === 'failed');
  if (failedChecks.length > 0) {
    console.error(`Observability release evidence failed: ${failedChecks.map((check) => check.name).join(', ')}`);
    process.exit(1);
  }
}

main();
