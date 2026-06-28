'use strict';

const { test, expect } = require('@playwright/test');
const {
  addDirectSpaceMembership,
  createAuthenticatedRequestContext,
  createFreshUserCredentials,
  postWithCsrf
} = require('../helpers/auth');
const { createLibraryInActiveScope } = require('../helpers/support');

test.use({ storageState: { cookies: [], origins: [] } });

async function listLibraries(requestContext) {
  const response = await requestContext.get('/api/libraries');
  if (!response.ok()) {
    throw new Error(`Failed to list libraries (${response.status()})`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.libraries) ? payload.libraries : [];
}

async function getCurrentUser(requestContext) {
  const response = await requestContext.get('/api/auth/me');
  if (!response.ok()) {
    throw new Error(`Failed to load current user (${response.status()})`);
  }
  return response.json();
}

function getReplacementLibrary(libraries, removedLibraryId) {
  const replacement = libraries.find((library) => Number(library?.id || 0) !== Number(removedLibraryId || 0)) || null;
  if (!replacement) {
    throw new Error('Expected a surviving accessible replacement library');
  }
  return replacement;
}

async function expectImportLibraryContext(page, { libraryId, libraryName }) {
  await page.goto('/dashboard?tab=library-import');
  await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Import sources' })).toBeVisible();
  await expect(page.getByText(`Bring titles into “${libraryName}” from files or connected services.`, { exact: true })).toHaveCount(0);
}

test.describe('library lifecycle browser regressions', () => {
  test('archiving the active library falls back the browser shell onto a surviving accessible library', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ noCache: true });
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const suffix = Date.now();

    try {
      const archiveTarget = await createLibraryInActiveScope(requestContext, `Playwright Archive Target ${suffix}`);
      const librariesBefore = await listLibraries(requestContext);
      const expectedFallback = getReplacementLibrary(librariesBefore, archiveTarget.id);

      await postWithCsrf(requestContext, '/api/libraries/select', { library_id: archiveTarget.id }, 200);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await expectImportLibraryContext(page, {
        libraryId: archiveTarget.id,
        libraryName: archiveTarget.name
      });

      await postWithCsrf(requestContext, `/api/libraries/${archiveTarget.id}/archive`, {
        confirm_name: archiveTarget.name
      }, 200);

      await page.reload();
      await expectImportLibraryContext(page, {
        libraryId: expectedFallback.id,
        libraryName: expectedFallback.name
      });
      await expect(page.getByText(archiveTarget.name, { exact: true })).toHaveCount(0);
    } finally {
      await requestContext.dispose();
    }
  });

  test('transferring the active library away from the previous owner falls back the browser shell onto a surviving accessible library', async ({ page }) => {
    const ownerCredentials = await createFreshUserCredentials({ noCache: true });
    const recipientCredentials = await createFreshUserCredentials({ noCache: true });
    const ownerContext = await createAuthenticatedRequestContext(ownerCredentials);
    const recipientContext = await createAuthenticatedRequestContext(recipientCredentials);
    const suffix = Date.now();

    try {
      const ownerUser = await getCurrentUser(ownerContext);
      const recipientUser = await getCurrentUser(recipientContext);
      const ownerSpaceId = Number(ownerUser?.active_space_id || 0) || null;
      const recipientUserId = Number(recipientUser?.id || 0) || null;
      expect(ownerSpaceId).toBeTruthy();
      expect(recipientUserId).toBeTruthy();

      await addDirectSpaceMembership({
        spaceId: ownerSpaceId,
        userId: recipientUserId,
        role: 'member',
        createdBy: Number(ownerUser.id)
      });

      const transferTarget = await createLibraryInActiveScope(ownerContext, `Playwright Transfer Target ${suffix}`);
      const librariesBefore = await listLibraries(ownerContext);
      const expectedFallback = getReplacementLibrary(librariesBefore, transferTarget.id);

      await postWithCsrf(ownerContext, '/api/libraries/select', { library_id: transferTarget.id }, 200);

      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await expectImportLibraryContext(page, {
        libraryId: transferTarget.id,
        libraryName: transferTarget.name
      });

      await postWithCsrf(ownerContext, `/api/libraries/${transferTarget.id}/transfer`, {
        new_owner_user_id: recipientUserId
      }, 200);

      await page.reload();
      await expectImportLibraryContext(page, {
        libraryId: expectedFallback.id,
        libraryName: expectedFallback.name
      });
      await expect(page.getByText(transferTarget.name, { exact: true })).toHaveCount(0);
    } finally {
      await recipientContext.dispose();
      await ownerContext.dispose();
    }
  });
});
