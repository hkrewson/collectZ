'use strict';

const { test, expect } = require('@playwright/test');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { getIntegrationSettings, snapshotIntegrationState, restoreIntegrationState } = require('../helpers/integrations');
const { signInThroughUi } = require('../helpers/session');

async function openIntegrationsSection(page, name) {
  const tab = page.getByRole('tablist', { name: 'Integration sections' }).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function expectPlatformRuntime(page) {
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Integration sections' }).getByRole('tab')).toHaveText([
    'External Logs',
    'Metrics'
  ]);
}

async function openWorkspaceIntegrations(page) {
  await page.goto('/dashboard?tab=space-manage');
  const workspaceSections = page.getByLabel('Workspace sections');
  await expect(workspaceSections.getByRole('button', { name: 'Integrations', exact: true })).toBeVisible();
  await workspaceSections.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Integration sections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspace Integrations', exact: true })).toHaveCount(0);
}

function activeSectionRoot(page) {
  return page.locator('.space-y-4.min-w-0');
}

async function openDisclosureSection(page, title) {
  const details = activeSectionRoot(page).locator('details').filter({ hasText: title }).first();
  await expect(details).toBeVisible();
  const isOpen = await details.evaluate((node) => node.hasAttribute('open'));
  if (!isOpen) {
    await details.locator('summary').click();
  }
  return details;
}

