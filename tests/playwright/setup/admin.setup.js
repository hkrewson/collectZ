'use strict';

const { test } = require('@playwright/test');
const { ensureAuthenticatedAdminStorageState } = require('../helpers/auth');

test('bootstrap authenticated admin storage state', async ({ request }) => {
  await ensureAuthenticatedAdminStorageState(request);
});
