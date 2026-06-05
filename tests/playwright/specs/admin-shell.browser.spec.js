'use strict';

const { test, expect } = require('@playwright/test');
const { createSpaceFixture, deleteSpace } = require('../helpers/admin');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext, fetchCsrfToken, postWithCsrf, requestWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

async function findCollectionsByName(requestContext, name) {
  const response = await requestContext.get(`/api/media/collections?search=${encodeURIComponent(name)}&limit=20`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list collections for "${name}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items.filter((item) => String(item?.name || '') === String(name)) : [];
}

async function readRect(locator) {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  });
}

async function readMeasuredRect(locator) {
  await expect.poll(async () => {
    const rect = await readRect(locator);
    return Math.round(rect.height);
  }).toBeGreaterThan(0);
  return readRect(locator);
}

async function gotoDashboardTab(page, route) {
  await page.goto(route);
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
}

test.describe('admin shell browser regressions', () => {
  test('dashboard command center is the default dashboard landing view', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let summary;
    try {
      const summaryApiResponse = await requestContext.get('/api/dashboard/summary');
      expect(summaryApiResponse.ok()).toBeTruthy();
      summary = await summaryApiResponse.json();
    } finally {
      await requestContext.dispose();
    }
    await page.goto('/dashboard');
    expect(summary?.attention_details).toBeTruthy();
    expect(Array.isArray(summary?.attention_details?.missing_cover_items)).toBeTruthy();
    expect(Array.isArray(summary?.attention_details?.missing_identifier_items)).toBeTruthy();
    expect(Array.isArray(summary?.attention_details?.sparse_metadata_items)).toBeTruthy();
    const missingIdentifierSample = summary.attention_details.missing_identifier_items[0] || null;
    if (missingIdentifierSample) {
      expect(Array.isArray(missingIdentifierSample.review_reasons)).toBeTruthy();
      expect(Array.isArray(missingIdentifierSample.recommended_identifiers)).toBeTruthy();
      expect(missingIdentifierSample.review_finding_type).toBe('missing_identifier');
    }
    const sparseMetadataSample = summary.attention_details.sparse_metadata_items[0] || null;
    if (sparseMetadataSample) {
      expect(Array.isArray(sparseMetadataSample.review_reasons)).toBeTruthy();
      expect(Array.isArray(sparseMetadataSample.recommended_metadata)).toBeTruthy();
      expect(sparseMetadataSample.review_finding_type).toBe('sparse_metadata');
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Review sections' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Failed syncs/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Missing covers/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Missing identifiers/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Sparse metadata/ })).toBeVisible();
    if (missingIdentifierSample) {
      const reviewPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review' }) }).first();
      await reviewPanel.getByRole('tablist', { name: 'Review sections' }).getByRole('tab', { name: /Missing identifiers/ }).click();
      await expect(reviewPanel.getByText(missingIdentifierSample.review_reasons[0]).first()).toBeVisible();
    }
    if (sparseMetadataSample) {
      const reviewPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review' }) }).first();
      await reviewPanel.getByRole('tablist', { name: 'Review sections' }).getByRole('tab', { name: /Sparse metadata/ }).click();
      await expect(reviewPanel.getByText('Record is missing helpful descriptive metadata').first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Provider health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Latest failures' })).toHaveCount(0);
    const recentSyncsPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent syncs' }) });
    await expect(recentSyncsPanel.getByRole('button', { name: /^Import$/ })).toHaveCount(0);
    if (Number(summary?.collection?.missing_covers || 0) > 0) {
      const mediaReviewResponse = page.waitForResponse((mediaResponse) => (
        mediaResponse.url().includes('/api/media')
        && mediaResponse.url().includes('review_filter=missing_covers')
        && mediaResponse.request().method() === 'GET'
      ));
      await page.getByRole('button', { name: /Open missing covers review/i }).click();
      const reviewResponse = await mediaReviewResponse;
      expect(reviewResponse.ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
      await expect(page.getByText('Missing covers across all library types')).toBeVisible();
    }
    if (Number(summary?.collection?.missing_identifiers || 0) > 0) {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      const mediaReviewResponse = page.waitForResponse((mediaResponse) => (
        mediaResponse.url().includes('/api/media')
        && mediaResponse.url().includes('review_filter=missing_identifiers')
        && mediaResponse.request().method() === 'GET'
      ));
      await page.getByRole('button', { name: /Open missing identifiers review/i }).click();
      const reviewResponse = await mediaReviewResponse;
      expect(reviewResponse.ok()).toBeTruthy();
      const reviewPayload = await reviewResponse.json();
      const reviewItem = Array.isArray(reviewPayload?.items) ? reviewPayload.items.find((item) => Array.isArray(item.review_reasons) && item.review_reasons.length > 0) : null;
      expect(reviewItem).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
      await expect(page.getByText('Missing identifiers across all library types')).toBeVisible();
      await expect(page.getByText(reviewItem.review_reasons[0]).first()).toBeVisible();
    }
    if (Number(summary?.collection?.sparse_metadata || 0) > 0) {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      const mediaReviewResponse = page.waitForResponse((mediaResponse) => (
        mediaResponse.url().includes('/api/media')
        && mediaResponse.url().includes('review_filter=sparse_metadata')
        && mediaResponse.request().method() === 'GET'
      ));
      await page.getByRole('button', { name: /Open sparse metadata review/i }).click();
      const reviewResponse = await mediaReviewResponse;
      expect(reviewResponse.ok()).toBeTruthy();
      const reviewPayload = await reviewResponse.json();
      const reviewItem = Array.isArray(reviewPayload?.items) ? reviewPayload.items.find((item) => Array.isArray(item.recommended_metadata) && item.recommended_metadata.length > 0) : null;
      expect(reviewItem).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
      await expect(page.getByText('Sparse metadata across all library types')).toBeVisible();
      await expect(page.getByText('Record is missing helpful descriptive metadata').first()).toBeVisible();
    }
  });

  test('dashboard command center does not overflow on mobile', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await page.setViewportSize({ width: 390, height: 844 });
    await signInThroughUi(page, adminCredentials);
    const summaryResponse = page.waitForResponse((response) => (
      response.url().includes('/api/dashboard/summary') && response.request().method() === 'GET'
    ));
    await page.goto('/dashboard');
    expect((await summaryResponse).ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const appHeader = page.getByTestId('mobile-app-header');
    await expect(appHeader).toBeVisible();
    await expect(page.getByTestId('mobile-app-title')).toHaveText('Dashboard');
    await expect(appHeader.getByText('COLLECTZ')).toHaveCount(0);
    await expect(appHeader.getByText('Admin')).toHaveCount(0);
    await page.getByTestId('mobile-nav-toggle').click();
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('collectZ')).toBeVisible();
    await sidebar.getByRole('button', { name: 'Dashboard', exact: true }).click();
    const dashboardTabs = page.getByRole('tablist', { name: 'Dashboard sections' });
    await expect(dashboardTabs).toBeVisible();
    await expect(dashboardTabs.getByRole('tab', { name: 'Review' })).toBeVisible();
    await expect(dashboardTabs.getByRole('tab', { name: 'Syncs' })).toBeVisible();
    await expect(dashboardTabs.getByRole('tab', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    const reviewTabs = page.getByRole('tablist', { name: 'Review sections' });
    await expect(reviewTabs).toBeVisible();
    await expect(reviewTabs.getByRole('tab', { name: /Failed syncs/ })).toBeVisible();
    await expect(reviewTabs.getByRole('tab', { name: /Missing covers/ })).toBeVisible();
    await expect(reviewTabs.getByRole('tab', { name: /Missing identifiers/ })).toBeVisible();
    await expect(reviewTabs.getByRole('tab', { name: /Sparse metadata/ })).toBeVisible();
    const metricButtons = page.getByRole('button', { name: /Open (items|missing covers|missing identifiers|sparse metadata) review/i });
    await expect(metricButtons).toHaveCount(4);
    const firstMetricBox = await metricButtons.nth(0).boundingBox();
    const secondMetricBox = await metricButtons.nth(1).boundingBox();
    const thirdMetricBox = await metricButtons.nth(2).boundingBox();
    const lastMetricBox = await metricButtons.nth(3).boundingBox();
    expect(firstMetricBox).toBeTruthy();
    expect(secondMetricBox).toBeTruthy();
    expect(thirdMetricBox).toBeTruthy();
    expect(lastMetricBox).toBeTruthy();
    expect(Math.abs(firstMetricBox.y - secondMetricBox.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(thirdMetricBox.y - lastMetricBox.y)).toBeLessThanOrEqual(2);
    await dashboardTabs.getByRole('tab', { name: 'Syncs' }).click();
    await expect(page.getByRole('heading', { name: 'Recent syncs' })).toBeVisible();
    await dashboardTabs.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await dashboardTabs.getByRole('tab', { name: 'Health' }).click();
    await expect(page.getByRole('heading', { name: 'Provider health' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      return {
        body: document.body.scrollWidth - document.body.clientWidth,
        root: root.scrollWidth - root.clientWidth,
        viewport: window.innerWidth
      };
    });
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.root).toBeLessThanOrEqual(1);
  });

  test('dashboard review rows open inline item drawer', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let summaryPayload;
    try {
      const summaryResponse = await requestContext.get('/api/dashboard/summary');
      expect(summaryResponse.ok()).toBeTruthy();
      summaryPayload = await summaryResponse.json();
    } finally {
      await requestContext.dispose();
    }

    const reviewKind = summaryPayload?.attention_details?.missing_identifier_items?.[0]
      ? 'missing identifiers'
      : summaryPayload?.attention_details?.missing_cover_items?.[0]
        ? 'missing covers'
        : 'sparse metadata';
    const item = reviewKind === 'missing identifiers'
      ? summaryPayload?.attention_details?.missing_identifier_items?.[0]
      : reviewKind === 'missing covers'
        ? summaryPayload?.attention_details?.missing_cover_items?.[0]
        : summaryPayload?.attention_details?.sparse_metadata_items?.[0];
    if (!item) return;

    await page.goto('/dashboard?tab=dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`Open ${reviewKind} review`, 'i') }).click();
    const escapedTitle = String(item.title || 'Untitled').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const detailResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/media/${item.id}`) && response.request().method() === 'GET'
    ));
    await page.getByRole('button', { name: new RegExp(escapedTitle) }).first().click();
    expect((await detailResponse).ok()).toBeTruthy();
    await expect(page.getByTestId('dashboard-review-drawer')).toBeVisible();
    await expect(page.getByText('Why it is here')).toBeVisible();
    if (reviewKind === 'missing identifiers' || reviewKind === 'sparse metadata') {
      await expect(page.getByText(/Search (TMDB|Google Books|comic issue|Discogs|games)/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    }
    if (reviewKind === 'missing covers') {
      await expect(page.getByText('Cover image')).toBeVisible();
      await expect(page.getByText('Upload cover')).toBeVisible();
    }
    await expect(page.getByText('Manual fallback')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Defer 7 days' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save/ })).toBeVisible();
  });

  test('mobile library search toolbars stay compact', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await page.setViewportSize({ width: 390, height: 844 });
    await signInThroughUi(page, adminCredentials);

    const pages = [
      { route: '/dashboard?tab=library-movies', mobileTitle: 'Movies', desktopHeading: 'Movies', header: 'library-mobile-header', toolbar: 'library-mobile-toolbar', maxToolbarHeight: 44, filterLabel: /Filter Movies/ },
      { route: '/dashboard?tab=library-collectibles', mobileTitle: 'Collectibles', desktopHeading: 'Collectibles', header: 'collectibles-mobile-header', toolbar: 'collectibles-mobile-toolbar', maxToolbarHeight: 44, filterLabel: /Filter Collectibles/ },
      { route: '/dashboard?tab=library-art', mobileTitle: 'Art', desktopHeading: 'Art', header: 'art-mobile-header', toolbar: 'art-mobile-toolbar', maxToolbarHeight: 44, filterLabel: /Filter Art/ },
      { route: '/dashboard?tab=library-events', mobileTitle: 'Events', desktopHeading: 'Events', header: 'events-mobile-header', toolbar: 'events-mobile-toolbar', maxToolbarHeight: 44, filterLabel: /Filter Events/ }
    ];

    for (const target of pages) {
      await gotoDashboardTab(page, target.route);
      const appHeader = page.getByTestId('mobile-app-header');
      await expect(appHeader).toBeVisible();
      await expect(appHeader).toHaveCSS('position', 'sticky');
      await expect(page.getByTestId('mobile-app-title')).toHaveText(target.mobileTitle);
      await expect(appHeader.getByRole('button', { name: `Open navigation, ${target.mobileTitle}` })).toBeVisible();
      await expect(page.getByRole('heading', { name: target.desktopHeading, exact: true })).toHaveCount(0);
      const header = page.getByTestId(target.header);
      await expect(header).not.toBeVisible();
      const toolbar = page.getByTestId(`${target.toolbar}-shell`);
      await expect(toolbar).toBeVisible();
      const appHeaderBoxBefore = await readRect(appHeader);
      const toolbarBox = await readMeasuredRect(toolbar);
      expect(appHeaderBoxBefore).toBeTruthy();
      expect(toolbarBox).toBeTruthy();
      expect(appHeaderBoxBefore.height).toBeLessThanOrEqual(64);
      expect(toolbarBox.height).toBeLessThanOrEqual(target.maxToolbarHeight);
      const filterButton = toolbar.getByRole('button', { name: target.filterLabel });
      await expect(filterButton).toBeVisible();
      await filterButton.click();
      await expect(page.getByRole('group', { name: target.filterLabel })).toBeVisible();
      await filterButton.click();
      await page.evaluate(() => {
        window.scrollTo(0, 500);
        const scrollArea = Array.from(document.querySelectorAll('.scroll-area'))
          .find((node) => node.scrollHeight > node.clientHeight);
        if (scrollArea) scrollArea.scrollTop = Math.min(500, scrollArea.scrollHeight - scrollArea.clientHeight);
      });
      const appHeaderBoxAfter = await readRect(appHeader);
      const toolbarBoxAfter = await readMeasuredRect(toolbar);
      expect(appHeaderBoxAfter).toBeTruthy();
      expect(toolbarBoxAfter).toBeTruthy();
      expect(Math.abs(appHeaderBoxAfter.y - appHeaderBoxBefore.y)).toBeLessThanOrEqual(1);
      expect(toolbarBoxAfter.height).toBeLessThanOrEqual(toolbarBox.height);

      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        return {
          body: document.body.scrollWidth - document.body.clientWidth,
          root: root.scrollWidth - root.clientWidth,
          windowScrollY: window.scrollY
        };
      });
      expect(overflow.body).toBeLessThanOrEqual(1);
      expect(overflow.root).toBeLessThanOrEqual(1);
      expect(overflow.windowScrollY).toBe(0);
    }
  });

  test('desktop library pages use section-specific headings', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await page.setViewportSize({ width: 1280, height: 860 });
    await signInThroughUi(page, adminCredentials);

    const pages = [
      { route: '/dashboard?tab=library-movies', heading: 'Movies' },
      { route: '/dashboard?tab=library-tv', heading: 'TV' },
      { route: '/dashboard?tab=library-books', heading: 'Books' },
      { route: '/dashboard?tab=library-audio', heading: 'Audio' },
      { route: '/dashboard?tab=library-games', heading: 'Games' },
      { route: '/dashboard?tab=library-comics', heading: 'Comics' },
      { route: '/dashboard?tab=library-art', heading: 'Art', absentText: 'Track original art, prints, and sketch commissions' },
      { route: '/dashboard?tab=library-collectibles', heading: 'Collectibles', absentText: 'Keep convention pickups, exclusives, props, cards' },
      { route: '/dashboard?tab=library-events', heading: 'Events', absentText: 'Track conventions, screenings, meetups' }
    ];

    for (const target of pages) {
      await gotoDashboardTab(page, target.route);
      await expect(page.getByRole('heading', { name: target.heading, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Library', exact: true })).toHaveCount(0);
      if (target.absentText) {
        await expect(page.getByText(target.absentText)).toHaveCount(0);
      }
    }
  });

  test('mobile utility pages keep headers stable while content scrolls', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await page.setViewportSize({ width: 390, height: 640 });
    await signInThroughUi(page, adminCredentials);

    const pages = [
      { route: '/dashboard?tab=library-wishlist', heading: 'Wishlist', mobileTitle: 'Wishlist', header: 'wishlist-page-header', body: 'wishlist-page-body', filterButton: /All types/, filterControl: 'Wishlist type' },
      { route: '/dashboard?tab=library-loans', heading: 'Loans', headingVisible: false, mobileTitle: 'Loans', header: 'loans-page-header', body: 'loans-page-body' },
      { route: '/dashboard?tab=library-import', heading: 'Import Media', mobileTitle: 'Import', header: 'import-page-header', body: 'import-page-body' },
      { route: '/dashboard?tab=library-capture', heading: 'Capture Inbox', mobileTitle: 'Capture Inbox', header: 'capture-page-header', body: 'capture-page-body', filterButton: /Filter captures/, filterControl: 'Capture type', absentHeaderText: 'My Library' },
      { route: '/dashboard?tab=admin-integrations', heading: 'Integrations', mobileTitle: 'Integrations', header: 'admin-integrations-page-header', body: 'admin-integrations-page-body' }
    ];

    for (const target of pages) {
      await gotoDashboardTab(page, target.route);
      if (target.headingVisible === false) {
        await expect(page.getByRole('heading', { name: target.heading, exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole('heading', { name: target.heading, exact: true })).toBeVisible();
      }
      const appHeader = page.getByTestId('mobile-app-header');
      await expect(appHeader).toBeVisible();
      await expect(page.getByTestId('mobile-app-title')).toHaveText(target.mobileTitle);
      await expect(appHeader.getByRole('button', { name: `Open navigation, ${target.mobileTitle}` })).toBeVisible();
      await expect(appHeader.getByText('COLLECTZ')).toHaveCount(0);
      await expect(appHeader.getByText('Admin')).toHaveCount(0);
      const header = page.getByTestId(target.header);
      const body = page.getByTestId(target.body);
      await expect(header).toBeVisible();
      await expect(body).toBeVisible();
      if (target.absentHeaderText) {
        await expect(header.getByText(target.absentHeaderText, { exact: true })).toHaveCount(0);
      }
      await expect(body).toHaveCSS('overflow-y', 'auto');
      if (target.filterButton && target.filterControl) {
        const filterToggle = header.getByRole('button', { name: target.filterButton });
        await expect(filterToggle).toBeVisible();
        await filterToggle.click();
        await expect(header.getByLabel(target.filterControl)).toBeVisible();
        await filterToggle.click();
        await expect(header.getByRole('button', { name: 'Search' })).toHaveCount(0);
      }
      const headerBoxBefore = await readRect(header);
      expect(headerBoxBefore).toBeTruthy();

      await body.evaluate((node) => {
        node.scrollTop = Math.min(360, node.scrollHeight - node.clientHeight);
      });

      const headerBoxAfter = await readRect(header);
      expect(headerBoxAfter).toBeTruthy();
      expect(Math.abs(headerBoxAfter.y - headerBoxBefore.y)).toBeLessThanOrEqual(1);

      const pageScroll = await page.evaluate(() => window.scrollY);
      expect(pageScroll).toBe(0);
    }
  });

  test('wishlist foundation lists wanted items and converts media wants', async ({ page }) => {
    const suffix = Date.now();
    const title = `Playwright Wishlist ${suffix}`;
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let wishlistId = null;

    try {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      const createResponse = await postWithCsrf(requestContext, '/api/wishlist', {
        title,
        object_type: 'book',
        desired_format: 'Paperback',
        desired_edition: 'First printing',
        identifiers: { isbn: `978000${String(suffix).slice(-7)}` },
        source_context: { source: 'playwright' }
      }, 201);
      const createPayload = await createResponse.json();
      wishlistId = Number(createPayload?.item?.id || 0);
      expect(wishlistId).toBeGreaterThan(0);

      await signInThroughUi(page, adminCredentials);
      const wishlistResponse = page.waitForResponse((response) => (
        response.url().includes('/api/wishlist') && response.request().method() === 'GET'
      ));
      await page.goto('/dashboard?tab=library-wishlist');
      expect((await wishlistResponse).ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible();

      const convertResponse = await postWithCsrf(requestContext, `/api/wishlist/${wishlistId}/convert`, {}, 201);
      const convertPayload = await convertResponse.json();
      expect(convertPayload?.ok).toBe(true);
      expect(convertPayload?.media?.title).toBe(title);
      expect(convertPayload?.item?.status).toBe('acquired');

      const acquiredResponse = await requestContext.get(`/api/wishlist?status=acquired&search=${encodeURIComponent(title)}`);
      expect(acquiredResponse.ok()).toBeTruthy();
      const acquiredPayload = await acquiredResponse.json();
      expect(acquiredPayload?.items?.some((item) => item.id === wishlistId && item.linked_media_id === convertPayload.media.id)).toBeTruthy();
    } finally {
      if (wishlistId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/wishlist/${wishlistId}`, undefined, [200, 404]).catch(() => {});
      }
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('wishlist apple itunes search presents candidates and saves a selected result', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    let savePayload = null;
    let refreshPayload = null;
    let schedulerRunPayload = null;
    let targetHitPatchPayload = null;

    await page.route('**/api/wishlist?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 9001,
              title: 'Star Wars: A New Hope',
              object_type: 'movie',
              status: 'wanted',
              priority: 'normal',
              target_price: 7.99,
              identifiers: {},
              source_context: {
                current_price: 7.99,
                currency: 'USD',
                price_refreshed_at: new Date().toISOString(),
                target_price_met: true,
                store_url: 'https://itunes.apple.com/us/movie/id1001'
              },
              provider: 'apple_itunes',
              provider_key: '1001',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 9002,
              title: 'Before the Storm',
              object_type: 'book',
              status: 'wanted',
              priority: 'normal',
              identifiers: { isbn13: '9780553572773', provider_item_id: 'capture:91' },
              source_context: { source: 'web_capture_inbox', capture_type: 'barcode', capture_item_id: 91 },
              provider: 'capture',
              provider_key: 'capture:91',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 9003,
              title: 'Scanner Candidate',
              object_type: 'book',
              status: 'wanted',
              priority: 'normal',
              identifiers: { isbn_10: '0553572776' },
              source_context: { source: 'ios_scanner_app' },
              provider: null,
              provider_key: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ],
          pagination: { page: 1, limit: 50, total: 3, total_pages: 1 }
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'apple_itunes',
          term: 'star wars',
          media: ['movie'],
          country: 'US',
          limit: 25,
          matches: [
            {
              id: 'apple_itunes:1001',
              provider: 'apple_itunes',
              provider_key: '1001',
              title: 'Star Wars: A New Hope',
              subtitle: 'Lucasfilm',
              object_type: 'movie',
              media: 'movie',
              kind: 'feature-movie',
              year: 1977,
              price: 9.99,
              currency: 'USD',
              artwork_url: null,
              store_url: 'https://itunes.apple.com/us/movie/id1001',
              match_strength: 'weak',
              match_reason: 'Only part of the title overlaps the search.',
              match_score: 20,
              search_source: 'generic_movie_fallback',
              already_saved: false,
              wanted_item_id: null,
              wanted_status: null,
              raw_result: { trackId: 1001 }
            },
            {
              id: 'apple_itunes:1002',
              provider: 'apple_itunes',
              provider_key: '1002',
              title: 'Star Wars: The Empire Strikes Back',
              subtitle: 'Lucasfilm',
              object_type: 'movie',
              media: 'movie',
              kind: 'feature-movie',
              year: 1980,
              price: 9.99,
              currency: 'USD',
              artwork_url: null,
              store_url: 'https://itunes.apple.com/us/movie/id1002',
              match_strength: 'weak',
              match_reason: 'Only part of the title overlaps the search.',
              match_score: 20,
              search_source: 'generic_movie_fallback',
              already_saved: true,
              wanted_item_id: 9002,
              wanted_status: 'watching',
              raw_result: { trackId: 1002 }
            }
          ]
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/save', async (route) => {
      savePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          created: true,
          existing: false,
          item: {
            id: 9001,
            title: savePayload?.candidate?.title,
            object_type: 'movie',
            status: 'wanted',
            priority: 'normal',
            identifiers: {},
            source_context: {},
            provider: 'apple_itunes',
            provider_key: savePayload?.candidate?.provider_key,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/refresh-prices', async (route) => {
      refreshPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'apple_itunes',
          checked: 1,
          updated: 1,
          skipped: 0,
          failed: 0,
          items: [
            {
              id: 9001,
              title: 'Star Wars: A New Hope',
              provider_key: '1001',
              previous_price: 9.99,
              current_price: 7.99,
              currency: 'USD',
              target_price: 7.99,
              target_met: true,
              history_id: 7001,
              error: null
            }
          ]
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/price-refresh-scheduler', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'apple_itunes',
          processingMode: 'scheduled_wishlist_price_refresh',
          runtime: { enabled: false, intervalMinutes: 720, limit: 25, country: 'US', status: 'active' },
          state: {
            enabled: false,
            intervalMinutes: 720,
            limit: 25,
            country: 'US',
            running: false,
            lastFinishedAt: null,
            lastChecked: 0,
            lastUpdated: 0,
            lastSkipped: 0,
            lastFailed: 0
          }
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/price-refresh-scheduler/run', async (route) => {
      schedulerRunPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'apple_itunes',
          processingMode: 'scheduled_wishlist_price_refresh',
          schedulerEnabled: false,
          summary: {
            ok: true,
            provider: 'apple_itunes',
            reason: 'admin_requested',
            checked: 1,
            updated: 1,
            skipped: 0,
            failed: 0,
            items: []
          }
        })
      });
    });

    await page.route('**/api/wishlist/apple-itunes/target-price-hits**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'apple_itunes',
          status: 'active',
          limit: 5,
          count: 1,
          hits: [
            {
              id: 9001,
              title: 'Star Wars: A New Hope',
              object_type: 'movie',
              status: 'wanted',
              priority: 'normal',
              provider: 'apple_itunes',
              provider_key: '1001',
              target_price: 7.99,
              current_price: 7.99,
              currency: 'USD',
              target_price_delta: 0,
              store_url: 'https://itunes.apple.com/us/movie/id1001',
              artwork_url: null,
              checked_at: new Date().toISOString(),
              history_id: 7001,
              item: {
                id: 9001,
                title: 'Star Wars: A New Hope',
                object_type: 'movie',
                status: 'wanted',
                priority: 'normal',
                identifiers: {},
                source_context: {},
                provider: 'apple_itunes',
                provider_key: '1001',
                target_price: 7.99,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            }
          ]
        })
      });
    });

    await page.route('**/api/wishlist/9001/price-history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          item_id: 9001,
          provider: 'apple_itunes',
          provider_key: '1001',
          history: [
            {
              id: 7001,
              wanted_item_id: 9001,
              provider: 'apple_itunes',
              provider_key: '1001',
              price: 7.99,
              currency: 'USD',
              target_price: 7.99,
              target_met: true,
              source_context: {},
              checked_at: new Date().toISOString(),
              created_at: new Date().toISOString()
            },
            {
              id: 7000,
              wanted_item_id: 9001,
              provider: 'apple_itunes',
              provider_key: '1001',
              price: 5.99,
              currency: 'USD',
              target_price: 7.99,
              target_met: true,
              source_context: {},
              checked_at: new Date(Date.now() - 86400000).toISOString(),
              created_at: new Date(Date.now() - 86400000).toISOString()
            }
          ]
        })
      });
    });

    await page.route('**/api/wishlist/9001', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      targetHitPatchPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          item: {
            id: 9001,
            title: 'Star Wars: A New Hope',
            object_type: 'movie',
            status: targetHitPatchPayload?.status || 'ordered',
            priority: 'normal',
            identifiers: {},
            source_context: {},
            provider: 'apple_itunes',
            provider_key: '1001',
            target_price: 7.99,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        })
      });
    });

    await signInThroughUi(page, adminCredentials);
    await page.goto('/dashboard?tab=library-wishlist');
    await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
    await expect(page.getByText('Apple/iTunes · Movie')).toBeVisible();
    await expect(page.getByText('Source: Apple/iTunes')).toHaveCount(0);
    await expect(page.getByText('Source: apple_itunes 1001')).toHaveCount(0);
    await expect(page.getByText(/provider_item_id:/)).toHaveCount(0);
    await expect(page.getByText('Capture Inbox · Barcode')).toBeVisible();
    await expect(page.getByText('iOS scanner · ISBN')).toBeVisible();
    await expect(page.getByText('Store price: $7.99')).toBeVisible();
    await expect(page.getByText('Apple current: $7.99')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open store for Star Wars: A New Hope' })).toHaveAttribute('href', 'https://itunes.apple.com/us/movie/id1001');
    await page.getByRole('button', { name: 'Price history' }).first().click();
    await expect(page.getByText('Latest $7.99')).toBeVisible();
    await expect(page.getByText('Lowest $5.99')).toBeVisible();
    await expect(page.getByText('2 snapshots')).toBeVisible();
    await expect(page.getByText(/target met/).first()).toBeVisible();
    const applePanel = page.locator('section').filter({ has: page.getByLabel('Apple/iTunes search') });
    await expect(applePanel.getByText('Auto refresh off')).toBeVisible();
    await expect(applePanel.getByText('Target price hits')).toBeVisible();
    await expect(applePanel.getByText('Star Wars: A New Hope').first()).toBeVisible();
    await expect(applePanel.getByText('$7.99 at or below $7.99')).toBeVisible();
    await applePanel.getByRole('button', { name: 'Mark ordered' }).click();
    expect(targetHitPatchPayload?.status).toBe('ordered');
    await applePanel.getByRole('button', { name: 'Run auto refresh now' }).click();
    await expect(applePanel.getByText('Updated 1 of 1')).toBeVisible();
    expect(schedulerRunPayload?.status).toBe('active');
    await applePanel.getByRole('button', { name: 'Refresh saved prices' }).click();
    await expect(applePanel.getByText('Updated 1 of 1')).toBeVisible();
    expect(refreshPayload?.status).toBe('active');
    await applePanel.getByLabel('Apple/iTunes search').fill('star wars');
    await expect(applePanel.getByRole('heading', { name: 'Star Wars: A New Hope' })).toBeVisible();
    await expect(applePanel.getByText('Star Wars: The Empire Strikes Back')).toBeVisible();
    await expect(applePanel.getByText('Saved: Watching')).toBeVisible();
    await expect(applePanel.getByRole('button', { name: 'View saved item' })).toBeVisible();
    await expect(applePanel.getByText('Weak match').first()).toBeVisible();
    await expect(applePanel.getByText('Apple returned movies, but none closely matched this title.')).toBeVisible();
    await applePanel.getByLabel('Set target price for Star Wars: A New Hope').click();
    await applePanel.getByLabel('Target price for Star Wars: A New Hope').fill('-1');
    await applePanel.getByRole('button', { name: 'Add' }).first().click();
    await expect(page.getByText('Enter a valid target price of 0 or more.')).toBeVisible();
    expect(savePayload).toBeNull();
    await applePanel.getByLabel('Target price for Star Wars: A New Hope').fill('7.99');
    await applePanel.getByRole('button', { name: 'Add' }).first().click();
    await expect(applePanel.getByText('Saved: Wanted')).toBeVisible();
    await expect(applePanel.getByRole('button', { name: 'View saved item' }).first()).toBeVisible();
    expect(savePayload?.candidate?.provider).toBe('apple_itunes');
    expect(savePayload?.candidate?.provider_key).toBe('1001');
    expect(savePayload?.target_price).toBe(7.99);
  });

  test('capture inbox foundation receives quick captures and converts to wishlist', async ({ page }) => {
    const suffix = Date.now();
    const title = `Playwright Capture ${suffix}`;
    const photoTitle = `Playwright Photo Capture ${suffix}`;
    const clientCaptureId = `playwright-capture-${suffix}`;
    const photoClientCaptureId = `playwright-photo-${suffix}`;
    const scannerClientCaptureId = `playwright-scanner-${suffix}`;
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let captureId = null;
    let photoCaptureId = null;
    let scannerCaptureId = null;
    let wantedItemId = null;
    let catalogMediaId = null;

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: `978000${String(suffix).slice(-7)}`,
        symbology: 'EAN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser',
        source_context: { source: 'playwright' }
      }, 201);
      const createPayload = await createResponse.json();
      captureId = Number(createPayload?.item?.id || 0);
      expect(captureId).toBeGreaterThan(0);
      expect(createPayload?.item?.client_capture_id).toBe(clientCaptureId);

      const retryResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: createPayload.item.barcode,
        symbology: 'EAN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser',
        notes: 'Retried from offline queue'
      });
      const retryPayload = await retryResponse.json();
      expect(retryPayload?.idempotent).toBe(true);
      expect(retryPayload?.idempotency?.replayed).toBe(true);
      expect(retryPayload?.idempotency?.status).toBe('matched');
      expect(Number(retryPayload?.item?.id || 0)).toBe(captureId);
      expect(retryPayload?.item?.notes).toBe('Retried from offline queue');

      const conflictRetryResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title: `${title} conflicting replay`,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: '9780553572391',
        symbology: 'ISBN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser'
      });
      const conflictRetryPayload = await conflictRetryResponse.json();
      expect(conflictRetryPayload?.idempotent).toBe(true);
      expect(conflictRetryPayload?.idempotency?.status).toBe('needs_review');
      expect(Number(conflictRetryPayload?.item?.id || 0)).toBe(captureId);
      expect(conflictRetryPayload?.item?.barcode).toBe(createPayload.item.barcode);
      expect(conflictRetryPayload?.replay_conflicts?.some((conflict) => conflict.field === 'barcode')).toBeTruthy();
      expect(conflictRetryPayload?.item?.review_decision?.capture_replay_last_status).toBe('needs_review');

      const scannerCaptureResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title: `Scanner Queue Capture ${suffix}`,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: '9780553572773',
        symbology: 'ISBN-13',
        client_capture_id: scannerClientCaptureId,
        client_source: 'ios-scanner-app',
        source_context: { source: 'ios_scanner_app' }
      }, 201);
      const scannerCapturePayload = await scannerCaptureResponse.json();
      scannerCaptureId = Number(scannerCapturePayload?.item?.id || 0);
      expect(scannerCaptureId).toBeGreaterThan(0);
      expect(scannerCapturePayload?.item?.client_source).toBe('ios-scanner-app');

      const scannerFilterResponse = await requestContext.get('/api/capture-items?status=active&source_filter=scanner');
      expect(scannerFilterResponse.ok()).toBeTruthy();
      const scannerFilterPayload = await scannerFilterResponse.json();
      expect(scannerFilterPayload?.source_filter).toBe('scanner');
      expect(scannerFilterPayload?.items?.some((item) => Number(item.id) === scannerCaptureId)).toBeTruthy();

      const csrfToken = await fetchCsrfToken(requestContext);
      const uploadResponse = await requestContext.post('/api/capture-items/upload-image', {
        headers: { 'x-csrf-token': csrfToken },
        multipart: {
          title: photoTitle,
          object_type: 'book',
          notes: 'Photo capture from browser regression',
          client_capture_id: photoClientCaptureId,
          client_source: 'playwright-browser',
          image: {
            name: `capture-${suffix}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        }
      });
      expect(uploadResponse.status()).toBe(201);
      const uploadPayload = await uploadResponse.json();
      photoCaptureId = Number(uploadPayload?.item?.id || 0);
      expect(photoCaptureId).toBeGreaterThan(0);
      expect(uploadPayload?.item?.capture_type).toBe('photo');
      expect(uploadPayload?.item?.image_path).toContain('/uploads/');
      expect(uploadPayload?.item?.client_capture_id).toBe(photoClientCaptureId);

      const retryUploadResponse = await requestContext.post('/api/capture-items/upload-image', {
        headers: { 'x-csrf-token': csrfToken },
        multipart: {
          title: photoTitle,
          object_type: 'book',
          notes: 'Retried photo capture from browser regression',
          client_capture_id: photoClientCaptureId,
          client_source: 'playwright-browser',
          image: {
            name: `capture-retry-${suffix}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        }
      });
      expect(retryUploadResponse.status()).toBe(200);
      const retryUploadPayload = await retryUploadResponse.json();
      expect(retryUploadPayload?.idempotent).toBe(true);
      expect(retryUploadPayload?.idempotency?.status).toBe('matched');
      expect(Number(retryUploadPayload?.item?.id || 0)).toBe(photoCaptureId);
      expect(retryUploadPayload?.item?.image_path).toBe(uploadPayload.item.image_path);

      const ocrResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/ocr-text`, {
        ocr_text: 'Back cover OCR ISBN 0-553-57239-3',
        source: 'playwright'
      });
      const ocrPayload = await ocrResponse.json();
      const isbnCandidate = ocrPayload?.candidates?.find((candidate) => candidate.barcode === '9780553572391');
      expect(isbnCandidate).toBeTruthy();

      const applyOcrResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/apply-ocr-candidate`, {
        candidate_id: isbnCandidate.id
      });
      const applyOcrPayload = await applyOcrResponse.json();
      expect(applyOcrPayload?.item?.barcode).toBe('9780553572391');
      expect(applyOcrPayload?.item?.object_type).toBe('book');

      const catalogMediaResponse = await postWithCsrf(requestContext, '/api/media', {
        title: `${photoTitle} Catalog Match`,
        media_type: 'book',
        format: 'Paperback',
        owned_formats: ['paperback'],
        upc: '9780553572391',
        type_details: {
          isbn: '9780553572391',
          author: 'Michael P. Kube-McDowell'
        }
      }, 201);
      const catalogMediaPayload = await catalogMediaResponse.json();
      catalogMediaId = Number(catalogMediaPayload?.id || 0);
      expect(catalogMediaId).toBeGreaterThan(0);

      const lookupResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/lookup-matches`, { limit: 6 });
      const lookupPayload = await lookupResponse.json();
      expect(lookupPayload?.matches?.some((match) => Number(match.media_id || 0) === catalogMediaId)).toBeTruthy();
      expect(lookupPayload?.item?.review_decision?.capture_lookup_matches?.length).toBeGreaterThan(0);

      await signInThroughUi(page, adminCredentials);
      const captureResponse = page.waitForResponse((response) => (
        response.url().includes('/api/capture-items') && response.request().method() === 'GET'
      ));
      await page.goto('/dashboard?tab=library-capture');
      expect((await captureResponse).ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Capture Inbox', exact: true })).toBeVisible();
      const captureFilterButton = page.getByRole('button', { name: /Filter captures/ });
      await expect(captureFilterButton).toBeVisible();
      await captureFilterButton.click();
      const captureFilters = page.getByLabel('Capture filters');
      await expect(captureFilters.getByRole('radiogroup', { name: 'Capture review filter' })).toBeVisible();
      await expect(captureFilters.getByRole('radio', { name: /Needs choice/ })).toBeVisible();
      await expect(captureFilters.getByRole('radio', { name: /Ready to add/ })).toBeVisible();
      await expect(captureFilters.getByRole('radio', { name: /No match/ })).toBeVisible();
      await captureFilterButton.click();
      await expect(page.getByRole('button', { name: 'Review scanner captures' })).toBeVisible();
      const scannerUiFilterResponse = page.waitForResponse((response) => (
        response.url().includes('/api/capture-items')
        && response.url().includes('source_filter=scanner')
        && response.request().method() === 'GET'
      ));
      await page.getByRole('button', { name: 'Review scanner captures' }).click();
      expect((await scannerUiFilterResponse).ok()).toBeTruthy();
      const scannerRow = page.locator('div').filter({ hasText: `Scanner Queue Capture ${suffix}` }).filter({ hasText: 'Scanner app' }).first();
      await expect(scannerRow).toBeVisible();
      await page.getByRole('button', { name: 'Show all sources' }).click();
      const reviewFilterResponse = page.waitForResponse((response) => (
        response.url().includes('/api/capture-items')
        && response.url().includes('review_filter=needs_choice')
        && response.request().method() === 'GET'
      ));
      await captureFilterButton.click();
      await captureFilters.getByRole('radio', { name: /Needs choice/ }).click();
      expect((await reviewFilterResponse).ok()).toBeTruthy();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await captureFilters.getByRole('radio', { name: /^All / }).click();
      await captureFilterButton.click();
      await expect(page.getByText(photoTitle, { exact: true })).toBeVisible();
      const replayConflictReview = page.getByLabel('Replay conflict review').first();
      const replayReason = page.getByLabel('Capture review reasons').filter({ hasText: 'Replay conflict' }).first();
      await expect(replayReason).toBeVisible();
      await expect(replayConflictReview.getByText('Replay conflict', { exact: true })).toBeVisible();
      await expect(replayConflictReview.getByText('Barcode', { exact: true })).toBeVisible();
      await expect(replayConflictReview.getByText(`Current: ${createPayload.item.barcode}`)).toBeVisible();
      await expect(replayConflictReview.getByText('Replayed: 9780553572391')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Use replayed values' })).toBeVisible();
      const resolveResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/capture-items/${captureId}/resolve-replay-conflict`)
        && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Keep current' }).click();
      expect((await resolveResponse).ok()).toBeTruthy();
      await expect(page.getByLabel('Replay conflict review')).toHaveCount(0);
      await expect(page.locator(`img[src*="${uploadPayload.item.image_path}"]`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Read image text' })).toBeVisible();
      await expect(page.getByText('OCR candidates')).toBeVisible();
      await expect(page.getByRole('button', { name: /Using ISBN 9780553572391/ })).toBeVisible();
      const photoCaptureRow = page.locator('div').filter({ hasText: photoTitle }).filter({ hasText: 'Find matches' }).first();
      await expect(photoCaptureRow.getByLabel('Capture lookup matches')).toBeVisible();
      await expect(photoCaptureRow.getByText('Matches', { exact: true })).toBeVisible();
      await expect(photoCaptureRow.getByText('In library')).toBeVisible();
      const importMatchResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/capture-items/${photoCaptureId}/import-match`)
        && response.request().method() === 'POST'
      ));
      await photoCaptureRow.getByRole('button', { name: 'Link' }).first().click();
      const importMatchPayload = await (await importMatchResponse).json();
      expect(importMatchPayload?.ok).toBe(true);
      expect(importMatchPayload?.item?.status).toBe('converted');
      expect(Number(importMatchPayload?.item?.linked_media_id || 0)).toBe(catalogMediaId);
      expect(importMatchPayload?.import?.action).toBe('matched_existing');
      await expect(page.getByRole('button', { name: 'New capture' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Batch scan' })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'New capture' }).click();
      await expect(page.getByRole('button', { name: 'Scan barcode with camera' })).toBeVisible();
      await expect(page.getByLabel('Barcode camera image')).toHaveAttribute('capture', 'environment');
      await page.getByRole('button', { name: 'Save capture' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Save capture' })).toBeVisible();
      await page.route('**/api/media/lookup/barcode', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            authenticated: true,
            provider: 'playwright-barcode',
            barcode: '9780553572773',
            symbology: 'ISBN-13',
            count: 1,
            catalog_count: 0,
            provider_count: 1,
            matches: [{
              id: 'barcode:playwright:9780553572773',
              source: 'books:isbn-direct',
              match_type: 'provider_candidate',
              title: 'Before the Storm',
              normalizedTitle: 'Before the Storm',
              searchTitle: 'Before the Storm',
              barcode: '9780553572773',
              upc: '9780553572773',
              symbology: 'ISBN-13',
              mediaTypeGuess: 'book',
              media_type: 'book',
              already_imported: false
            }]
          })
        });
      });
      await page.getByLabel('Barcode / ISBN').fill('9780553572773');
      const unsavedLookupResponse = page.waitForResponse((response) => (
        response.url().includes('/api/media/lookup/barcode') && response.request().method() === 'POST'
      ));
      await page.locator('form').getByRole('button', { name: 'Find matches' }).click();
      expect((await unsavedLookupResponse).ok()).toBeTruthy();
      await expect(page.getByLabel('Scan lookup results')).toBeVisible();
      await expect(page.getByText('Before the Storm', { exact: true })).toBeVisible();
      await expect(page.locator('form').getByRole('button', { name: 'Add exact ISBN' })).toBeVisible();
      await expect(page.locator('form').getByRole('button', { name: 'Save and scan next' })).toBeVisible();
      await page.unroute('**/api/media/lookup/barcode');

      const convertResponse = await postWithCsrf(requestContext, `/api/capture-items/${captureId}/convert-wishlist`, {}, 201);
      const convertPayload = await convertResponse.json();
      expect(convertPayload?.ok).toBe(true);
      wantedItemId = Number(convertPayload?.wanted_item?.id || 0);
      expect(wantedItemId).toBeGreaterThan(0);
      expect(convertPayload?.item?.status).toBe('converted');

      const wishlistResponse = await requestContext.get(`/api/wishlist?status=active&search=${encodeURIComponent(title)}`);
      expect(wishlistResponse.ok()).toBeTruthy();
      const wishlistPayload = await wishlistResponse.json();
      expect(wishlistPayload?.items?.some((item) => item.id === wantedItemId && item.provider === 'capture')).toBeTruthy();
    } finally {
      if (captureId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/capture-items/${captureId}`, undefined, [200, 404]).catch(() => {});
      }
      if (photoCaptureId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/capture-items/${photoCaptureId}`, undefined, [200, 404]).catch(() => {});
      }
      if (scannerCaptureId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/capture-items/${scannerCaptureId}`, undefined, [200, 404]).catch(() => {});
      }
      if (wantedItemId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/wishlist/${wantedItemId}`, undefined, [200, 404]).catch(() => {});
      }
      if (catalogMediaId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/media/${catalogMediaId}`, undefined, [200, 404]).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('authenticated admin shell loads and docs surface is available when debug gating is satisfied', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'HELP ADMIN' })).toBeVisible();

    await page.goto('/api/docs');
    await expect(page).toHaveTitle(/collectZ API Docs/i);
    await expect(page.locator('#swagger-ui')).toBeVisible();
  });

  test('all spaces drawer tabs and support-session banner behave in the browser', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const { space } = await createSpaceFixture(requestContext, suffix);
    let cleanupPending = true;

    try {
      await requestContext.delete('/api/auth/support-session').catch(() => {});
      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-spaces');
      await expect(page.getByRole('heading', { name: 'All Workspaces' })).toBeVisible();

      await page.getByRole('heading', { name: space.name }).click();
      await expect(page.getByRole('heading', { name: 'Workspace Controls' })).toBeVisible();

      await page.getByRole('tab', { name: /Members \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

      await page.getByRole('tab', { name: /Invitations \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();

      await page.getByRole('button', { name: 'Start Support Session' }).first().click();
      await expect(page.getByRole('heading', { name: new RegExp(`Open explicit support access for ${space.name}`) })).toBeVisible();

      await page.getByLabel('Reason').fill(`Playwright support session ${suffix}`);
      await page.getByRole('button', { name: 'Start Support Session' }).last().click();

      await expect(page.getByText('Support session active')).toBeVisible();
      await expect(page.getByText(new RegExp(`Reason: Playwright support session ${suffix}`))).toBeVisible();

      await page.getByRole('button', { name: 'End support session' }).click();
      await expect(page.getByText('Support session active')).toHaveCount(0);
    } finally {
      await requestContext.delete('/api/auth/support-session').catch(() => {});
      if (cleanupPending) {
        await deleteSpace(requestContext, Number(space.id)).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('integrations tabs switch and save feedback stays visible', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    await page.goto('/dashboard?tab=admin-integrations&integration=logs');
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

    const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
    await expect(sectionTabs.getByRole('tab')).toHaveText([
      'Audio',
      'Barcode',
      'Books',
      'CWA OPDS',
      'Comics',
      'PriceCharting',
      'eBay Browse',
      'Games',
      'Kavita',
      'External Logs',
      'Metrics',
      'Plex',
      'TMDB'
    ]);

    await sectionTabs.getByRole('tab', { name: 'Metrics', exact: true }).click();
    const metricsSwitch = page.getByRole('switch', { name: /Metrics Export/i });
    await expect(metricsSwitch).toBeVisible();

    const wasEnabled = await metricsSwitch.getAttribute('aria-checked');
    const toggleResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/admin/feature-flags/metrics_enabled')
      && response.request().method() === 'PATCH'
    ));
    await metricsSwitch.click();
    const toggleResponse = await toggleResponsePromise;
    expect(toggleResponse.ok()).toBeTruthy();
    await expect(metricsSwitch).toHaveAttribute('aria-checked', wasEnabled === 'true' ? 'false' : 'true');

    const restoreResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/admin/feature-flags/metrics_enabled')
      && response.request().method() === 'PATCH'
    ));
    await metricsSwitch.click();
    const restoreResponse = await restoreResponsePromise;
    expect(restoreResponse.ok()).toBeTruthy();
    await expect(metricsSwitch).toHaveAttribute('aria-checked', wasEnabled || 'false');
  });

  test('manual merge review previews, applies same-type candidates, and blocks cross-type pairs', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const canonicalTitle = `Playwright Manual Merge Book ${suffix}`;
    const movieTitle = `Playwright Manual Merge Movie ${suffix}`;
    const createdIds = [];

    await deleteMediaByExactTitle(requestContext, canonicalTitle).catch(() => {});
    await deleteMediaByExactTitle(requestContext, movieTitle).catch(() => {});

    try {
      const canonicalResponse = await postWithCsrf(requestContext, '/api/media', {
        title: canonicalTitle,
        media_type: 'book',
        year: 2024,
        owned_formats: ['digital'],
        type_details: {
          author: 'Hugh Howey',
          isbn: '9780358447849',
          publisher: 'Mariner Books'
        }
      }, 201);
      const canonical = await canonicalResponse.json();
      createdIds.push(Number(canonical.id));

      const duplicateResponse = await postWithCsrf(requestContext, '/api/media', {
        title: canonicalTitle,
        media_type: 'book',
        year: 2024,
        owned_formats: ['paperback'],
        type_details: {
          author: 'Hugh Howey',
          isbn: '9780358447849',
          publisher: 'Mariner Books'
        }
      }, 201);
      const duplicate = await duplicateResponse.json();
      createdIds.push(Number(duplicate.id));

      const movieResponse = await postWithCsrf(requestContext, '/api/media', {
        title: movieTitle,
        media_type: 'movie',
        year: 1999,
        owned_formats: ['digital']
      }, 201);
      const movie = await movieResponse.json();
      createdIds.push(Number(movie.id));

      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-merges');

      await expect(page.getByRole('heading', { name: 'Merge Review' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recommended pairs' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reject match' }).first()).toBeVisible();
      await page.getByLabel('This record id').fill(String(canonical.id));
      await page.getByLabel('Matched record id').fill(String(duplicate.id));

      const previewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const previewResponse = await previewResponsePromise;
      expect(previewResponse.ok()).toBeTruthy();

      await expect(page.getByText('Matched on ISBN').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Compared fields' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'ISBN' })).toBeVisible();
      await expect(page.getByText('9780358447849').first()).toBeVisible();

      await page.getByLabel('Matched record id').fill(String(movie.id));
      const crossTypeResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 409
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const crossTypeResponse = await crossTypeResponsePromise;
      expect(crossTypeResponse.status()).toBe(409);

      await expect(page.getByText('Cross-type merges are not allowed').first()).toBeVisible();
      await expect(page.getByText('This record is Book and the matched record is Movie.').first()).toBeVisible();

      await page.getByLabel('Matched record id').fill(String(duplicate.id));
      const secondPreviewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const secondPreviewResponse = await secondPreviewResponsePromise;
      expect(secondPreviewResponse.ok()).toBeTruthy();

      await page.getByRole('button', { name: 'Apply merge' }).click();
      const applyResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-apply')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Confirm apply' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Merge applied' })).toBeVisible();
      await expect(page.getByText(`Record #${canonical.id} absorbed record #${duplicate.id}`)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Active merge events' })).toBeVisible();

      const revertResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-revert')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Revert merge' }).first().click();
      const revertResponse = await revertResponsePromise;
      expect(revertResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Merge reverted' })).toBeVisible();
      await expect(page.getByText(`Record #${duplicate.id} was restored from record #${canonical.id}`)).toBeVisible();
    } finally {
      for (const mediaId of createdIds.reverse()) {
        await requestContext.delete(`/api/media/${mediaId}`).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('collection merge review previews, applies duplicate collections, and reverts the active event', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const collectionTitle = `Playwright Water Monsters Set ${suffix}`;
    const itemTitleA = `Playwright Kraken ${suffix}`;
    const itemTitleB = `Playwright Octopus ${suffix}`;
    const createdMediaIds = [];

    await deleteMediaByExactTitle(requestContext, collectionTitle).catch(() => {});
    await deleteMediaByExactTitle(requestContext, itemTitleA).catch(() => {});
    await deleteMediaByExactTitle(requestContext, itemTitleB).catch(() => {});

    try {
      const sourceResponse = await postWithCsrf(requestContext, '/api/media', {
        title: collectionTitle,
        media_type: 'movie',
        year: 2024,
        owned_formats: ['digital']
      }, 201);
      const sourceTitleA = await sourceResponse.json();
      createdMediaIds.push(Number(sourceTitleA.id));

      const duplicateResponse = await postWithCsrf(requestContext, '/api/media', {
        title: collectionTitle,
        media_type: 'movie',
        year: 2024,
        owned_formats: ['digital']
      }, 201);
      const sourceTitleB = await duplicateResponse.json();
      createdMediaIds.push(Number(sourceTitleB.id));

      const itemResponseA = await postWithCsrf(requestContext, '/api/media', {
        title: itemTitleA,
        media_type: 'movie',
        year: 2020,
        owned_formats: ['digital']
      }, 201);
      const itemA = await itemResponseA.json();
      createdMediaIds.push(Number(itemA.id));

      const itemResponseB = await postWithCsrf(requestContext, '/api/media', {
        title: itemTitleB,
        media_type: 'movie',
        year: 2021,
        owned_formats: ['digital']
      }, 201);
      const itemB = await itemResponseB.json();
      createdMediaIds.push(Number(itemB.id));

      const convertResponseA = await postWithCsrf(requestContext, `/api/media/${sourceTitleA.id}/convert-to-collection`, {}, 200);
      const convertedA = await convertResponseA.json();
      const convertResponseB = await postWithCsrf(requestContext, `/api/media/${sourceTitleB.id}/convert-to-collection`, {}, 200);
      const convertedB = await convertResponseB.json();

      await postWithCsrf(requestContext, `/api/media/collections/${convertedA.collection_id}/items`, {
        media_id: itemA.id,
        position: 1
      }, 201);
      await postWithCsrf(requestContext, `/api/media/collections/${convertedB.collection_id}/items`, {
        media_id: itemA.id,
        position: 1
      }, 201);
      await postWithCsrf(requestContext, `/api/media/collections/${convertedB.collection_id}/items`, {
        media_id: itemB.id,
        position: 2
      }, 201);

      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-merges');

      await page.getByRole('tab', { name: 'Collections' }).click();
      await page.getByPlaceholder('Search duplicate collections').fill(collectionTitle);
      await expect(page.getByText(collectionTitle).first()).toBeVisible();

      const previewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/duplicate-preview')
        && response.request().method() === 'GET'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Review group' }).first().click();
      const previewResponse = await previewResponsePromise;
      expect(previewResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection preview' })).toBeVisible();
      await expect(page.getByText('Matched on collection name and expected item count').first()).toBeVisible();
      await expect(page.getByText('Merged items').first()).toBeVisible();

      const applyResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/merge-apply')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Apply merge' }).click();
      await page.getByRole('button', { name: 'Confirm apply' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection merge applied' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Active collection merge events' })).toBeVisible();

      const revertResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/merge-revert')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Revert merge' }).first().click();
      const revertResponse = await revertResponsePromise;
      expect(revertResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection merge reverted' })).toBeVisible();
    } finally {
      const collections = await findCollectionsByName(requestContext, collectionTitle).catch(() => []);
      for (const collection of collections) {
        await postWithCsrf(requestContext, `/api/media/collections/${collection.id}/convert-to-individual`, {}, 200).catch(() => {});
      }
      await deleteMediaByExactTitle(requestContext, collectionTitle).catch(() => {});
      await deleteMediaByExactTitle(requestContext, itemTitleA).catch(() => {});
      await deleteMediaByExactTitle(requestContext, itemTitleB).catch(() => {});
      for (const mediaId of createdMediaIds.reverse()) {
        await requestContext.delete(`/api/media/${mediaId}`).catch(() => {});
      }
      await requestContext.dispose();
    }
  });
});
