const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'playwright');
const PLAYWRIGHT_STATE_DIR = path.resolve(__dirname, 'tmp', 'playwright-auth');
const AUTH_STATE_PATH = path.join(PLAYWRIGHT_STATE_DIR, 'admin.json');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const PLAYWRIGHT_BYPASS_TOKEN = process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '';

module.exports = defineConfig({
  testDir: path.resolve(__dirname, 'tests', 'playwright'),
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: path.join(ARTIFACTS_DIR, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACTS_DIR, 'report'), open: 'never' }]
  ],
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: PLAYWRIGHT_BYPASS_TOKEN
      ? { 'x-playwright-e2e-bypass': PLAYWRIGHT_BYPASS_TOKEN }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.js/
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_PATH
      },
      dependencies: ['setup']
    }
  ]
});
