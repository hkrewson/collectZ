'use strict';

const assert = require('assert');
const { parseCsvText } = require('../services/csv');
const { normalizePlexItem, normalizePlexVariant, shouldIncludePlexEntry } = require('../services/plex');
const { wrapTmdbRequestError } = require('../services/tmdb');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIsbn, normalizeIdentifierSet } = require('../services/importIdentifiers');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { extractScopeHints, resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { sanitizeAuditDetails } = require('../services/audit');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'unit-test-integration-key';
const { buildIntegrationResponse } = require('../services/integrationResponse');
const { buildCompactJobSummary, formatSyncJob } = require('../services/syncJobs');
const metricsModule = require('../services/metrics');
const { shouldEnforceCsrf } = require('../middleware/csrf');
const authModulePath = require.resolve('../middleware/auth');
const {
  hasPersonalAccessTokenScope,
  getRequiredPatScopesForRequest
} = require('../services/personalAccessTokens');
const { isServiceAccountPrefixAllowed } = require('../services/serviceAccountKeys');
const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
const mediaRoutesSource = require('fs').readFileSync(require.resolve('../routes/media'), 'utf8');
const openApiSource = require('fs').readFileSync(require.resolve('../openapi/openapi.yaml'), 'utf8');
const docsRoutesSource = require('fs').readFileSync(require.resolve('../routes/docs'), 'utf8');
const metricsRoutesSource = require('fs').readFileSync(require.resolve('../routes/metrics'), 'utf8');
const dashboardSpec = JSON.parse(require('fs').readFileSync(require.resolve('../../ops/monitoring/grafana/dashboards/collectz-overview.json'), 'utf8'));
const alertRulesSource = require('fs').readFileSync(require.resolve('../../docs/alerts/collectz-alert-rules.yaml'), 'utf8');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || error);
    return false;
  }
}

const results = [];

results.push(run('csv.parseCsvText parses headers and rows', () => {
  const input = 'title,year,format\nDune,1984,VHS\nAliens,1986,Blu-ray\n';
  const parsed = parseCsvText(input);
  assert.deepStrictEqual(parsed.headers, ['title', 'year', 'format']);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].title, 'Dune');
  assert.strictEqual(parsed.rows[1].year, '1986');
}));

results.push(run('csv.parseCsvText handles BOM + empty lines', () => {
  const input = '\ufefftitle,year\n\nDune,1984\n';
  const parsed = parseCsvText(input);
  assert.deepStrictEqual(parsed.headers, ['title', 'year']);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].title, 'Dune');
}));

results.push(run('plex.normalizePlexItem maps movie values', () => {
  const input = {
    type: 'movie',
    title: 'Dune',
    originalTitle: 'Dune',
    year: '1984',
    duration: '8160000',
    summary: 'Arrakis',
    rating: '6.4',
    guid: 'plex://movie/abc?guid=tmdb://841',
    thumb: 'https://image.example/poster.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Dune');
  assert.strictEqual(out.media_type, 'movie');
  assert.strictEqual(out.tmdb_id, 841);
  assert.strictEqual(out.runtime, 136);
  assert.strictEqual(out.poster_path, 'https://image.example/poster.jpg');
}));

