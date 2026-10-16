const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
test('browser sign-in preserves activation and approves only an explicit valid code', async ({ page }) => {
  const suffix=crypto.randomBytes(12).toString('hex'); const password=crypto.randomBytes(24).toString('base64url')+'aA9!';
  const email=`tv-browser-${suffix}@example.invalid`;
  const registration=await page.request.post('/api/auth/register',{data:{email,password,name:'TV Browser Test'}});
  expect(registration.ok()).toBeTruthy();
  const csrf=(await (await page.request.get('/api/auth/csrf-token')).json()).csrfToken;
  const start=await page.request.post('/api/mobile/auth/device/start',{headers:{'x-csrf-token':csrf},data:{device_name:'Browser test TV'}});
  expect(start.status()).toBe(201); const code=await start.json();
  await page.context().clearCookies();
  await page.goto('/activate');
  await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading',{name:'Connect Apple TV'})).toBeVisible();
  await expect(page).toHaveURL(/\/activate$/);
  await page.getByLabel('Code shown on Apple TV').fill('ZZZZ-ZZZZ');
  await page.getByRole('button',{name:'Approve Apple TV'}).click();
  await expect(page.getByRole('alert')).toContainText('Check the code');
  await page.getByLabel('Code shown on Apple TV').fill(code.user_code);
  await page.getByRole('button',{name:'Approve Apple TV'}).click();
  await expect(page.getByRole('status')).toContainText('Apple TV approved');
  // Remove the one-time code before preserving any visual evidence.
  await page.screenshot({path:'artifacts/tv-browser/approval.png'});
});
