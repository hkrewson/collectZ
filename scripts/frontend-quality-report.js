const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = path.join(repoRoot, 'artifacts', 'quality');
const args = process.argv.slice(2);
const changedOnly = args.includes('--changed');
const baseArg = args.find((arg) => arg.startsWith('--base='));
const changedBase = baseArg ? baseArg.slice('--base='.length) : 'HEAD';

const SOURCE_SIZE_BASELINES = [
  { path: 'backend/routes/media.js', maxLines: 16379 },
  { path: 'frontend/src/components/EventsView.jsx', maxLines: 6303 },
  { path: 'frontend/src/components/LibraryView.jsx', maxLines: 5753 },
  { path: 'backend/routes/events.js', maxLines: 4491 }
];

function localBin(name) {
  return path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function runTool(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  return {
    command: [path.basename(command), ...args].join(' '),
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function collectChangedPaths(base) {
  const paths = new Set();
  const diffResult = runGit(['diff', '--name-only', '--diff-filter=ACMR', base, '--']);
  if (diffResult.status === 0) {
    String(diffResult.stdout || '')
      .split(/\r?\n/)
      .map((entry) => normalizePath(entry.trim()))
      .filter(Boolean)
      .forEach((entry) => paths.add(entry));
  }

  const stagedResult = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--']);
  if (stagedResult.status === 0) {
    String(stagedResult.stdout || '')
      .split(/\r?\n/)
      .map((entry) => normalizePath(entry.trim()))
      .filter(Boolean)
      .forEach((entry) => paths.add(entry));
  }

  const statusResult = runGit(['status', '--short']);
  if (statusResult.status === 0) {
    String(statusResult.stdout || '')
      .split(/\r?\n/)
      .map((line) => normalizePath(line.slice(3).trim()))
      .filter(Boolean)
      .forEach((entry) => paths.add(entry));
  }

  return [...paths].sort();
}

function selectChangedTargets(paths) {
  const eslintTargets = paths.filter(
    (entry) => /^frontend\/src\/.*\.(js|jsx)$/.test(entry) || /^scripts\/.*\.js$/.test(entry) || /^tests\/playwright\/.*\.js$/.test(entry)
  );
  const prettierTargets = paths.filter(
    (entry) => /^frontend\/src\//.test(entry) || /^scripts\//.test(entry) || /^tests\/playwright\//.test(entry)
  );
  return {
    eslintTargets,
    prettierTargets
  };
}

function parseEslintJson(output) {
  if (!output.trim()) return [];
  try {
    return JSON.parse(output);
  } catch (error) {
    return [{ filePath: 'eslint-output', messages: [{ severity: 2, message: `Could not parse ESLint JSON: ${error.message}` }] }];
  }
}

function summarizeEslintRules(results) {
  const rules = new Map();
  for (const fileResult of results) {
    for (const message of fileResult.messages || []) {
      const ruleId = message.ruleId || 'fatal';
      const current = rules.get(ruleId) || { ruleId, errors: 0, warnings: 0, total: 0 };
      if (Number(message.severity) === 2) current.errors += 1;
      else current.warnings += 1;
      current.total += 1;
      rules.set(ruleId, current);
    }
  }
  return [...rules.values()].sort((a, b) => b.total - a.total || a.ruleId.localeCompare(b.ruleId));
}

function summarizeEslintFiles(results) {
  return results
    .map((fileResult) => ({
      path: normalizePath(path.relative(repoRoot, fileResult.filePath || '')),
      errors: Number(fileResult.errorCount || 0),
      warnings: Number(fileResult.warningCount || 0),
      total: Number(fileResult.errorCount || 0) + Number(fileResult.warningCount || 0)
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));
}

function summarizeEslint(results) {
  return results.reduce(
    (summary, fileResult) => {
      summary.files += 1;
      summary.errors += Number(fileResult.errorCount || 0);
      summary.warnings += Number(fileResult.warningCount || 0);
      return summary;
    },
    { files: 0, errors: 0, warnings: 0 }
  );
}

function lineCount(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!source) return 0;
  return source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
}

function collectSourceSizeReport() {
  return SOURCE_SIZE_BASELINES.map((entry) => {
    const currentLines = lineCount(entry.path);
    return {
      path: entry.path,
      currentLines,
      maxLines: entry.maxLines,
      status: currentLines > entry.maxLines ? 'warning' : 'ok',
      delta: currentLines - entry.maxLines
    };
  });
}

function writeMarkdownReport(report) {
  const modeLabel = report.mode === 'changed' ? `Changed files since ${report.changed.base}` : 'Full frontend baseline';
  const lines = [
    '# Frontend Quality Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${modeLabel}`,
    '',
    '## ESLint',
    '',
    `- Files checked: ${report.eslint.summary.files}`,
    `- Errors: ${report.eslint.summary.errors}`,
    `- Warnings: ${report.eslint.summary.warnings}`,
    `- Exit status: ${report.eslint.status}`,
    '',
    '### Top ESLint Rules',
    '',
    '| Rule | Total | Errors | Warnings |',
    '| --- | ---: | ---: | ---: |',
    ...(report.eslint.ruleSummary
      .slice(0, 12)
      .map((entry) => `| ${entry.ruleId} | ${entry.total} | ${entry.errors} | ${entry.warnings} |`) || []),
    '',
    '### Top ESLint Files',
    '',
    '| File | Total | Errors | Warnings |',
    '| --- | ---: | ---: | ---: |',
    ...(report.eslint.fileSummary.slice(0, 12).map((entry) => `| ${entry.path} | ${entry.total} | ${entry.errors} | ${entry.warnings} |`) ||
      []),
    '',
    '## Prettier',
    '',
    `- Exit status: ${report.prettier.status}`,
    `- Report-first status: ${report.prettier.status === 0 ? 'clean' : 'findings reported'}`,
    '',
    '## Source Size',
    '',
    '| File | Lines | Warning baseline | Status |',
    '| --- | ---: | ---: | --- |',
    ...report.sourceSize.map((entry) => `| ${entry.path} | ${entry.currentLines} | ${entry.maxLines} | ${entry.status} |`),
    '',
    'This command is intentionally report-first for the 3.23.x foundation slices.'
  ];

  if (report.mode === 'changed') {
    lines.splice(
      4,
      0,
      '',
      '## Changed Targets',
      '',
      `- Changed paths seen: ${report.changed.paths.length}`,
      `- ESLint targets: ${report.changed.eslintTargets.length}`,
      `- Prettier targets: ${report.changed.prettierTargets.length}`
    );
  }

  const suffix = report.mode === 'changed' ? 'changed' : 'frontend';
  fs.writeFileSync(path.join(artifactDir, `${suffix}-quality-report.md`), `${lines.join('\n')}\n`);
}

function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const changed = changedOnly
    ? { base: changedBase, paths: collectChangedPaths(changedBase), eslintTargets: [], prettierTargets: [] }
    : null;
  if (changed) {
    const targets = selectChangedTargets(changed.paths);
    changed.eslintTargets = targets.eslintTargets;
    changed.prettierTargets = targets.prettierTargets;
  }

  const eslintArgs = changed ? [...changed.eslintTargets, '--format', 'json'] : ['frontend/src', '--format', 'json'];
  const prettierArgs = changed
    ? ['--check', ...changed.prettierTargets, '--ignore-unknown']
    : ['--check', 'frontend/src', 'scripts', 'tests/playwright', '--ignore-unknown'];
  const eslintRun = eslintArgs.length > 2 ? runTool(localBin('eslint'), eslintArgs) : { status: 0, signal: null, stdout: '[]', stderr: '' };
  const eslintResults = parseEslintJson(eslintRun.stdout);
  const prettierRun =
    prettierArgs.length > 3 ? runTool(localBin('prettier'), prettierArgs) : { status: 0, signal: null, stdout: '', stderr: '' };
  const sourceSize = collectSourceSizeReport();
  const suffix = changed ? 'changed' : 'frontend';

  const report = {
    generatedAt: new Date().toISOString(),
    mode: changed ? 'changed' : 'full',
    changed,
    eslint: {
      status: eslintRun.status,
      signal: eslintRun.signal,
      summary: summarizeEslint(eslintResults),
      ruleSummary: summarizeEslintRules(eslintResults),
      fileSummary: summarizeEslintFiles(eslintResults),
      results: eslintResults,
      stderr: eslintRun.stderr
    },
    prettier: {
      status: prettierRun.status,
      signal: prettierRun.signal,
      stdout: prettierRun.stdout,
      stderr: prettierRun.stderr
    },
    sourceSize
  };

  fs.writeFileSync(path.join(artifactDir, `${suffix}-quality-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdownReport(report);

  console.log(
    `ESLint: ${report.eslint.summary.errors} errors, ${report.eslint.summary.warnings} warnings across ${report.eslint.summary.files} files`
  );
  console.log(`Prettier: ${report.prettier.status === 0 ? 'clean' : 'findings reported'}`);
  console.log(`Source size: ${sourceSize.filter((entry) => entry.status === 'warning').length} warning(s)`);
  if (changed) {
    console.log(
      `Changed paths: ${changed.paths.length}; ESLint targets: ${changed.eslintTargets.length}; Prettier targets: ${changed.prettierTargets.length}`
    );
  }
  console.log(`Wrote artifacts/quality/${suffix}-quality-report.{json,md}`);
  process.exit(0);
}

main();
