'use strict';

const fs = require('fs/promises');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');
const { waitForSyncJob } = require('../helpers/importJobs');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('csv import browser regressions', () => {
  test('end user can upload a generic CSV, wait for the queued job to finish, and find the imported title in the library', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright CSV Import ${Date.now()}`;
    const csvPath = path.resolve(__dirname, '..', '..', '..', 'tmp', `playwright-import-${Date.now()}.csv`);
    const csvBody = [
      'title,media_type,year,format,notes',
      `"${title.replace(/"/g, '""')}",movie,2024,Blu-ray,"Seeded browser CSV import coverage row."`
    ].join('\n');

    await fs.mkdir(path.dirname(csvPath), { recursive: true });
    await fs.writeFile(csvPath, csvBody, 'utf8');
    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await signInThroughUi(page, credentials);
      await page.goto('/dashboard?tab=library-import');
      await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();
      await page.getByRole('button', { name: 'CSV' }).click();

      const importResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/import-csv')
          && response.request().method() === 'POST'
      ));
      await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(csvPath);
      const importResponse = await importResponsePromise;
      expect(importResponse.status()).toBe(202);
      const importPayload = await importResponse.json();
      const jobId = Number(importPayload?.job?.id || 0);
      expect(jobId).toBeGreaterThan(0);

      await expect(page.getByText(`CSV import queued (job #${jobId})`, { exact: true })).toBeVisible();

      const completedJob = await waitForSyncJob(requestContext, jobId, { timeoutMs: 30000, pollIntervalMs: 500 });
      expect(completedJob.status).toBe('succeeded');

      await page.goto('/dashboard?tab=library-movies');
      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await fs.unlink(csvPath).catch(() => {});
      await requestContext.dispose();
    }
  });
});
