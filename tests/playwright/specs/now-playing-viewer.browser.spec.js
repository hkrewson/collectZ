'use strict';

const { test, expect } = require('@playwright/test');
const { ensureSavedAdminCredentials } = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xd9
]);

test.describe('Plex now-playing viewer browser regressions', () => {
  test('authenticated admin can open the standalone now-playing display page', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();

    await page.route('**/api/plex/now-playing-viewer', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sessionCount: 1,
          generatedAt: '2026-05-07T05:30:00.000Z',
          sessions: [{
            title: 'Viewer Safe Payload',
            type: 'episode',
            grandparentTitle: 'Example Show',
            parentTitle: 'Season 2',
            progressPercent: 25,
            player: { state: 'playing', platform: 'Chrome' },
            posterImagePath: '/api/plex/now-playing-image?key=%2Flibrary%2Fmetadata%2F123%2Fthumb',
            backdropImagePath: '/api/plex/now-playing-image?key=%2Flibrary%2Fmetadata%2F123%2Fart'
          }]
        })
      });
    });
    await page.route('**/api/plex/now-playing-image?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: tinyJpeg
      });
    });

    await signInThroughUi(page, adminCredentials);
    await page.goto('/now-playing');

    await expect(page.getByText('Plex Now Playing')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Viewer Safe Payload' })).toBeVisible();
    await expect(page.getByText('Example Show · Season 2')).toBeVisible();
    await expect(page.getByText('playing · Chrome')).toBeVisible();
    await expect(page.getByText('25%')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Library' })).toHaveCount(0);
  });
});
