const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './specs', testMatch: 'tv-activation.browser.spec.js', workers: 1, timeout: 60000,
  use: { baseURL: process.env.PLAYWRIGHT_TV_BASE_URL || 'http://localhost:3399', trace: 'off', screenshot: 'off', video: 'off' },
  reporter: [['list']], outputDir: '../../artifacts/tv-browser' });
