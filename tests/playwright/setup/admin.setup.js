'use strict';

const { test } = require('@playwright/test');
const {
  createAuthenticatedRequestContext,
  ensureAuthenticatedAdminStorageState
} = require('../helpers/auth');
const { updateFeatureFlag } = require('../helpers/integrations');

test('bootstrap authenticated admin storage state', async ({ request }) => {
  const { credentials } = await ensureAuthenticatedAdminStorageState(request);
  const requestContext = await createAuthenticatedRequestContext(credentials);
  try {
    await updateFeatureFlag(requestContext, 'events_enabled', true);
  } finally {
    await requestContext.dispose();
  }
});
