'use strict';

async function waitForSyncJob(requestContext, jobId, { timeoutMs = 30000, pollIntervalMs = 500 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await requestContext.get(`/api/media/sync-jobs/${jobId}`);
    if (!response.ok()) {
      const text = await response.text();
      throw new Error(`Failed to load sync job #${jobId} (${response.status()}): ${text}`);
    }
    const payload = await response.json();
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'failed') {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for sync job #${jobId} to finish`);
}

module.exports = {
  waitForSyncJob
};
