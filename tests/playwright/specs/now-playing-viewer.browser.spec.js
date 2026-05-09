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
          }, {
            title: 'Second Active Session',
            type: 'movie',
            year: 2025,
            progressPercent: 62,
            player: { state: 'paused', platform: 'Apple TV' }
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
    await expect(page.getByText('Other active sessions')).toBeVisible();
    await expect(page.getByText('Second Active Session')).toBeVisible();
    await expect(page.getByText('2025 · paused · Apple TV · 62%')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Library' })).toHaveCount(0);
  });

  test('display token can open now-playing without an admin session', async ({ page }) => {
    const displayToken = 'cznp_browser_display_token';
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied' }) });
    });
    await page.route('**/api/plex/now-playing-display?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('token')).toBe(displayToken);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          access: 'display_token',
          sessionCount: 1,
          generatedAt: '2026-05-07T12:00:00.000Z',
          sessions: [{
            title: 'Token Viewer',
            type: 'movie',
            year: 2026,
            progressPercent: 50,
            player: { state: 'playing', platform: 'TV' },
            posterImagePath: '/api/plex/now-playing-display-image?key=%2Flibrary%2Fmetadata%2F456%2Fthumb'
          }]
        })
      });
    });
    await page.route('**/api/plex/now-playing-display-image?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('token')).toBe(displayToken);
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#111827"/></svg>'
      });
    });

    await page.goto(`/now-playing?token=${displayToken}`);

    await expect(page.getByText('Plex Now Playing')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Token Viewer' })).toBeVisible();
    await expect(page.getByText('playing · TV')).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('display token can render the vertical poster-only layout', async ({ page }) => {
    const displayToken = 'cznp_browser_poster_only_token';
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied' }) });
    });
    await page.route('**/api/plex/now-playing-display?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('token')).toBe(displayToken);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          access: 'display_token',
          sessionCount: 1,
          generatedAt: '2026-05-07T12:30:00.000Z',
          displayPreferences: {
            layoutMode: 'poster_only',
            showPoster: false,
            showBackdrop: false,
            showLogo: false,
            showTitle: true,
            showTypeYear: true,
            showProgress: true,
            showPlayer: true,
            showGeneratedAt: true,
            showFooter: true,
            textScale: 'medium'
          },
          sessions: [{
            title: 'Poster Only Viewer',
            type: 'movie',
            year: 2026,
            progressPercent: 50,
            player: { state: 'playing', platform: 'TV' },
            posterImagePath: '/api/plex/now-playing-display-image?key=%2Flibrary%2Fmetadata%2F789%2Fthumb'
          }]
        })
      });
    });
    await page.route('**/api/plex/now-playing-display-image?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('token')).toBe(displayToken);
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#111827"/></svg>'
      });
    });

    await page.goto(`/now-playing?token=${displayToken}`);

    await expect(page.locator('main img')).toBeVisible();
    await expect(page.getByText('Plex Now Playing')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Poster Only Viewer' })).toHaveCount(0);
    await expect(page.getByText('playing · TV')).toHaveCount(0);
    await expect(page.getByText('50%')).toHaveCount(0);
  });
});
