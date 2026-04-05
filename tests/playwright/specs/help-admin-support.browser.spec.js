'use strict';

const { test, expect } = require('@playwright/test');
const { createSupportCaptureFixture } = require('../helpers/support');

test.describe('help admin support workspace regressions', () => {
  test('support staff can work a selected request across reply, triage, history, and completed queue views', async ({ page, request }) => {
    const fixture = await createSupportCaptureFixture(request, Date.now());
    const requestId = Number(fixture?.requestId || 0);
    const requestKey = fixture?.requestKey || `SUP-${String(requestId).padStart(6, '0')}`;
    const requestSubject = fixture?.subject || requestKey;
    const replyText = `Admin browser reply ${Date.now()}`;

    await page.goto('/dashboard?tab=support-inbox');
    await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search queue' }).fill(requestSubject);

    const requestCard = page.locator('button').filter({ hasText: requestSubject }).first();
    await expect(requestCard).toBeVisible();
    await requestCard.click();

    const replyForm = page.locator('form').filter({ hasText: 'Reply to requester' }).first();
    await expect(replyForm).toBeVisible();
    await replyForm.getByPlaceholder('Reply with guidance, next steps, or a clarifying question.').fill(replyText);
    const replyResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/api/support/requests/${requestId}/messages`)
      && response.request().method() === 'POST'
    ));
    await replyForm.getByRole('button', { name: 'Reply', exact: true }).click();
    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBeTruthy();
    await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
    await expect(page.getByText(replyText, { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Triage', exact: true }).click();
    await expect(page.getByText('Linked engineering work')).toBeVisible();
    await page.locator('label').filter({ hasText: 'Tracking Status' }).locator('select').selectOption('shipped');
    await page.locator('label').filter({ hasText: 'Resolved In Version' }).getByPlaceholder('v2.9.2').fill('v2.9.4');
    const triageResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/api/support/requests/${requestId}/triage`)
      && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'Save triage' }).click();
    const triageResponse = await triageResponsePromise;
    expect(triageResponse.ok()).toBeTruthy();
    await expect(
      page.locator('label').filter({ hasText: 'Resolved In Version' }).locator('input'),
    ).toHaveValue('v2.9.4');

    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByText('Triage updated').first()).toBeVisible();

    const closeResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/api/support/requests/${requestId}/status`)
      && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'Close Case' }).click();
    const closeResponse = await closeResponsePromise;
    expect(closeResponse.ok()).toBeTruthy();

    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('button').filter({ hasText: requestKey }).first()).toBeVisible();
  });
});