async function saveSection(page, sectionLabel) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/admin/settings/integrations')
      && response.request().method() === 'PUT'
  ));
  await page.getByRole('button', { name: `Save ${sectionLabel}` }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

test.describe('integrations browser regressions', () => {
  test('platform admin runtime integrations expose observability sections and log settings persist after reload', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);
    const suffix = Date.now();
    const logHost = `collector-${suffix}`;
    const logPort = '12201';

    try {
      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-integrations&integration=logs');
      await expectPlatformRuntime(page);

      await activeSectionRoot(page).locator('input[name="log_export_host"]').fill(logHost);
      await activeSectionRoot(page).locator('input[name="log_export_port"]').fill(logPort);
      await saveSection(page, 'LOGS');
      await expect(page.getByText('LOGS settings saved')).toBeVisible();

      await page.reload();
      await expectPlatformRuntime(page);
      await expect(activeSectionRoot(page).locator('input[name="log_export_host"]')).toHaveValue(logHost);
      await expect(activeSectionRoot(page).locator('input[name="log_export_port"]')).toHaveValue(logPort);
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('metrics integration toggle persists after reload and platform integrations layout stays stable', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);

    try {
      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-integrations&integration=logs');
      await expectPlatformRuntime(page);

      await page.goto('/dashboard?tab=admin-integrations&integration=metrics');
      const metricsSwitch = page.getByRole('switch', { name: /Metrics Export/i });
      const initialChecked = await metricsSwitch.getAttribute('aria-checked');
      const nextChecked = initialChecked === 'true' ? 'false' : 'true';

      const toggleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/feature-flags/metrics_enabled')
          && response.request().method() === 'PATCH'
      ));
      await metricsSwitch.click();
      const toggleResponse = await toggleResponsePromise;
      expect(toggleResponse.ok()).toBeTruthy();
      await expect(metricsSwitch).toHaveAttribute('aria-checked', nextChecked);

      await page.reload();
      await expectPlatformRuntime(page);
      await expect(page.getByRole('switch', { name: /Metrics Export/i })).toHaveAttribute('aria-checked', nextChecked);
      await expect(page.getByRole('heading', { name: 'Runtime checks' })).toBeVisible();
      await expect(activeSectionRoot(page).getByText('/api/metrics', { exact: true })).toBeVisible();

      await page.goto('/dashboard?tab=admin-integrations&integration=logs');
      const logsRuntimeChecks = await openDisclosureSection(page, 'Runtime Checks');
      const logsRuntime = (await getIntegrationSettings(requestContext)).observabilityRuntime?.logs;
      expect(logsRuntime).toBeTruthy();
      await expect(logsRuntimeChecks.getByText(String(logsRuntime.backend), { exact: true })).toBeVisible();
      await expect(
        logsRuntimeChecks.getByText(`${logsRuntime.host}:${logsRuntime.port}`, { exact: true })
      ).toBeVisible();
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('Plex reconciliation sync surface displays durable conflict review actions', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    let conflictOpen = true;
    await page.route('**/api/media/plex-reconciliation-sync/scheduler', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          processingMode: 'scheduled_full_library_reconciliation_sync',
          runtime: { enabled: true, intervalMinutes: 360, limit: null },
          state: { lastFinishedAt: '2026-05-09T17:00:00.000Z', lastScanned: 1005, lastCreated: 1, lastUpdated: 1 }
        })
      });
    });
    await page.route('**/api/media/plex-reconciliation-preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'plex',
          processingMode: 'full_library_reconciliation_preview',
          readOnly: true,
          plexWriteback: false,
          importMutation: false,
          summary: {
            scanned: 4,
            alreadyLinked: 1,
            wouldUpdate: 1,
            wouldCreate: 1,
            conflict: 1
          },
          buckets: {
            alreadyLinked: [{
              item: { title: 'Linked Movie', media_type: 'movie', year: 2024, sectionId: '1', plex_item_key: '1:1001' },
              existing: { id: 101, title: 'Linked Movie', media_type: 'movie', year: 2024, import_source: 'plex' },
              matchedBy: 'plex_item_key'
            }],
            wouldUpdate: [{
              item: { title: 'TMDB Movie', media_type: 'movie', year: 2023, tmdb_id: 12345, sectionId: '1', plex_item_key: '1:1002' },
              existing: { id: 102, title: 'TMDB Movie', media_type: 'movie', year: 2023, tmdb_id: 12345, import_source: 'tmdb' },
              matchedBy: 'tmdb_id'
            }],
            wouldCreate: [{
              item: { title: 'New Plex Movie', media_type: 'movie', year: 2022, sectionId: '1', plex_item_key: '1:1003' },
              existing: null,
              matchedBy: null
            }],
            conflict: [{
              item: { title: 'Conflict Movie', media_type: 'movie', year: 2021, sectionId: '1', plex_item_key: '1:1004' },
              existing: { id: 104, title: 'Conflict Movie', media_type: 'movie', year: 2021, import_source: 'manual' },
              matchedBy: 'title_year_conflict',
              reason: 'A same-title row exists, but strong identifiers disagree.'
            }]
          }
        })
      });
    });
    await page.route('**/api/media/plex-reconciliation-sync/run', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 901,
          job: { id: 901, status: 'queued', progress: null },
          processingMode: 'full_library_reconciliation_sync',
          readOnly: false,
          plexWriteback: false,
          importMutation: true
        })
      });
    });
    await page.route('**/api/media/sync-jobs/901/result', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 901,
          status: 'succeeded',
          job_type: 'plex_reconciliation_sync',
          provider: 'plex',
          summary: {
            processingMode: 'full_library_reconciliation_sync',
            readOnly: false,
            plexWriteback: false,
            importMutation: true,
            scanned: 4,
            alreadyLinked: 1,
            wouldUpdate: 1,
            wouldCreate: 1,
            conflict: 1,
            autoApplied: { created: 1, updated: 1, skippedAlreadyLinked: 1 },
            conflictReviewCount: 1,
            conflictReview: [{
              item: { title: 'Conflict Movie', media_type: 'movie', year: 2021, sectionId: '1', plex_item_key: '1:1004' },
              existing: { id: 104, title: 'Conflict Movie', media_type: 'movie', year: 2021, import_source: 'manual' },
              matchedBy: 'title_year_conflict',
              reason: 'A same-title row exists, but strong identifiers disagree.'
            }]
          }
        })
      });
    });
    await page.route('**/api/media/plex-reconciliation-conflicts*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'plex',
          processingMode: 'plex_reconciliation_conflict_review',
          status: 'open',
          count: conflictOpen ? 1 : 0,
          reviews: conflictOpen ? [{
            id: 77,
            existingMediaId: 104,
            item: { title: 'Conflict Movie', media_type: 'movie', year: 2021, sectionId: '1', plex_item_key: '1:1004' },
            existing: { id: 104, title: 'Conflict Movie', media_type: 'movie', year: 2021, import_source: 'manual' },
            matchedBy: 'title_year_conflict',
            reason: 'A same-title row exists, but strong identifiers disagree.'
          }] : []
        })
      });
    });
    await page.route('**/api/media/plex-reconciliation-conflicts/77/resolve', async (route) => {
      const requestBody = route.request().postDataJSON();
      expect(requestBody).toMatchObject({ action: 'attach_existing', targetMediaId: 104 });
      conflictOpen = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'plex',
          processingMode: 'plex_reconciliation_conflict_resolution',
          plexWriteback: false,
          importMutation: true,
          review: {
            id: 77,
            status: 'resolved',
            resolution: 'attach_existing',
            item: { title: 'Conflict Movie', media_type: 'movie', year: 2021 }
          }
        })
      });
    });

    await signInThroughUi(page, adminCredentials);
    await openWorkspaceIntegrations(page);
    await openIntegrationsSection(page, 'Plex');
    await expect(page.getByRole('tablist', { name: 'Plex settings sections' })).toBeVisible();
    await page.getByRole('tab', { name: 'Sync', exact: true }).click();
    await expect(page.getByText('Plex library sync', { exact: true })).toBeVisible();
    await expect(page.getByText('Automatic: on/360m', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'All' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Check now' }).click();

    await expect(page.getByText('PLEX CHECK: scanned 4 item(s) without changes.')).toBeVisible();
    await activeSectionRoot(page).locator('details').filter({ hasText: 'Linked' }).first().locator('summary').click();
    await activeSectionRoot(page).locator('details').filter({ hasText: 'Creates' }).first().locator('summary').click();
    await expect(page.getByText('Linked Movie', { exact: true })).toBeVisible();
    await expect(page.getByText('New Plex Movie')).toBeVisible();
    await expect(page.getByText('A same-title row exists, but strong identifiers disagree.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Sync Plex Library' }).click();
    await expect(page.getByText('PLEX SYNC: job #901 created 1, updated 1, review 1.')).toBeVisible();
    await expect(page.getByText('Sync issues')).toBeVisible();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
    await expect(page.getByText('Conflict review', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach to existing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create separate title' })).toBeVisible();
    await page.getByRole('button', { name: 'Attach to existing' }).click();
    await expect(page.getByText('PLEX CONFLICT: attached the Plex identity to the existing title.')).toBeVisible();
    await expect(page.getByText('No open Plex conflicts match this view.')).toBeVisible();
    await expect(page.getByRole('button', { name: /apply/i })).toHaveCount(0);
  });
});
