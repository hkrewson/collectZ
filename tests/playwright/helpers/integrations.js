'use strict';

const { patchWithCsrf, requestWithCsrf } = require('./auth');

function buildIntegrationRestorePayload(snapshot) {
  return {
    priceChartingEnabled: snapshot.valuationProviders?.pricecharting?.enabled,
    priceChartingApiUrl: snapshot.valuationProviders?.pricecharting?.apiUrl,
    priceChartingRateLimitMs: snapshot.valuationProviders?.pricecharting?.rateLimitMs,
    eBayBrowseEnabled: snapshot.valuationProviders?.ebayBrowse?.enabled,
    eBayBrowseApiUrl: snapshot.valuationProviders?.ebayBrowse?.apiUrl,
    eBayBrowseClientId: snapshot.valuationProviders?.ebayBrowse?.clientId,
    eBayBrowseMarketplaceId: snapshot.valuationProviders?.ebayBrowse?.marketplaceId,
    logExportBackend: snapshot.logExportControl?.stored?.backend || snapshot.logExportControl?.effective?.backend || '',
    logExportHost: snapshot.logExportControl?.stored?.host || snapshot.logExportControl?.effective?.host || '',
    logExportPort: snapshot.logExportControl?.stored?.port || snapshot.logExportControl?.effective?.port || '',
    logExportHostLabel: snapshot.logExportControl?.stored?.hostLabel || snapshot.logExportControl?.effective?.hostLabel || '',
    logExportService: snapshot.logExportControl?.stored?.service || snapshot.logExportControl?.effective?.service || '',
    logExportDebug: snapshot.logExportControl?.stored?.debugEnabled ?? snapshot.logExportControl?.effective?.debugEnabled ?? false
  };
}

async function getIntegrationSettings(requestContext) {
  const response = await requestContext.get('/api/admin/settings/integrations');
  if (!response.ok()) {
    throw new Error(`Failed to load integration settings (${response.status()})`);
  }
  return response.json();
}

async function updateIntegrationSettings(requestContext, payload) {
  const response = await requestWithCsrf(requestContext, 'PUT', '/api/admin/settings/integrations', payload, 200);
  return response.json();
}

async function getFeatureFlags(requestContext) {
  const response = await requestContext.get('/api/admin/feature-flags');
  if (!response.ok()) {
    throw new Error(`Failed to load feature flags (${response.status()})`);
  }
  return response.json();
}

async function updateFeatureFlag(requestContext, key, enabled) {
  const response = await patchWithCsrf(requestContext, `/api/admin/feature-flags/${encodeURIComponent(key)}`, { enabled }, 200);
  return response.json();
}

async function snapshotIntegrationState(requestContext) {
  const settings = await getIntegrationSettings(requestContext);
  const featurePayload = await getFeatureFlags(requestContext);
  const metricsFlag = Array.isArray(featurePayload?.flags)
    ? featurePayload.flags.find((flag) => flag?.key === 'metrics_enabled') || null
    : null;
  return {
    settings,
    metricsEnabled: typeof metricsFlag?.enabled === 'boolean' ? metricsFlag.enabled : null
  };
}

async function restoreIntegrationState(requestContext, snapshot) {
  if (snapshot?.settings) {
    await updateIntegrationSettings(requestContext, buildIntegrationRestorePayload(snapshot.settings));
  }
  if (typeof snapshot?.metricsEnabled === 'boolean') {
    await updateFeatureFlag(requestContext, 'metrics_enabled', snapshot.metricsEnabled);
  }
}

module.exports = {
  buildIntegrationRestorePayload,
  getIntegrationSettings,
  updateIntegrationSettings,
  getFeatureFlags,
  updateFeatureFlag,
  snapshotIntegrationState,
  restoreIntegrationState
};
