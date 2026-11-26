'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
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
    let ownedDecision = 'pending';

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
              reason: 'Only an explicit Owned status can be applied.',
              source_context: {
                enrichment_status: 'failed',
                enrichment_error: 'detail_http_429',
                identifiers: { bluray_product_id: '700' },
                page_metadata: { release_title: 'Unconfirmed collection row Blu-ray' }
              }
            },
            {
              id: 802,
              title: 'Explicitly owned edition',
              source_status: 'Owned',
              status: 'new',
              classification: 'exact_edition',
              decision: ownedDecision,
              candidates: [],
              source_context: {
                url: 'https://www.blu-ray.com/movies/Explicitly-Owned-Edition/701/',
                captured_at: '2026-11-26T00:00:00.000Z',
                extension_version: '0.3.0',
                enrichment_status: 'enriched',
                ownership_basis: 'collection_page',
                identifiers: {
                  bluray_product_id: '701',
                  bluray_content_id: '1701',
                  upc: '012345678905',
                  asin: 'B012345678',
                  imdb_id: 'tt1234567'
                },
                page_metadata: {
                  release_title: 'Explicitly owned edition 4K Blu-ray',
                  media_format: '4K Ultra HD + Blu-ray',
                  edition: 'SteelBook',
                  country: 'United States',
                  release_details: {
                    studio: 'Example Studio',
                    year: '2026',
                    runtime: '120 min',
                    rating: 'Rated PG-13',
                    release_date: 'Nov 26, 2026'
                  },
                  specs: { video: '2160p HDR', audio: 'Dolby Atmos' },
                  ratings: { video: '4.5/5' }
                }
              }
            }
          ]
        })
      });
    });
    await page.route(`**/api/capture-batches/${batchId}/items/802`, async (route) => {
      ownedDecision = 'include';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ item: { id: 802, decision: 'include' } })
      });
    });

    await page.goto('/dashboard?tab=library-capture');
    await expect(page.getByRole('heading', { name: 'Collection batches' })).toBeVisible();
    await page.getByRole('button', { name: /Blu-ray collection/ }).click();

    await expect(page.getByRole('heading', { name: 'Blu-ray edition review' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unconfirmed collection row', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Include', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next edition' })).toBeEnabled();
    await page.getByLabel('Show full collected set').check();
    await page.getByRole('button', { name: 'Next edition' }).click();
    await expect(page.getByRole('heading', { name: 'Explicitly owned edition', exact: true })).toBeVisible();
    await expect(page.getByText('4K Ultra HD + Blu-ray')).toBeVisible();
    await expect(page.getByText('SteelBook')).toBeVisible();
    await expect(page.getByText('012345678905')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Include', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Apply included editions' })).toBeDisabled();
    await page.getByRole('button', { name: 'Include', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply included editions' })).toBeEnabled();
    const evidenceDir = process.env.COLLECTZ_UI_EVIDENCE_DIR;
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440x900.png'), fullPage: true });
    }
    await page.getByRole('tab', { name: 'Technical' }).click();
    await expect(page.getByText('2160p HDR')).toBeVisible();
    await expect(page.getByText('Dolby Atmos')).toBeVisible();
    await page.getByRole('tab', { name: 'Source' }).click();
    await expect(page.getByText('B012345678')).toBeVisible();
    await expect(page.getByText('tt1234567')).toBeVisible();
    await page.getByRole('tab', { name: 'Provenance' }).click();
    await expect(page.getByText(/collection page established ownership/i)).toBeVisible();
    if (evidenceDir) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('tab', { name: 'Editions' }).click();
      await expect(page.getByText('4K Ultra HD + Blu-ray')).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, 'mobile-390x844.png'), fullPage: true });
    }
  });
});