results.push(run('plex.normalizePlexItem maps episode to tv series context', () => {
  const input = {
    type: 'episode',
    title: 'Episode title',
    grandparentTitle: 'Ahsoka',
    grandparentRatingKey: 'show-123',
    parentIndex: '1',
    guid: 'plex://episode/xyz?guid=tmdb://12345'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Ahsoka');
  assert.strictEqual(out.media_type, 'tv_series');
  assert.strictEqual(out.tmdb_media_type, 'tv');
  assert.strictEqual(out.plex_rating_key, 'show-123');
  assert.strictEqual(out.season_number, 1);
}));

results.push(run('plex.normalizePlexItem maps album to audio context', () => {
  const input = {
    type: 'album',
    title: 'The Wall',
    parentTitle: 'Pink Floyd',
    year: '1979',
    thumb: 'https://image.example/wall.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'The Wall');
  assert.strictEqual(out.media_type, 'audio');
  assert.strictEqual(out.tmdb_media_type, null);
  assert.strictEqual(out.type_details.artist, 'Pink Floyd');
  assert.strictEqual(out.type_details.album, 'The Wall');
}));

results.push(run('plex.normalizePlexVariant derives season edition + key', () => {
  const input = {
    type: 'episode',
    ratingKey: 'ep-555',
    grandparentRatingKey: 'show-999',
    parentIndex: '2',
    Media: [
      {
        id: 'm1',
        duration: '3600000',
        videoCodec: 'h264',
        audioCodec: 'aac',
        videoResolution: '1080',
        audioChannels: '2',
        Part: [{ id: 'p1', file: '/tv/show/s02e01.mkv', container: 'mkv' }]
      }
    ]
  };
  const out = normalizePlexVariant(input, '7');
  assert.strictEqual(out.source_item_key, '7:show:show-999:season:2');
  assert.strictEqual(out.edition, 'Season 2');
  assert.strictEqual(out.season_number, 2);
  assert.strictEqual(out.source_part_id, null);
  assert.strictEqual(out.video_codec, 'h264');
}));

results.push(run('plex.shouldIncludePlexEntry keeps TV imports at show level only', () => {
  assert.strictEqual(shouldIncludePlexEntry('show', 'show'), true);
  assert.strictEqual(shouldIncludePlexEntry('show', 'season'), false);
  assert.strictEqual(shouldIncludePlexEntry('show', 'episode'), false);
  assert.strictEqual(shouldIncludePlexEntry('', 'episode'), false);
}));

results.push(run('media route source includes tmdb trace-match endpoint', () => {
  assert.ok(mediaRoutesSource.includes("router.post('/tmdb/trace-match'"));
  assert.ok(mediaRoutesSource.includes('scoreTmdbMatchCandidate'));
}));

results.push(run('media route source guards tmdb season hydration to tv series only', () => {
  assert.ok(mediaRoutesSource.includes("normalizedMediaType !== 'tv_series' || normalizedTmdbMediaType !== 'tv'"));
  assert.ok(mediaRoutesSource.includes('tmdbMediaType: media.tmdb_media_type'));
}));

results.push(run('media route source uses title candidate fallback for tmdb lookups', () => {
  assert.ok(mediaRoutesSource.includes('findBestTmdbCandidate'));
  assert.ok(mediaRoutesSource.includes('buildLookupTitleCandidates'));
  assert.ok(mediaRoutesSource.includes('tmdb:title_variant_hit'));
  assert.ok(mediaRoutesSource.includes('lookupTitleCandidates'));
  assert.ok(mediaRoutesSource.includes('tmdbPosterLookupNoMatch'));
  assert.ok(mediaRoutesSource.includes('tmdbPosterLookupNoImage'));
  assert.ok(mediaRoutesSource.includes('trailingArticleSwap'));
  assert.ok(mediaRoutesSource.includes('bracketStripped'));
}));

results.push(run('tmdb.wrapTmdbRequestError preserves upstream status and response snippet', () => {
  const wrapped = wrapTmdbRequestError({
    response: {
      status: 404,
      data: {
        status_code: 34,
        status_message: 'The resource you requested could not be found.'
      }
    }
  }, '/tv/700391');

  assert.strictEqual(wrapped.status, 404);
  assert.strictEqual(wrapped.tmdb.status, 404);
  assert.strictEqual(wrapped.tmdb.path, '/tv/700391');
  assert.ok(wrapped.message.includes('status=404'));
  assert.ok(wrapped.message.includes('path=/tv/700391'));
  assert.ok(wrapped.message.includes('status_code'));
  assert.ok(wrapped.message.includes('could not be found'));
}));

results.push(run('scope.extractScopeHints resolves space/library inputs', () => {
  const req = {
    query: { space_id: '3' },
    body: { library_id: 'all' },
    headers: {}
  };
  const hints = extractScopeHints(req);
  assert.strictEqual(hints.spaceId, 3);
  assert.strictEqual(hints.libraryId, null);
  assert.strictEqual(hints.libraryCleared, true);
}));

results.push(run('scope.resolveScopeContext prefers request scope context', () => {
  const req = {
    scopeContext: { spaceId: 9, libraryId: 12 },
    user: { activeSpaceId: 1, activeLibraryId: 2 }
  };
  const scope = resolveScopeContext(req);
  assert.deepStrictEqual(scope, { spaceId: 9, libraryId: 12 });
}));

results.push(run('scope.appendScopeSql appends scoped clauses and params', () => {
  const params = ['title'];
  const clause = appendScopeSql(params, { spaceId: 4, libraryId: 10 });
  assert.strictEqual(clause, ' AND space_id = $2 AND library_id = $3');
  assert.deepStrictEqual(params, ['title', 4, 10]);
}));

results.push(run('importMapping maps Delicious VideoGame to game', () => {
  assert.strictEqual(mapDeliciousItemTypeToMediaType('VideoGame'), 'game');
  assert.strictEqual(mapDeliciousItemTypeToMediaType('video game'), 'game');
  assert.strictEqual(mapDeliciousItemTypeToMediaType('Movie'), 'movie');
}));

results.push(run('deliciousNormalize extracts platform and ASIN', () => {
  const row = {
    title: 'Ace Combat 4: Shattered Skies - PlayStation 2',
    platform: '',
    'amazon link': 'https://www.amazon.com/dp/B00005NZ1G',
    EAN: '0043396-030145',
    ISBN: '',
    creator: 'Namco',
    edition: 'Greatest Hits',
    format: 'DVD'
  };
  const out = normalizeDeliciousRow(row);
  assert.strictEqual(out.normalizedTitle, 'Ace Combat 4: Shattered Skies');
  assert.strictEqual(out.normalizedPlatform, 'PlayStation 2');
  assert.strictEqual(out.amazonItemId, 'B00005NZ1G');
  assert.strictEqual(out.ean, '0043396030145');
}));

results.push(run('importIdentifiers normalizes ISBN-10 to ISBN-13', () => {
  const isbn13 = normalizeIsbn('0-345-39180-2');
  assert.strictEqual(isbn13, '9780345391803');
}));

results.push(run('importIdentifiers normalizes identifier set fields', () => {
  const out = normalizeIdentifierSet({
    isbn: '978-0-316-76948-0',
    ean_upc: '0 12345 67890 5',
    asin: 'https://www.amazon.com/dp/B00005NZ1G'
  });
  assert.strictEqual(out.isbn, '9780316769480');
  assert.strictEqual(out.eanUpc, '012345678905');
  assert.strictEqual(out.asin, 'B00005NZ1G');
}));

results.push(run('typeDetails normalizes allowed keys with coercion', () => {
  const out = normalizeTypeDetails('audio', {
    artist: '  Pink Floyd ',
    album: ' The Wall ',
    track_count: '26'
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, []);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.value, {
    artist: 'Pink Floyd',
    album: 'The Wall',
    track_count: 26
  });
}));

results.push(run('typeDetails rejects invalid keys and incompatible values in strict mode', () => {
  const out = normalizeTypeDetails('book', {
    author: 'Hugh Howey',
    platform: 'PS5',
    isbn: { nested: true }
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, ['platform']);
  assert.strictEqual(out.errors.length, 1);
  assert.strictEqual(out.errors[0].key, 'isbn');
}));

results.push(run('typeDetails keeps canonical provider linkage fields for CWA imports', () => {
  const out = normalizeTypeDetails('book', {
    author: 'Alan Moore',
    provider_name: 'cwa_opds',
    provider_item_id: 'urn:uuid:abc-123',
    provider_external_url: 'https://cwa.example/books/abc-123',
    calibre_entry_id: 'urn:uuid:abc-123',
    calibre_external_url: 'https://cwa.example/books/abc-123'
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, []);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.value, {
    author: 'Alan Moore',
    provider_name: 'cwa_opds',
    provider_item_id: 'urn:uuid:abc-123',
    provider_external_url: 'https://cwa.example/books/abc-123',
    calibre_entry_id: 'urn:uuid:abc-123',
    calibre_external_url: 'https://cwa.example/books/abc-123'
  });
}));

results.push(run('audit.sanitizeAuditDetails redacts token and secret fields recursively', () => {
  const out = sanitizeAuditDetails({
    authorization: 'Bearer abc123secret',
    api_key: 'super-secret',
    nested: {
      password: 'password1',
      resetTokenId: 14,
      token: 'raw-reset-token'
    },
    items: [
      { cookie: 'session_token=abc' },
      { safe: 'ok' }
    ]
  });
  assert.deepStrictEqual(out, {
    authorization: '[REDACTED]',
    api_key: '[REDACTED]',
    nested: {
      password: '[REDACTED]',
      resetTokenId: 14,
      token: '[REDACTED]'
    },
    items: [
      { cookie: '[REDACTED]' },
      { safe: 'ok' }
    ]
  });
}));

results.push(run('audit.sanitizeAuditDetails redacts sensitive string patterns even under non-sensitive keys', () => {
  const out = sanitizeAuditDetails({
    response: {
      headerPreview: 'Bearer abc.def.ghi',
      notes: 'session_token=abcdef'
    },
    reason: 'missing_token',
    resetTokenId: 22
  });
  assert.deepStrictEqual(out, {
    response: {
      headerPreview: '[REDACTED]',
      notes: '[REDACTED]'
    },
    reason: 'missing_token',
    resetTokenId: 22
  });
}));

results.push(run('integrations.buildIntegrationResponse masks secrets and exposes only set flags', () => {
  const response = buildIntegrationResponse({
    barcodePreset: 'upcitemdb',
    barcodeProvider: 'upcitemdb',
    barcodeApiUrl: 'https://barcode.example',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc',
    barcodeApiKey: 'barcode-secret',
    visionPreset: 'ocrspace',
    visionProvider: 'ocrspace',
    visionApiUrl: 'https://vision.example',
    visionApiKeyHeader: 'apikey',
    visionApiKey: 'vision-secret',
    tmdbPreset: 'tmdb',
    tmdbProvider: 'tmdb',
    tmdbApiUrl: 'https://tmdb.example',
    tmdbApiKeyHeader: 'Authorization',
    tmdbApiKeyQueryParam: 'api_key',
    tmdbApiKey: 'tmdb-secret',
    plexPreset: 'plex',
    plexProvider: 'plex',
    plexApiUrl: 'https://plex.example',
    plexServerName: 'Plex',
    plexApiKeyQueryParam: 'X-Plex-Token',
    plexApiKey: 'plex-secret',
    plexLibrarySections: [{ key: '1', title: 'Movies', type: 'movie' }],
    booksPreset: 'googlebooks',
    booksProvider: 'googlebooks',
    booksApiUrl: 'https://books.example',
    booksApiKeyHeader: 'x-api-key',
    booksApiKeyQueryParam: 'key',
    booksApiKey: 'books-secret',
    audioPreset: 'discogs',
    audioProvider: 'discogs',
    audioApiUrl: 'https://audio.example',
    audioApiKeyHeader: 'Authorization',
    audioApiKeyQueryParam: 'token',
    audioApiKey: 'audio-secret',
    gamesPreset: 'igdb',
    gamesProvider: 'igdb',
    gamesApiUrl: 'https://games.example',
    gamesApiKeyHeader: 'Authorization',
    gamesApiKeyQueryParam: 'client_id',
    gamesClientId: 'client-id',
    gamesClientSecret: 'games-client-secret',
    gamesApiKey: 'games-secret',
    comicsPreset: 'metron',
    comicsProvider: 'metron',
    comicsApiUrl: 'https://metron.example',
    comicsApiKeyHeader: 'Authorization',
    comicsApiKeyQueryParam: 'api_key',
    comicsUsername: 'reader',
    comicsApiKey: 'comics-secret',
    cwaOpdsUrl: 'https://cwa.example/opds/books',
    cwaBaseUrl: 'https://cwa.example',
    cwaUsername: 'cwa-user',
    cwaTimeoutMs: 20000,
    cwaPassword: 'cwa-secret',
    decryptWarnings: []
  });

  assert.strictEqual(response.barcodeApiKeySet, true);
  assert.strictEqual(response.gamesClientSecretSet, true);
  assert.strictEqual(response.cwaPasswordSet, true);
  assert.ok(response.barcodeApiKeyMasked);
  assert.ok(response.gamesClientSecretMasked);
  assert.ok(response.cwaPasswordMasked);
  assert.notStrictEqual(response.barcodeApiKeyMasked, 'barcode-secret');
  assert.notStrictEqual(response.gamesClientSecretMasked, 'games-client-secret');
  assert.notStrictEqual(response.cwaPasswordMasked, 'cwa-secret');
  assert.strictEqual('barcodeApiKey' in response, false);
  assert.strictEqual('gamesClientSecret' in response, false);
  assert.strictEqual('cwaPassword' in response, false);
  assert.deepStrictEqual(response.plexLibrarySections, [{ key: '1', title: 'Movies', type: 'movie' }]);
}));

results.push(run('integrations.buildIntegrationResponse keeps empty secrets out of masked output', () => {
  const response = buildIntegrationResponse({
    barcodePreset: 'upcitemdb',
    barcodeProvider: 'upcitemdb',
    barcodeApiUrl: 'https://barcode.example',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc',
    barcodeApiKey: null,
    decryptWarnings: ['cannot_decrypt_tmdb_api_key']
  });

  assert.strictEqual(response.barcodeApiKeySet, false);
  assert.strictEqual(response.barcodeApiKeyMasked, '');
  assert.strictEqual(response.decryptHealth.hasWarnings, true);
  assert.deepStrictEqual(response.decryptHealth.warnings, ['cannot_decrypt_tmdb_api_key']);
  assert.ok(response.decryptHealth.remediation);
}));

results.push(run('syncJobs.buildCompactJobSummary keeps status-relevant counters and omits verbose arrays', () => {
  const summary = buildCompactJobSummary({
    imported: 1874,
    created: 0,
    updated: 1874,
    skipped: 0,
    errorCount: 0,
    tmdbPosterEnriched: 1618,
    tmdbPosterLookupMisses: 44,
    tmdbPosterLookupNoMatch: 31,
    tmdbPosterLookupNoImage: 13,
    tmdbPosterLookupMissSamples: [{ mediaTitle: 'Example' }],
    enrichmentErrors: [{ type: 'plex_season_fetch' }, { type: 'tmdb_season_summary_fetch' }],
    enrichmentMisses: [{ type: 'tmdb_season_summary_fetch' }],
    errorsSample: [{ title: 'Example' }],
    matchModes: { matched_by_identifier: 10 },
    enrichment: { enriched: 9 }
  });

  assert.deepStrictEqual(summary, {
    imported: 1874,
    created: 0,
    updated: 1874,
    skipped: 0,
    errorCount: 0,
    tmdbPosterEnriched: 1618,
    tmdbPosterLookupMisses: 44,
    tmdbPosterLookupNoMatch: 31,
    tmdbPosterLookupNoImage: 13,
    matchModes: { matched_by_identifier: 10 },
    enrichment: { enriched: 9 },
    enrichmentErrorCount: 2,
    enrichmentMissCount: 1
  });
  assert.strictEqual('enrichmentErrors' in summary, false);
  assert.strictEqual('enrichmentMisses' in summary, false);
  assert.strictEqual('errorsSample' in summary, false);
  assert.strictEqual('tmdbPosterLookupMissSamples' in summary, false);
}));

results.push(run('syncJobs.formatSyncJob returns compact summary by default and full summary on request', () => {
  const job = {
    id: 14,
    job_type: 'import',
    provider: 'plex',
    status: 'succeeded',
    created_by: 1,
    scope: { libraryId: 2 },
    progress: { total: 10, processed: 10 },
    summary: {
      imported: 10,
      created: 1,
      updated: 9,
      skipped: 0,
      tmdbPosterLookupMissSamples: [{ mediaTitle: 'Example' }],
      enrichmentErrors: [{ type: 'plex_season_fetch' }]
    },
    error: null,
    started_at: '2026-03-12T10:00:00.000Z',
    finished_at: '2026-03-12T10:05:00.000Z',
    created_at: '2026-03-12T09:59:00.000Z',
    updated_at: '2026-03-12T10:05:00.000Z'
  };

  const compact = formatSyncJob(job);
  assert.deepStrictEqual(compact.summary, {
    imported: 10,
    created: 1,
    updated: 9,
    skipped: 0,
    enrichmentErrorCount: 1
  });

  const detailed = formatSyncJob(job, { includeFullSummary: true });
  assert.deepStrictEqual(detailed.summary, job.summary);
}));

results.push(run('metrics service records normalized http and auth/import counters', () => {
  metricsModule.recordHttpRequestMetric({
    method: 'GET',
    baseUrl: '/api/media',
    route: { path: '/sync-jobs/:id' },
    originalUrl: '/api/media/sync-jobs/14'
  }, 404, 87);
  metricsModule.recordHttpRequestMetric({
    method: 'PATCH',
    baseUrl: '/api/admin',
    route: { path: '/users/:id/role' },
    originalUrl: '/api/admin/users/4/role'
  }, 200, 122);
  metricsModule.recordAuthEvent('login', 'failed');
  metricsModule.recordImportJobEvent('plex', 'queued');
  assert.strictEqual(
    metricsModule.getMetricCounterValue('httpRequests', { method: 'GET', route: '/api/media/sync-jobs/:id', status_class: '4xx' }),
    1
  );
  assert.strictEqual(
    metricsModule.getMetricCounterValue('httpFailures', { method: 'GET', route: '/api/media/sync-jobs/:id', status: '404' }),
    1
  );
  assert.strictEqual(
    metricsModule.getMetricCounterValue('authEvents', { action: 'login', outcome: 'failed' }),
    1
  );
  assert.strictEqual(
    metricsModule.getMetricCounterValue('importJobs', { provider: 'plex', status: 'queued' }),
    1
  );
  metricsModule.recordImportEnrichmentEvent('plex', 'tmdb_poster', 'no_match', 2);
  assert.strictEqual(
    metricsModule.getMetricCounterValue('importEnrichment', { provider: 'plex', kind: 'tmdb_poster', outcome: 'no_match' }),
    2
  );
  metricsModule.recordProviderRequestEvent('tmdb', 'search_movie', 'success', 3);
  assert.strictEqual(
    metricsModule.getMetricCounterValue('providerRequests', { provider: 'tmdb', operation: 'search_movie', outcome: 'success' }),
    3
  );
  assert.strictEqual(
    metricsModule.getMetricCounterValue('adminActions', { method: 'PATCH', route: '/api/admin/users/:id/role', outcome: 'succeeded' }),
    1
  );
}));

results.push(run('media route source stores tmdb poster miss samples in async job summaries', () => {
  assert.ok(mediaRoutesSource.includes('tmdbPosterLookupMissSamples'));
  assert.ok(mediaRoutesSource.includes('posterPresentAfterEnrichment'));
}));

results.push(run('media route source records import enrichment metrics for csv and plex paths', () => {
  assert.ok(mediaRoutesSource.includes("recordImportJobEvent('csv_generic', 'queued')"));
  assert.ok(mediaRoutesSource.includes("recordImportJobEvent('csv_calibre', 'queued')"));
  assert.ok(mediaRoutesSource.includes("recordImportJobEvent('csv_delicious', 'queued')"));
  assert.ok(mediaRoutesSource.includes('recordImportEnrichmentSummaryMetrics'));
  assert.ok(mediaRoutesSource.includes('recordPlexEnrichmentMetrics'));
  assert.ok(mediaRoutesSource.includes("recordImportEnrichmentEvent('plex', 'tmdb_poster', 'no_match'"));
}));

results.push(run('provider service sources record tmdb plex and metron request metrics', () => {
  const tmdbSource = require('fs').readFileSync(require.resolve('../services/tmdb'), 'utf8');
  const plexSource = require('fs').readFileSync(require.resolve('../services/plex'), 'utf8');
  const comicsSource = require('fs').readFileSync(require.resolve('../services/comics'), 'utf8');
  assert.ok(tmdbSource.includes("recordProviderRequestEvent('tmdb'"));
  assert.ok(plexSource.includes("recordProviderRequestEvent('plex'"));
  assert.ok(comicsSource.includes("recordProviderRequestEvent('metron'"));
}));

results.push(run('observability dashboard uses ratio and provider outcome panels for low-frequency import signals', () => {
  const importOutcomesPanel = dashboardSpec.panels.find((panel) => panel.id === 10);
  const enrichmentPanel = dashboardSpec.panels.find((panel) => panel.id === 12);
  const deliciousRatioPanel = dashboardSpec.panels.find((panel) => panel.id === 13);
  const trackedRatioPanel = dashboardSpec.panels.find((panel) => panel.id === 14);
  const topProviderErrorsPanel = dashboardSpec.panels.find((panel) => panel.id === 15);
  const providerRequestPanel = dashboardSpec.panels.find((panel) => panel.id === 16);

  assert.ok(importOutcomesPanel);
  assert.ok(enrichmentPanel);
  assert.ok(deliciousRatioPanel);
  assert.ok(trackedRatioPanel);
  assert.ok(topProviderErrorsPanel);
  assert.ok(providerRequestPanel);
  assert.strictEqual(importOutcomesPanel.targets[0].expr, 'sum by (provider, status) (increase(collectz_import_jobs_total[$__range]))');
  assert.strictEqual(enrichmentPanel.targets[0].expr, 'sum by (provider, kind, outcome) (increase(collectz_import_enrichment_total[$__range]))');
  assert.strictEqual(deliciousRatioPanel.targets[0].expr, '100 * ( sum(increase(collectz_import_enrichment_total{provider=\"csv_delicious\",kind=\"pipeline\",outcome=\"no_match\"}[$__range])) / clamp_min(sum(increase(collectz_import_enrichment_total{provider=\"csv_delicious\",kind=\"pipeline\",outcome=~\"enriched|no_match\"}[$__range])), 1) )');
  assert.strictEqual(trackedRatioPanel.targets[0].expr, '100 * ( sum(increase(collectz_import_enrichment_total{provider=\"csv_delicious\",kind=\"pipeline\",outcome=\"no_match\"}[$__range])) / clamp_min(sum(increase(collectz_import_enrichment_total{provider=\"csv_delicious\",kind=\"pipeline\",outcome=~\"enriched|no_match\"}[$__range])), 1) )');
  assert.strictEqual(topProviderErrorsPanel.targets[0].expr, 'topk(10, sum by (provider, operation, outcome) (increase(collectz_provider_requests_total{outcome!=\"success\"}[$__range])))');
  assert.strictEqual(providerRequestPanel.targets[0].expr, 'sum by (provider, operation, outcome) (increase(collectz_provider_requests_total[$__range]))');
}));

results.push(run('alert rules use provider-agnostic import failure alerting', () => {
  assert.ok(alertRulesSource.includes('alert: CollectZImportFailuresByProvider'));
  assert.ok(alertRulesSource.includes('sum by (provider) ('));
  assert.ok(alertRulesSource.includes('increase(collectz_import_jobs_total{status="failed"}[15m])'));
}));

results.push(run('alert rules include Delicious no-match ratio warning', () => {
  assert.ok(alertRulesSource.includes('alert: CollectZDeliciousNoMatchRatioHigh'));
  assert.ok(alertRulesSource.includes('provider="csv_delicious",kind="pipeline",outcome="no_match"'));
  assert.ok(alertRulesSource.includes(') > 0.35'));
  assert.ok(alertRulesSource.includes('>= 100'));
}));

results.push(run('openapi baseline documents key auth admin and media endpoints', () => {
  const spec = JSON.parse(openApiSource);
  assert.strictEqual(spec.info.title, 'collectZ API');
  assert.ok(spec.paths['/api/auth/login']);
  assert.ok(spec.paths['/api/auth/me']);
  assert.ok(spec.paths['/api/auth/personal-access-tokens']);
  assert.ok(spec.paths['/api/auth/service-account-keys']);
  assert.ok(spec.paths['/api/admin/invites']);
  assert.ok(spec.paths['/api/docs']);
  assert.ok(spec.paths['/api/docs/openapi.json']);
  assert.ok(spec.paths['/api/metrics']);
  assert.ok(spec.paths['/api/media']);
  assert.ok(spec.paths['/api/media/import-plex']);
  assert.ok(spec.paths['/api/media/sync-jobs']);
  assert.ok(spec.paths['/api/media/sync-jobs/{id}']);
  assert.ok(spec.paths['/api/media/sync-jobs/{id}/result']);
  assert.ok(spec.components.securitySchemes.cookieSession);
  assert.ok(spec.components.securitySchemes.bearerAuth);
  assert.ok(spec.components.schemas.PersonalAccessTokenRecord);
  assert.ok(spec.components.schemas.ServiceAccountKeyRecord);
  assert.ok(spec.components.schemas.MetricsText);
  assert.ok(spec.components.schemas.QueuedJobResponse);
}));

results.push(run('docs route source enforces admin plus debug and feature-flag gating', () => {
  assert.ok(docsRoutesSource.includes("authenticateToken, requireRole('admin')"));
  assert.ok(docsRoutesSource.includes("isFeatureEnabled('api_docs_enabled', false)"));
  assert.ok(docsRoutesSource.includes('DEBUG_LEVEL >= 1'));
  assert.ok(docsRoutesSource.includes("error.status = 404"));
  assert.ok(docsRoutesSource.includes("router.get('/openapi.json'"));
}));

results.push(run('metrics route source enforces admin plus debug and feature-flag gating', () => {
  assert.ok(metricsRoutesSource.includes('hasValidMetricsScrapeToken'));
  assert.ok(metricsRoutesSource.includes('METRICS_SCRAPE_TOKEN'));
  assert.ok(metricsRoutesSource.includes("requireRole('admin')"));
  assert.ok(metricsRoutesSource.includes("isFeatureEnabled('metrics_enabled', false)"));
  assert.ok(metricsRoutesSource.includes('DEBUG_LEVEL >= 1'));
  assert.ok(metricsRoutesSource.includes("error.status = 404"));
  assert.ok(metricsRoutesSource.includes("text/plain; version=0.0.4"));
}));

results.push(run('metrics route helper accepts dedicated scrape bearer token', () => {
  const metricsRoutePath = require.resolve('../routes/metrics');
  const previousToken = process.env.METRICS_SCRAPE_TOKEN;
  process.env.METRICS_SCRAPE_TOKEN = 'test-metrics-token';
  delete require.cache[metricsRoutePath];
  const metricsRoute = require('../routes/metrics');
  assert.strictEqual(metricsRoute.hasValidMetricsScrapeToken({
    headers: { authorization: 'Bearer test-metrics-token' }
  }), true);
  assert.strictEqual(metricsRoute.hasValidMetricsScrapeToken({
    headers: { authorization: 'Bearer wrong-token' }
  }), false);
  assert.strictEqual(metricsRoute.hasValidMetricsScrapeToken({
    headers: {}
  }), false);
  if (previousToken === undefined) delete process.env.METRICS_SCRAPE_TOKEN;
  else process.env.METRICS_SCRAPE_TOKEN = previousToken;
  delete require.cache[metricsRoutePath];
  require('../routes/metrics');
}));

results.push(run('auth route source exposes admin-only service account key management', () => {
  assert.ok(authRoutesSource.includes("router.get('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("router.post('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("router.delete('/service-account-keys/:id'"));
  assert.ok(authRoutesSource.includes("requireRole('admin')"));
}));

results.push(run('rbac regression source explicitly requests invite token exposure', () => {
  const rbacRegressionSource = require('fs').readFileSync(require.resolve('./rbac-regression-check'), 'utf8');
  assert.ok(rbacRegressionSource.includes('expose_token: true'));
  assert.ok(rbacRegressionSource.includes("assert(Boolean(inviteToken), 'Invite token not returned')"));
  assert.ok(rbacRegressionSource.includes('const fallbackEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || adminEmail;'));
  assert.ok(rbacRegressionSource.includes('const fallbackPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || adminPassword;'));
}));

results.push(run('auth middleware source returns invalid api token for revoked bearer credentials', () => {
  const authSource = require('fs').readFileSync(require.resolve('../middleware/auth'), 'utf8');
  assert.ok(authSource.includes('invalid_or_expired_api_token'));
  assert.ok(authSource.includes('Invalid or expired API token'));
}));

results.push(run('auth.resolveSessionToken prefers cookie session token', () => {
  delete require.cache[authModulePath];
  process.env.ALLOW_SESSION_BEARER_FALLBACK = 'false';
  const { resolveSessionToken } = require('../middleware/auth');
  const out = resolveSessionToken({
    cookies: { session_token: 'cookie-token' },
    headers: { authorization: 'Bearer bearer-token' }
  });
  assert.deepStrictEqual(out, {
    token: 'cookie-token',
    source: 'cookie',
    deniedReason: null
  });
}));

results.push(run('auth.resolveSessionToken blocks bearer fallback by default', () => {
  delete require.cache[authModulePath];
  process.env.ALLOW_SESSION_BEARER_FALLBACK = 'false';
  const { resolveSessionToken } = require('../middleware/auth');
  const out = resolveSessionToken({
    cookies: {},
    headers: { authorization: 'Bearer bearer-token' }
  });
  assert.deepStrictEqual(out, {
    token: null,
    source: 'bearer',
    deniedReason: 'bearer_session_fallback_disabled'
  });
}));

results.push(run('auth.resolveSessionToken allows bearer fallback when explicitly enabled', () => {
  delete require.cache[authModulePath];
  process.env.ALLOW_SESSION_BEARER_FALLBACK = 'true';
  const { resolveSessionToken } = require('../middleware/auth');
  const out = resolveSessionToken({
    cookies: {},
    headers: { authorization: 'Bearer bearer-token' }
  });
  assert.deepStrictEqual(out, {
    token: 'bearer-token',
    source: 'bearer',
    deniedReason: null
  });
  process.env.ALLOW_SESSION_BEARER_FALLBACK = 'false';
}));

results.push(run('csrf.shouldEnforceCsrf skips exempt auth paths even with query strings', () => {
  assert.strictEqual(shouldEnforceCsrf({
    method: 'POST',
    originalUrl: '/api/auth/login?next=/profile',
    cookies: { session_token: 'cookie-token' },
    headers: {},
    get: () => ''
  }), false);
}));

results.push(run('csrf.shouldEnforceCsrf applies to mutating cookie-session requests', () => {
  assert.strictEqual(shouldEnforceCsrf({
    method: 'PATCH',
    originalUrl: '/api/media/1',
    cookies: { session_token: 'cookie-token' },
    headers: {},
    get: () => ''
  }), true);
}));

results.push(run('csrf.shouldEnforceCsrf skips bearer-authenticated API requests', () => {
  assert.strictEqual(shouldEnforceCsrf({
    method: 'PATCH',
    originalUrl: '/api/media/1',
    cookies: { session_token: 'cookie-token' },
    headers: { authorization: 'Bearer test-token' },
    get: (name) => (String(name).toLowerCase() === 'authorization' ? 'Bearer test-token' : '')
  }), false);
}));

results.push(run('pat.hasPersonalAccessTokenScope matches exact scopes and admin wildcard', () => {
  assert.strictEqual(hasPersonalAccessTokenScope(['media:read'], ['media:read']), true);
  assert.strictEqual(hasPersonalAccessTokenScope(['media:read'], ['media:write']), false);
  assert.strictEqual(hasPersonalAccessTokenScope(['admin:*'], ['admin:*']), true);
  assert.strictEqual(hasPersonalAccessTokenScope(['admin:*'], ['media:read']), true);
}));

results.push(run('pat.getRequiredPatScopesForRequest maps media and import routes', () => {
  assert.deepStrictEqual(
    getRequiredPatScopesForRequest({ originalUrl: '/api/auth/me?verbose=1', method: 'GET' }),
    ['profile:read']
  );
  assert.deepStrictEqual(
    getRequiredPatScopesForRequest({ originalUrl: '/api/media?page=1', method: 'GET' }),
    ['media:read']
  );
  assert.deepStrictEqual(
    getRequiredPatScopesForRequest({ originalUrl: '/api/media/123', method: 'PATCH' }),
    ['media:write']
  );
  assert.deepStrictEqual(
    getRequiredPatScopesForRequest({ originalUrl: '/api/media/import-plex', method: 'POST' }),
    ['import:run']
  );
}));

results.push(run('serviceAccount.isServiceAccountPrefixAllowed matches explicit route prefixes', () => {
  assert.strictEqual(
    isServiceAccountPrefixAllowed(['/api/media', '/api/events'], { originalUrl: '/api/media/123', path: '/api/media/123' }),
    true
  );
  assert.strictEqual(
    isServiceAccountPrefixAllowed(['/api/media/import-'], { originalUrl: '/api/media/import-plex?async=1', path: '/api/media/import-plex' }),
    true
  );
  assert.strictEqual(
    isServiceAccountPrefixAllowed(['/api/media'], { originalUrl: '/api/admin/users', path: '/api/admin/users' }),
    false
  );
}));

if (results.some((ok) => !ok)) {
  process.exit(1);
}

console.log(`All unit tests passed (${results.length})`);
