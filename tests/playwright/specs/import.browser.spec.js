'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('import browser regressions', () => {
  test('end user sees the current import surface with file and connected-service tabs but no standalone barcode tab', async ({ page }) => {
    const credentials = await createFreshUserCredentials();

    await signInThroughUi(page, credentials);
    await page.evaluate(() => {
      localStorage.setItem(
        'collectz_import_jobs',
        JSON.stringify([
          {
            id: 999999,
            provider: 'bookorbit',
            status: 'succeeded',
            progress: { total: 12, processed: 12, created: 9, updated: 0, skipped: 2, errorCount: 1 },
            summary: { completedWithErrors: true, completedWithSkips: true, duplicateTitleReviewRows: 3 }
          }
        ])
      );
    });
    await page.reload();
    await page.goto('/dashboard?tab=library-import');

    await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Import sources' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'BookOrbit', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Calibre', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'CSV', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Delicious', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Capture Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Barcode', exact: true })).toHaveCount(0);
    await expect(page.getByText('Job #999999 · bookorbit · completed with errors')).toBeVisible();
    await expect(page.getByText('Review 3 provider records with duplicate or low-confidence metadata')).toBeVisible();

    await page.getByRole('tab', { name: 'CSV', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose CSV File', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Delicious', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose Delicious CSV', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'BookOrbit', exact: true }).click();
    await expect(page.getByText('No active BookOrbit connection is available.')).toBeVisible();

    await page.getByRole('tab', { name: 'Capture Inbox', exact: true }).click();
    await expect(page).toHaveURL(/\/library\/capture$/);
    await expect(page.getByRole('heading', { name: 'Capture Inbox', exact: true })).toBeVisible();
  });

  test('collection batch review stays conflict-first and requires explicit ownership before include', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ noCache: true });
    const batchId = '11111111-2222-4333-8444-555555555555';
    const batch = {
      id: batchId,
      source_provider: 'blu-ray.com',
      source_url: 'https://www.blu-ray.com/community/collection.php',
      status: 'ready',
      current_page: 2,
      total_pages: 2,
      received_item_count: 2,
      applied_item_count: 0,
      failed_item_count: 0
    };

    await signInThroughUi(page, credentials);
    await page.route('**/api/capture-batches?status=active', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ batches: [batch] }) });
    });
    await page.route(`**/api/capture-batches/${batchId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batch,
          items: [
            {
              id: 801,
              title: 'Unconfirmed collection row',
              source_status: null,
              status: 'new',
              classification: 'needs_review',
              decision: 'pending',
              candidates: [],
              reason: 'Only an explicit Owned status can be applied.'
            },
            {
              id: 802,
              title: 'Explicitly owned edition',
              source_status: 'Owned',
              status: 'new',
              classification: 'exact_edition',
              decision: 'include',
              candidates: []
            }
          ]
        })
      });
    });

    await page.goto('/dashboard?tab=library-capture');
    await expect(page.getByRole('heading', { name: 'Collection batches' })).toBeVisible();
    await page.getByRole('button', { name: /Blu-ray collection/ }).click();

    await expect(page.getByRole('heading', { name: 'Blu-ray edition review' })).toBeVisible();
    await expect(page.getByText('Unconfirmed collection row')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Include', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next edition' })).toBeDisabled();

    await page.getByLabel('Show full collected set').check();
    await page.getByRole('button', { name: 'Next edition' }).click();
    await expect(page.getByText('Explicitly owned edition')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Include', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Apply included editions' })).toBeEnabled();
  });
});
