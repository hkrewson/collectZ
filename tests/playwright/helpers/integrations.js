'use strict';

const { patchWithCsrf, requestWithCsrf } = require('./auth');

function buildIntegrationRestorePayload(snapshot) {
  return {
    barcodePreset: snapshot.barcodePreset,
    barcodeProvider: snapshot.barcodeProvider,
    barcodeApiUrl: snapshot.barcodeApiUrl,
    tmdbPreset: snapshot.tmdbPreset,
    tmdbProvider: snapshot.tmdbProvider,
    tmdbApiUrl: snapshot.tmdbApiUrl,
    plexPreset: snapshot.plexPreset,
    plexProvider: snapshot.plexProvider,
    plexApiUrl: snapshot.plexApiUrl,
    plexLibrarySections: Array.isArray(snapshot.plexLibrarySections) ? snapshot.plexLibrarySections : [],
    booksPreset: snapshot.booksPreset,
    booksProvider: snapshot.booksProvider,
    booksApiUrl: snapshot.booksApiUrl,
    audioPreset: snapshot.audioPreset,
    audioProvider: snapshot.audioProvider,
    audioApiUrl: snapshot.audioApiUrl,
    gamesPreset: snapshot.gamesPreset,
    gamesProvider: snapshot.gamesProvider,
    gamesApiUrl: snapshot.gamesApiUrl,
    gamesClientId: snapshot.gamesClientId,
    comicsPreset: snapshot.comicsPreset,
    comicsProvider: snapshot.comicsProvider,
    comicsApiUrl: snapshot.comicsApiUrl,
    comicsUsername: snapshot.comicsUsername,
    cwaOpdsUrl: snapshot.cwaOpdsUrl,
    cwaUsername: snapshot.cwaUsername
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
