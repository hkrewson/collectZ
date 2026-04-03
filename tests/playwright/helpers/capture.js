'use strict';

const fs = require('fs');
const path = require('path');

const PLAYWRIGHT_ARTIFACTS_DIR = path.resolve(__dirname, '..', '..', '..', 'artifacts', 'playwright');
const PLAYWRIGHT_CAPTURES_DIR = path.join(PLAYWRIGHT_ARTIFACTS_DIR, 'captures');

async function ensureCaptureDirectory() {
  await fs.promises.mkdir(PLAYWRIGHT_CAPTURES_DIR, { recursive: true });
}

async function captureNamedPage(page, name, options = {}) {
  await ensureCaptureDirectory();
  const filename = `${String(name || 'capture').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.png`;
  const outputPath = path.join(PLAYWRIGHT_CAPTURES_DIR, filename);
  await page.screenshot({
    path: outputPath,
    fullPage: options.fullPage ?? true,
    animations: 'disabled'
  });
  return outputPath;
}

module.exports = {
  PLAYWRIGHT_CAPTURES_DIR,
  captureNamedPage
};
