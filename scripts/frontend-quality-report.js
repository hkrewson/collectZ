const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = path.join(repoRoot, 'artifacts', 'quality');

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

function parseEslintJson(output) {
  if (!output.trim()) return [];
  try {
    return JSON.parse(output);
  } catch (error) {
    return [{ filePath: 'eslint-output', messages: [{ severity: 2, message: `Could not parse ESLint JSON: ${error.message}` }] }];
  }
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
  const lines = [
    '# Frontend Quality Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## ESLint',
    '',
    `- Files checked: ${report.eslint.summary.files}`,
    `- Errors: ${report.eslint.summary.errors}`,
    `- Warnings: ${report.eslint.summary.warnings}`,
    `- Exit status: ${report.eslint.status}`,
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
    'This command is intentionally report-first for the 3.23.0 foundation slice.'
  ];

  fs.writeFileSync(path.join(artifactDir, 'frontend-quality-report.md'), `${lines.join('\n')}\n`);
}

function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const eslintRun = runTool(localBin('eslint'), ['frontend/src', '--format', 'json']);
  const eslintResults = parseEslintJson(eslintRun.stdout);
  const prettierRun = runTool(localBin('prettier'), ['--check', 'frontend/src', 'scripts', 'tests/playwright', '--ignore-unknown']);
  const sourceSize = collectSourceSizeReport();

  const report = {
    generatedAt: new Date().toISOString(),
    eslint: {
      status: eslintRun.status,
      signal: eslintRun.signal,
      summary: summarizeEslint(eslintResults),
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

  fs.writeFileSync(path.join(artifactDir, 'frontend-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeMarkdownReport(report);

  console.log(
    `ESLint: ${report.eslint.summary.errors} errors, ${report.eslint.summary.warnings} warnings across ${report.eslint.summary.files} files`
  );
  console.log(`Prettier: ${report.prettier.status === 0 ? 'clean' : 'findings reported'}`);
  console.log(`Source size: ${sourceSize.filter((entry) => entry.status === 'warning').length} warning(s)`);
  console.log('Wrote artifacts/quality/frontend-quality-report.{json,md}');
  process.exit(0);
}

main();
