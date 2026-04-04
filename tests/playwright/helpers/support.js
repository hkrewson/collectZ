'use strict';

const { postWithCsrf, patchWithCsrf } = require('./auth');

async function createSupportRequest(requestContext, { subject, message }) {
  const response = await postWithCsrf(requestContext, '/api/support/requests', { subject, message }, 201);
  return response.json();
}

async function sendSupportReply(requestContext, requestId, body) {
  const response = await postWithCsrf(requestContext, `/api/support/requests/${requestId}/messages`, { body }, 201);
  return response.json();
}

async function saveSupportTriage(requestContext, requestId, payload) {
  const response = await patchWithCsrf(requestContext, `/api/support/requests/${requestId}/triage`, payload, 200);
  return response.json();
}

async function createSupportCaptureFixture(requestContext, suffix) {
  const created = await createSupportRequest(requestContext, {
    subject: `Capture flow ${suffix}`,
    message: 'Need help capturing a stable support workspace screenshot.'
  });
  const requestId = Number(created?.request?.id || 0);
  if (!requestId) {
    throw new Error('Support capture fixture did not return a request id');
  }

  await sendSupportReply(
    requestContext,
    requestId,
    'Added one more reply so the support conversation screenshot has realistic thread content.'
  );

  await saveSupportTriage(requestContext, requestId, {
    classification: 'bug',
    tracking_status: 'investigating',
    repo_issue_number: 123,
    repo_issue_url: '',
    resolved_in_version: '',
    internal_notes: 'Capture fixture: seeded for Playwright docs screenshots.'
  });

  return requestId;
}

async function updateSupportAccess(requestContext, requestId, nextStatus) {
  const response = await patchWithCsrf(requestContext, `/api/support/requests/${requestId}/access`, {
    support_access_status: nextStatus
  }, 200);
  return response.json();
}

async function createLibraryInActiveScope(requestContext, name) {
  const response = await postWithCsrf(requestContext, '/api/libraries', { name }, 201);
  return response.json();
}

async function createApprovedSupportRequestFixture(requestContext, suffix) {
  const created = await createSupportRequest(requestContext, {
    subject: `Approved support flow ${suffix}`,
    message: 'Need an approved support request so browser coverage can exercise Help Admin session controls.'
  });
  const requestId = Number(created?.request?.id || 0);
  if (!requestId) {
    throw new Error('Approved support fixture did not return a request id');
  }
  const approved = await updateSupportAccess(requestContext, requestId, 'approved');
  return {
    requestId,
    request: approved?.request || created?.request || null
  };
}

module.exports = {
  createSupportCaptureFixture,
  createApprovedSupportRequestFixture,
  createLibraryInActiveScope
};
