'use strict';

const assert = require('assert');
const { parseCsvText } = require('../services/csv');
const { normalizeBarcodeMatches } = require('../services/barcode');
const { normalizePlexItem, normalizePlexVariant, shouldIncludePlexEntry } = require('../services/plex');
const { wrapTmdbRequestError } = require('../services/tmdb');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIsbn, normalizeIdentifierSet } = require('../services/importIdentifiers');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { compareReleaseVersions, parseReleaseMarkdown } = require('../services/releaseNotes');
const {
  SUPPORT_ACCESS_APPROVAL_TTL_DAYS,
  getSupportAccessExpiryTimestamp,
  getEffectiveSupportAccessStatus,
  isSupportAccessApprovalActive
} = require('../services/supportAccess');
const { extractScopeHints, resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { sanitizeAuditDetails } = require('../services/audit');
const { buildGelfEvent, inferLevel, inferOutcome, truncateJsonValue, readExportConfig, promoteDetailFields, omitNilFields, formatSyslogMessage } = require('../services/logExport');
const { requestIdMiddleware } = require('../middleware/requestId');
const {
  simpleSearchSchema,
  titleAuthorSearchSchema,
  titleArtistSearchSchema,
  upcLookupSchema
} = require('../middleware/validate');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'unit-test-integration-key';
const { buildIntegrationResponse } = require('../services/integrationResponse');
const { buildCompactJobSummary, formatSyncJob } = require('../services/syncJobs');
const metricsModule = require('../services/metrics');
const { shouldEnforceCsrf } = require('../middleware/csrf');
const authModulePath = require.resolve('../middleware/auth');
const authMiddlewareSource = require('fs').readFileSync(authModulePath, 'utf8');
const scopeAccessSource = require('fs').readFileSync(require.resolve('../middleware/scopeAccess'), 'utf8');
const sessionsServiceSource = require('fs').readFileSync(require.resolve('../services/sessions'), 'utf8');
const productEditionConfigSource = require('fs').readFileSync(require.resolve('../config/productEdition'), 'utf8');
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
const serverSource = require('fs').readFileSync(require.resolve('../server'), 'utf8');
const migrationsSource = require('fs').readFileSync(require.resolve('../db/migrations'), 'utf8');
const libraryServiceSource = require('fs').readFileSync(require.resolve('../services/libraries'), 'utf8');
const personalAccessTokenSource = require('fs').readFileSync(require.resolve('../services/personalAccessTokens'), 'utf8');
const serviceAccountKeySource = require('fs').readFileSync(require.resolve('../services/serviceAccountKeys'), 'utf8');
const librariesRoutesSource = require('fs').readFileSync(require.resolve('../routes/libraries'), 'utf8');
const spacesRoutesSource = require('fs').readFileSync(require.resolve('../routes/spaces'), 'utf8');
const adminRoutesSource = require('fs').readFileSync(require.resolve('../routes/admin'), 'utf8');
const integrationsRoutesSource = require('fs').readFileSync(require.resolve('../routes/integrations'), 'utf8');
const supportRoutesSource = require('fs').readFileSync(require.resolve('../routes/support'), 'utf8');
const spacesServiceSource = require('fs').readFileSync(require.resolve('../services/spaces'), 'utf8');
const frontendAppSource = require('fs').readFileSync(require.resolve('../../frontend/src/App'), 'utf8');
const sidebarNavSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/SidebarNav'), 'utf8');
const dashboardContentSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/app/DashboardContent'), 'utf8');
const dashboardRoutingSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/app/dashboardRouting'), 'utf8');
const productEditionFrontendSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/app/productEdition'), 'utf8');
const helpViewSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/HelpView'), 'utf8');
const adminUsersViewSource = require('fs').readFileSync(require.resolve('../../frontend/src/components/AdminUsersView'), 'utf8');
const rootPackageJson = JSON.parse(require('fs').readFileSync(require.resolve('../../package.json'), 'utf8'));
const playwrightConfigSource = require('fs').readFileSync(require.resolve('../../playwright.config'), 'utf8');
const helpCenterBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/help-center.browser.spec'), 'utf8');
const helpAdminSupportBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/help-admin-support.browser.spec'), 'utf8');
const approvedSupportSessionBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/approved-support-session.browser.spec'), 'utf8');
const integrationsBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/integrations.browser.spec'), 'utf8');
const importBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/import.browser.spec'), 'utf8');
const importCsvBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/import-csv.browser.spec'), 'utf8');
const boundaryBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/boundary.browser.spec'), 'utf8');
const eventsCollectiblesBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/events-collectibles.browser.spec'), 'utf8');
const homelabHelpBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/homelab-help.browser.spec'), 'utf8');
const homelabSharedBrowserSpecSource = require('fs').readFileSync(require.resolve('../../tests/playwright/specs/homelab-shared.browser.spec'), 'utf8');
const dockerPublishWorkflowSource = require('fs').readFileSync(require.resolve('../../.github/workflows/docker-publish.yml'), 'utf8');
const browserCapturesWorkflowSource = require('fs').readFileSync(require.resolve('../../.github/workflows/browser-captures.yml'), 'utf8');
const dockerComposeSource = require('fs').readFileSync(require.resolve('../../docker-compose.yml'), 'utf8');
const backendDockerfileSource = require('fs').readFileSync(require.resolve('../../backend/Dockerfile'), 'utf8');
const frontendDockerfileSource = require('fs').readFileSync(require.resolve('../../frontend/Dockerfile'), 'utf8');
const structuredLogSmokeSource = require('fs').readFileSync(require.resolve('../scripts/structured-log-smoke'), 'utf8');
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

results.push(run('barcode.normalizeBarcodeMatches parses book-shaped titles into structured metadata', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: 'Wool - (Silo) by Hugh Howey (Paperback)',
        image: 'https://example.test/wool.jpg',
        upc: '9780358447849',
        brand: 'Mariner Books'
      }
    ]
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].normalizedTitle, 'Wool');
  assert.strictEqual(matches[0].mediaTypeGuess, 'book');
  assert.strictEqual(matches[0].typeDetails.author, 'Hugh Howey');
  assert.strictEqual(matches[0].typeDetails.series, 'Silo');
  assert.strictEqual(matches[0].typeDetails.format, 'Paperback');
  assert.strictEqual(matches[0].typeDetails.isbn, '9780358447849');
}));

results.push(run('barcode.normalizeBarcodeMatches strips packaging noise for search titles', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: '90 [LP] - VINYL',
        ean: '5061010501661'
      }
    ]
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].searchTitle, '90');
}));

results.push(run('barcode.normalizeBarcodeMatches strips combo-pack packaging noise for movie search titles', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: 'New Ghost in the Shell: The New Movie (Blu-ray + DVD)',
        upc: '704400070808'
      }
    ]
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].searchTitle, 'New Ghost in the Shell: The New Movie');
}));

results.push(run('barcode.normalizeBarcodeMatches prefers explicit trailing author suffixes for omnibus-style book titles', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: 'Alpha Flight by John Byrne Omnibus [New Printing] - by John Byrne & Marvel Various (Hardcover)',
        upc: '9781302952716',
        publisher: 'Marvel Universe'
      }
    ]
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].normalizedTitle, 'Alpha Flight by John Byrne Omnibus [New Printing]');
  assert.strictEqual(matches[0].typeDetails.author, 'John Byrne & Marvel Various');
  assert.strictEqual(matches[0].typeDetails.format, 'Hardcover');
  assert.strictEqual(matches[0].typeDetails.publisher, 'Marvel Universe');
}));

results.push(run('barcode.normalizeBarcodeMatches infers TV season box sets and strips season suffix for search', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: 'Dark Angel Season 2',
        upc: '024543079491'
      }
    ]
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].mediaTypeGuess, 'tv_series');
  assert.strictEqual(matches[0].searchTitle, 'Dark Angel');
  assert.strictEqual(matches[0].typeDetails.season_number, 2);
}));

results.push(run('validate.simpleSearchSchema trims title and coerces year', () => {
  const parsed = simpleSearchSchema.parse({ title: '  Dune  ', year: '1984', mediaType: 'movie' });
  assert.deepStrictEqual(parsed, { title: 'Dune', year: 1984, mediaType: 'movie' });
}));

results.push(run('validate.title search schemas reject blank titles', () => {
  assert.throws(() => titleAuthorSearchSchema.parse({ title: '   ' }));
  assert.throws(() => titleArtistSearchSchema.parse({ title: '   ' }));
}));

results.push(run('validate.upcLookupSchema normalizes formatted UPC input and rejects empty unsafe input', () => {
  assert.throws(() => upcLookupSchema.parse({ upc: '......' }));
  const parsed = upcLookupSchema.parse({ upc: '50610 1050\u200B1661' });
  assert.strictEqual(parsed.upc, '5061010501661');
}));

results.push(run('releaseNotes.parseReleaseMarkdown extracts summary and change sections for help center feed', () => {
  const parsed = parseReleaseMarkdown(`# v9.9.9

## Version and date
- Version: \`9.9.9\`
- Date: \`2026-04-01\`

## Summary
Short release summary.

## What Changed
### Guidance
- Added a tabbed help center.
- Added release notes in-app.

### Support
- Refreshed support threads automatically.
`);

  assert.strictEqual(parsed.version, '9.9.9');
  assert.strictEqual(parsed.date, '2026-04-01');
  assert.strictEqual(parsed.summary, 'Short release summary.');
  assert.strictEqual(parsed.details.length, 2);
  assert.strictEqual(parsed.details[0].heading, 'Guidance');
  assert.strictEqual(parsed.details[0].bullets[0], 'Added a tabbed help center.');
}));

results.push(run('releaseNotes.compareReleaseVersions sorts newest versions first', () => {
  const sorted = ['v2.8.6.md', 'v2.9.1.md', 'v2.9.0.md'].sort(compareReleaseVersions);
  assert.deepStrictEqual(sorted, ['v2.9.1.md', 'v2.9.0.md', 'v2.8.6.md']);
}));

results.push(run('supportAccess derives active expiry windows and expired state', () => {
  const approvedAt = '2026-04-01T00:00:00.000Z';
  const expiresAt = getSupportAccessExpiryTimestamp(approvedAt);
  assert.ok(expiresAt);
  assert.strictEqual(
    getEffectiveSupportAccessStatus({
      status: 'approved',
      approvedAt,
      requestStatus: 'open',
      now: new Date('2026-04-05T00:00:00.000Z')
    }),
    'approved'
  );
  assert.strictEqual(
    getEffectiveSupportAccessStatus({
      status: 'approved',
      approvedAt,
      requestStatus: 'open',
      now: new Date(`2026-04-${String(1 + SUPPORT_ACCESS_APPROVAL_TTL_DAYS + 1).padStart(2, '0')}T00:00:00.000Z`)
    }),
    'expired'
  );
  assert.strictEqual(
    getEffectiveSupportAccessStatus({
      status: 'approved',
      approvedAt,
      requestStatus: 'closed',
      now: new Date('2026-04-02T00:00:00.000Z')
    }),
    'expired'
  );
  assert.strictEqual(
    isSupportAccessApprovalActive({
      status: 'approved',
      approvedAt,
      requestStatus: 'open',
      now: new Date('2026-04-05T00:00:00.000Z')
    }),
    true
  );
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

results.push(run('admin route source includes guided space onboarding endpoint', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.post('/spaces/create-with-onboarding'"));
  assert.ok(adminRoutesSource.includes('createInitialSpaceInvite'));
  assert.ok(adminRoutesSource.includes('invite_results'));
}));

results.push(run('admin route source includes platform-safe space detail and roster endpoints', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.get('/spaces/:id'"));
  assert.ok(adminRoutesSource.includes("platformRouter.post('/spaces/:id/members'"));
  assert.ok(adminRoutesSource.includes("platformRouter.post('/spaces/:id/invites'"));
  assert.ok(adminRoutesSource.includes("platformRouter.patch('/spaces/:id/invites/:inviteId/revoke'"));
}));

results.push(run('auth route source includes explicit support session endpoints', () => {
  assert.ok(authRoutesSource.includes("platformRouter.post('/support-session/start'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/support-session'"));
  assert.ok(authRoutesSource.includes("requireRole('admin', 'support_admin')"));
  assert.ok(authRoutesSource.includes('auth.support_session.started'));
  assert.ok(authRoutesSource.includes('auth.support_session.ended'));
  assert.ok(authRoutesSource.includes('isSupportAccessApprovalActive'));
  assert.ok(authRoutesSource.includes('getSupportRequestSessionSummary'));
  assert.ok(authRoutesSource.includes('supportRequestKey'));
  assert.ok(authRoutesSource.includes('support_request_id'));
  assert.ok(authRoutesSource.includes('expired, or no longer valid'));
  assert.ok(authRoutesSource.includes('request_subject'));
  assert.ok(authRoutesSource.includes('requester_name'));
  assert.ok(authRoutesSource.includes('library_name'));
  assert.ok(authRoutesSource.includes('active_space_id: null'));
  assert.ok(authRoutesSource.includes('support_session: null'));
  assert.ok(authRoutesSource.includes('stripHomelabSpaceContext('));
  assert.ok(authRoutesSource.includes('stripHomelabSpaceContextFromUser('));
}));

results.push(run('migrations source includes support role and help foundation schema updates', () => {
  assert.ok(migrationsSource.includes('version: 48'));
  assert.ok(migrationsSource.includes('version: 49'));
  assert.ok(migrationsSource.includes('version: 50'));
  assert.ok(migrationsSource.includes('version: 51'));
  assert.ok(migrationsSource.includes('version: 52'));
  assert.ok(migrationsSource.includes('support_space_id'));
  assert.ok(migrationsSource.includes('support_request_id'));
  assert.ok(migrationsSource.includes('support_previous_library_id'));
  assert.ok(migrationsSource.includes('artist VARCHAR(255)'));
  assert.ok(migrationsSource.includes('ADD COLUMN IF NOT EXISTS image_path TEXT'));
  assert.ok(migrationsSource.includes('support_requests'));
  assert.ok(migrationsSource.includes("'support_admin'"));
  assert.ok(migrationsSource.includes('classification VARCHAR(30)'));
  assert.ok(migrationsSource.includes('internal_notes TEXT'));
  assert.ok(migrationsSource.includes('is_internal BOOLEAN'));
  assert.ok(migrationsSource.includes('support_access_status VARCHAR(20)'));
}));

results.push(run('frontend app source includes support session banner and admin trigger plumbing', () => {
  assert.ok(frontendAppSource.includes('Support Session'));
  assert.ok(frontendAppSource.includes('/auth/support-session/start'));
  assert.ok(frontendAppSource.includes('request_id: requestId || undefined'));
  assert.ok(dashboardContentSource.includes('onStartSupportSession'));
}));

results.push(run('support route source includes request creation, releases feed, replies, and staff summary endpoints', () => {
  assert.ok(supportRoutesSource.includes("sharedRouter.get('/releases'"));
  assert.ok(supportRoutesSource.includes("platformRouter.get('/requests'"));
  assert.ok(supportRoutesSource.includes("platformRouter.post('/requests'"));
  assert.ok(supportRoutesSource.includes("platformRouter.post('/requests/:id/messages'"));
  assert.ok(supportRoutesSource.includes("platformRouter.patch('/requests/:id/status'"));
  assert.ok(supportRoutesSource.includes("platformRouter.patch('/requests/:id/access'"));
  assert.ok(supportRoutesSource.includes("platformRouter.patch('/requests/:id/triage'"));
  assert.ok(supportRoutesSource.includes("platformRouter.get('/staff/summary'"));
  assert.ok(supportRoutesSource.includes('loadReleaseNotesFeed'));
  assert.ok(supportRoutesSource.includes('support.request.access.updated'));
  assert.ok(supportRoutesSource.includes('normalizeSupportQueueFilter'));
  assert.ok(supportRoutesSource.includes('normalizeSupportClassificationFilter'));
  assert.ok(supportRoutesSource.includes('req.query.q'));
  assert.ok(supportRoutesSource.includes('support_access_expires_at'));
  assert.ok(supportRoutesSource.includes('buildSupportAccessClearedOnCloseMessage'));
  assert.ok(supportRoutesSource.includes('formatSupportTimelineEvent'));
  assert.ok(supportRoutesSource.includes('buildDerivedExpiredSupportAccessEvent'));
  assert.ok(supportRoutesSource.includes('timelineResult'));
  assert.ok(supportRoutesSource.includes('normalizeTrackedWorkLink'));
  assert.ok(supportRoutesSource.includes('Linked engineering issue is now #'));
}));

results.push(run('frontend source includes tabbed help center and support inbox surfaces for 2.9.1 foundation work', () => {
  assert.ok(dashboardContentSource.includes("case 'help'"));
  assert.ok(dashboardContentSource.includes("case 'support-inbox'"));
  assert.ok(frontendAppSource.includes('getSafeDashboardTab'));
  assert.ok(adminUsersViewSource.includes('support_admin'));
  assert.ok(dashboardContentSource.includes('<HelpView'));
  assert.ok(helpViewSource.includes('/support/releases'));
  assert.ok(helpViewSource.includes('Guidance'));
  assert.ok(helpViewSource.includes('Recent Releases'));
  assert.ok(productEditionFrontendSource.includes('Help Admin'));
  assert.ok(helpViewSource.includes('Latest saved internal note'));
  assert.ok(helpViewSource.includes('New Internal Note'));
  assert.ok(helpViewSource.includes('Approve Support Access'));
  assert.ok(helpViewSource.includes('Revoke Support Access'));
  assert.ok(helpViewSource.includes('Start Approved Support Session'));
  assert.ok(helpViewSource.includes('Search queue'));
  assert.ok(helpViewSource.includes('All classes'));
  assert.ok(helpViewSource.includes('Completed'));
  assert.ok(helpViewSource.includes('Support access expired'));
  assert.ok(helpViewSource.includes('Expires '));
  assert.ok(helpViewSource.includes('Active session evidence'));
  assert.ok(helpViewSource.includes('This thread is the approval context'));
  assert.ok(helpViewSource.includes('History timeline'));
  assert.ok(helpViewSource.includes('Lifecycle, approval, and support-session events'));
  assert.ok(helpViewSource.includes('TimelineItem'));
  assert.ok(helpViewSource.includes('Linked engineering work'));
  assert.ok(helpViewSource.includes('Tracked work'));
  assert.ok(helpViewSource.includes('effectiveRepoIssueUrl'));
  assert.ok(frontendAppSource.includes('supportBadgeCount'));
  assert.ok(frontendAppSource.includes('Requester:'));
  assert.ok(frontendAppSource.includes('Case:'));
  assert.ok(helpViewSource.includes('Reply to Support'));
}));

results.push(run('edition boundary source includes backend-owned homelab shell and help surface rules', () => {
  assert.ok(productEditionConfigSource.includes('process.env.APP_EDITION'));
  assert.ok(productEditionConfigSource.includes("'platform'"));
  assert.ok(productEditionConfigSource.includes("'homelab'"));
  assert.ok(authRoutesSource.includes('product_edition: getProductEdition()'));
  assert.ok(openApiSource.includes('"product_edition"'));
  assert.ok(productEditionFrontendSource.includes('getHelpTabDefinitions'));
  assert.ok(productEditionFrontendSource.includes('getHelpSurfaceTitle'));
  assert.ok(productEditionFrontendSource.includes('getAllowedDashboardTabs'));
  assert.ok(productEditionFrontendSource.includes("return 'admin-settings'"));
  assert.ok(helpViewSource.includes('A lightweight home for self-serve guidance and recent release notes for homelab users.'));
  assert.ok(frontendAppSource.includes('getSafeDashboardTab'));
  assert.ok(sidebarNavSource.includes('getAllowedDashboardTabs'));
  assert.ok(sidebarNavSource.includes('showGlobalGroup'));
  assert.ok(dockerComposeSource.includes('APP_EDITION: ${APP_EDITION:-platform}'));
  assert.ok(serverSource.includes('const HOMELAB_EDITION = isHomelabEdition();'));
  assert.ok(serverSource.includes("app.use('/api/auth', authPlatformRouter);"));
  assert.ok(serverSource.includes("app.use('/api/support', supportSharedRouter);"));
  assert.ok(serverSource.includes("app.use('/api/admin', adminCommonRouter);"));
  assert.ok(serverSource.includes("app.use('/api/docs', docsRouter);"));
  assert.ok(serverSource.includes("app.use('/api/metrics', metricsRouter);"));
  assert.ok(serverSource.includes("app.use('/api/support', supportPlatformRouter);"));
  assert.ok(serverSource.includes("app.use('/api', spacesRouter);"));
  assert.ok(serverSource.includes("app.use('/api/admin', adminPlatformRouter);"));
  assert.ok(authRoutesSource.includes('authPlatformRouter'));
  assert.ok(authRoutesSource.includes("platformRouter.post('/support-session/start'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/support-session'"));
  assert.ok(adminRoutesSource.includes('adminCommonRouter'));
  assert.ok(adminRoutesSource.includes('adminPlatformRouter'));
  assert.ok(supportRoutesSource.includes('supportSharedRouter'));
  assert.ok(supportRoutesSource.includes('supportPlatformRouter'));
  assert.ok(homelabHelpBrowserSpecSource.includes('product_edition'));
  assert.ok(homelabHelpBrowserSpecSource.includes("name: 'Help Admin'"));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-spaces'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-users'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-activity'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=space-manage'));
  assert.ok(homelabHelpBrowserSpecSource.includes("toHaveURL(/tab=help/)"));
  assert.ok(homelabHelpBrowserSpecSource.includes("toHaveURL(/tab=admin-settings/)"));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/media/lookup-upc'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-settings'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=barcode'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/admin/settings/general'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/admin/settings/integrations'));
}));

results.push(run('repo includes 2.9.4 Playwright browser regression foundation harness', () => {
  assert.ok(rootPackageJson.scripts['test:browser']);
  assert.ok(rootPackageJson.scripts['test:browser:capture']);
  assert.ok(rootPackageJson.devDependencies['@playwright/test']);
  assert.ok(playwrightConfigSource.includes("http://127.0.0.1:3000"));
  assert.ok(playwrightConfigSource.includes("trace: 'retain-on-failure'"));
  assert.ok(playwrightConfigSource.includes("screenshot: 'only-on-failure'"));
  assert.ok(playwrightConfigSource.includes("video: 'retain-on-failure'"));
  assert.ok(playwrightConfigSource.includes('x-playwright-e2e-bypass'));
  assert.ok(playwrightConfigSource.includes('tmp'));
  assert.ok(serverSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN'));
  assert.ok(serverSource.includes('x-playwright-e2e-bypass'));
  assert.ok(serverSource.includes('playwright_e2e_bypass'));
  assert.ok(sessionsServiceSource.includes('s.support_request_id'));
  assert.ok(authMiddlewareSource.includes('supportRequestId: sessionUser.support_request_id'));
  assert.ok(scopeAccessSource.includes("role === 'support_admin'"));
  assert.ok(scopeAccessSource.includes('allowSupportSessionLibraryHints'));
  assert.ok(dockerComposeSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN: ${PLAYWRIGHT_E2E_BYPASS_TOKEN:-}'));
  assert.ok(dockerPublishWorkflowSource.includes('browser-regression:'));
  assert.ok(dockerPublishWorkflowSource.includes('npx playwright install --with-deps chromium'));
  assert.ok(dockerPublishWorkflowSource.includes('npm run test:browser'));
  assert.ok(dockerPublishWorkflowSource.includes('playwright-browser-regression'));
  assert.ok(dockerPublishWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(!dockerPublishWorkflowSource.includes('collectz-playwright-ci'));
  assert.ok(browserCapturesWorkflowSource.includes('workflow_dispatch:'));
  assert.ok(browserCapturesWorkflowSource.includes('npm run test:browser:capture'));
  assert.ok(browserCapturesWorkflowSource.includes('playwright-browser-captures'));
  assert.ok(browserCapturesWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(helpCenterBrowserSpecSource.includes('Help Center'));
  assert.ok(helpCenterBrowserSpecSource.includes('Create help request'));
  assert.ok(helpAdminSupportBrowserSpecSource.includes('Help Admin'));
  assert.ok(helpAdminSupportBrowserSpecSource.includes('Close Case'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('Start Approved Support Session'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('My Space'));
  assert.ok(integrationsBrowserSpecSource.includes("saveSection(page, 'BARCODE')"));
  assert.ok(integrationsBrowserSpecSource.includes("saveSection(page, 'GAMES')"));
  assert.ok(integrationsBrowserSpecSource.includes('integrations-tabs-layout.png'));
  assert.ok(integrationsBrowserSpecSource.includes('Metrics Export'));
  assert.ok(importBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(importBrowserSpecSource.includes('/api/media/lookup-upc'));
  assert.ok(importBrowserSpecSource.includes('Added "'));
  assert.ok(importBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(importCsvBrowserSpecSource.includes('/api/media/import-csv'));
  assert.ok(importCsvBrowserSpecSource.includes('CSV import queued'));
  assert.ok(importCsvBrowserSpecSource.includes('waitForSyncJob('));
  assert.ok(importCsvBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(boundaryBrowserSpecSource.includes('support_admin'));
  assert.ok(boundaryBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=barcode'));
  assert.ok(boundaryBrowserSpecSource.includes("toHaveURL(/tab=help/)"));
  assert.ok(boundaryBrowserSpecSource.includes('/dashboard?tab=admin-spaces'));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes("getByRole('button', { name: 'Events' })"));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes("getByRole('button', { name: 'Collectibles' })"));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes('Add Event'));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes('Add Collectible'));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes('Linked Event'));
  assert.ok(dashboardRoutingSource.includes("'logs'"));
  assert.ok(dashboardRoutingSource.includes("'metrics'"));
  assert.ok(backendDockerfileSource.includes('COPY package*.json ./'));
  assert.ok(frontendDockerfileSource.includes('COPY package*.json ./'));
  assert.ok(!backendDockerfileSource.includes('@playwright/test'));
  assert.ok(!frontendDockerfileSource.includes('@playwright/test'));
}));

results.push(run('integrations route source keeps admin integration save query aligned with full column set', () => {
  assert.ok(integrationsRoutesSource.includes('cwa_timeout_ms'));
  assert.ok(integrationsRoutesSource.includes('$48,$49,$50,$51,$52'));
  assert.ok(integrationsRoutesSource.includes('$14,$15,$16,$17,$18,$19,$20::jsonb'));
}));

results.push(run('media route source hardens image upload handlers', () => {
  assert.ok(mediaRoutesSource.includes('const memoryImageUpload = multer('));
  assert.ok(mediaRoutesSource.includes("router.post('/upload-cover', memoryImageUpload.single('cover')"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/upload-signing-proof', memoryImageUpload.single('proof')"));
  assert.ok(mediaRoutesSource.includes('sanitizeUploadFilename'));
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

results.push(run('migration source includes first-class spaces activation', () => {
  assert.ok(migrationsSource.includes("description: 'Activate first-class spaces and backfill default space memberships'"));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS spaces'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS space_memberships'));
  assert.ok(migrationsSource.includes('ALTER COLUMN space_id SET NOT NULL'));
  assert.ok(migrationsSource.includes("description: 'Reconcile legacy default-space installs into isolated personal spaces'"));
  assert.ok(migrationsSource.includes("'legacy-user-' || user_row.id"));
  assert.ok(migrationsSource.includes('DELETE FROM space_memberships'));
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

results.push(run('logExport.inferOutcome classifies failed and denied actions', () => {
  assert.strictEqual(inferOutcome('request.failed', {}), 'failed');
  assert.strictEqual(inferOutcome('auth.access.denied', {}), 'denied');
  assert.strictEqual(inferOutcome('library.create', {}), 'success');
}));

results.push(run('logExport.inferLevel maps request failures to warning/error severities', () => {
  assert.strictEqual(inferLevel('request.failed', { status: 403 }), 4);
  assert.strictEqual(inferLevel('request.failed', { status: 500 }), 3);
  assert.strictEqual(inferLevel('library.create', {}), 6);
}));

results.push(run('logExport.truncateJsonValue bounds oversized detail payloads', () => {
  const oversized = { payload: 'x'.repeat(30000) };
  const out = truncateJsonValue(oversized, 1024);
  assert.strictEqual(out.truncated, true);
  assert.ok(out.originalBytes > 1024);
  assert.ok(typeof out.preview === 'string');
}));

results.push(run('logExport.buildGelfEvent maps audit context into GELF fields', () => {
  const event = buildGelfEvent({
    req: {
      requestId: 'req-123',
      method: 'POST',
      originalUrl: '/api/libraries',
      route: { path: '/libraries' },
      headers: { 'x-request-id': 'req-123' }
    },
    action: 'library.create',
    entityType: 'library',
    entityId: 14,
    details: { status: 201, durationMs: 18, name: 'Movies' },
    ipAddress: '127.0.0.1',
    userId: 7
  });
  assert.strictEqual(event.version, '1.1');
  assert.strictEqual(event.short_message, 'library.create');
  assert.strictEqual(event._entity_type, 'library');
  assert.strictEqual(event._entity_id, 14);
  assert.strictEqual(event._user_id, 7);
  assert.strictEqual(event._route, '/libraries');
  assert.strictEqual(event._method, 'POST');
  assert.strictEqual(event._status, 201);
  assert.strictEqual(event._duration_ms, 18);
  assert.strictEqual(event._request_id, 'req-123');
  assert.strictEqual(event._outcome, 'success');
}));

results.push(run('requestId middleware preserves incoming request id and sets response header', () => {
  const req = { headers: { 'x-request-id': 'req-incoming' } };
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; } };
  let nextCalled = false;
  requestIdMiddleware(req, res, () => { nextCalled = true; });
  assert.strictEqual(req.requestId, 'req-incoming');
  assert.strictEqual(req.headers['x-request-id'], 'req-incoming');
  assert.strictEqual(headers['X-Request-Id'], 'req-incoming');
  assert.strictEqual(nextCalled, true);
}));

results.push(run('requestId middleware generates request id when absent', () => {
  const req = { headers: {} };
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; } };
  requestIdMiddleware(req, res, () => {});
  assert.ok(typeof req.requestId === 'string' && req.requestId.length >= 16);
  assert.strictEqual(req.headers['x-request-id'], req.requestId);
  assert.strictEqual(headers['X-Request-Id'], req.requestId);
}));

results.push(run('logExport.promoteDetailFields promotes high-value scalar detail keys', () => {
  const promoted = promoteDetailFields({
    key: 'events_enabled',
    previousEnabled: true,
    nextEnabled: false,
    envOverride: null,
    nested: { ignored: true },
    list: [1, 2, 3]
  });
  assert.deepStrictEqual(promoted, {
    _detail_key: 'events_enabled',
    _detail_previous_enabled: 'true',
    _detail_next_enabled: 'false'
  });
}));

results.push(run('logExport.omitNilFields removes null and undefined GELF fields', () => {
  assert.deepStrictEqual(omitNilFields({
    version: '1.1',
    _entity_id: null,
    _request_id: undefined,
    _action: 'debug.test',
    _detail_key: 'manual-test'
  }), {
    version: '1.1',
    _action: 'debug.test',
    _detail_key: 'manual-test'
  });
}));

results.push(run('logExport.buildGelfEvent promotes whitelisted detail keys into GELF fields', () => {
  const event = buildGelfEvent({
    action: 'admin.feature_flag.update',
    entityType: 'feature_flag',
    details: {
      key: 'external_log_export_enabled',
      previousEnabled: false,
      nextEnabled: true,
      envOverride: null
    },
    userId: 1
  });
  assert.strictEqual(event._detail_key, 'external_log_export_enabled');
  assert.strictEqual(event._detail_previous_enabled, 'false');
  assert.strictEqual(event._detail_next_enabled, 'true');
  assert.ok(!Object.prototype.hasOwnProperty.call(event, '_detail_env_override'));
  assert.ok(!Object.prototype.hasOwnProperty.call(event, '_entity_id'));
  assert.ok(!Object.prototype.hasOwnProperty.call(event, '_request_id'));
  assert.deepStrictEqual(event._details, {
    key: 'external_log_export_enabled',
    previousEnabled: false,
    nextEnabled: true,
    envOverride: null
  });
}));

results.push(run('logExport.readExportConfig normalizes invalid backend to off', () => {
  const previous = process.env.LOG_EXPORT_BACKEND;
  process.env.LOG_EXPORT_BACKEND = 'unknown-backend';
  const config = readExportConfig();
  assert.strictEqual(config.backend, 'off');
  process.env.LOG_EXPORT_BACKEND = previous;
}));

results.push(run('logExport.readExportConfig defaults syslog backends to port 514', () => {
  const previousBackend = process.env.LOG_EXPORT_BACKEND;
  const previousPort = process.env.LOG_EXPORT_PORT;
  process.env.LOG_EXPORT_BACKEND = 'syslog_tcp';
  delete process.env.LOG_EXPORT_PORT;
  const config = readExportConfig();
  assert.strictEqual(config.backend, 'syslog_tcp');
  assert.strictEqual(config.port, 514);
  process.env.LOG_EXPORT_BACKEND = previousBackend;
  process.env.LOG_EXPORT_PORT = previousPort;
}));

results.push(run('logExport.formatSyslogMessage builds RFC5424 line with structured data and JSON body', () => {
  const line = formatSyslogMessage({
    timestamp: 1773496025.589,
    host: 'collectz-backend',
    short_message: 'admin.feature_flag.update',
    _service: 'backend',
    _action: 'admin.feature_flag.update',
    _entity_type: 'feature_flag',
    _user_id: 1,
    _request_id: 'req-123',
    _route: '/feature-flags/:key',
    _method: 'PATCH',
    _outcome: 'success',
    _detail_key: 'events_enabled',
    _details: { key: 'events_enabled', previousEnabled: false, nextEnabled: true }
  });
  assert.ok(line.startsWith('<14>1 2026-03-14T13:47:05.589Z collectz-backend backend - admin.feature_flag.update '));
  assert.ok(line.includes('[collectz@41058 '));
  assert.ok(line.includes('request_id="req-123"'));
  assert.ok(line.includes('detail_key="events_enabled"'));
  assert.ok(line.endsWith('"_details":{"key":"events_enabled","previousEnabled":false,"nextEnabled":true}}'));
}));

results.push(run('integrations.buildIntegrationResponse masks secrets and exposes only set flags', () => {
  const response = buildIntegrationResponse({
    barcodePreset: 'upcitemdb',
    barcodeProvider: 'upcitemdb',
    barcodeApiUrl: 'https://barcode.example',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc',
    barcodeApiKey: 'barcode-secret',
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
    diagnosticsFlagged: 7,
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
    diagnosticsFlagged: 7,
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

results.push(run('media route source replaces import review queue with debug diagnostic logging', () => {
  assert.ok(!mediaRoutesSource.includes('/import-reviews'));
  assert.ok(mediaRoutesSource.includes('media.import.diagnostic.flagged'));
  assert.ok(mediaRoutesSource.includes('diagnostic_flagged'));
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
  assert.ok(spec.paths['/api/support/requests']);
  assert.ok(spec.paths['/api/support/releases']);
  assert.ok(spec.paths['/api/support/requests/{id}']);
  assert.ok(spec.paths['/api/support/requests/{id}/messages']);
  assert.ok(spec.paths['/api/support/requests/{id}/status']);
  assert.ok(spec.paths['/api/support/requests/{id}/triage']);
  assert.ok(spec.paths['/api/support/staff/summary']);
  assert.ok(spec.paths['/api/auth/personal-access-tokens']);
  assert.ok(spec.paths['/api/auth/service-account-keys']);
  assert.ok(!spec.paths['/api/admin/invites']);
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
  assert.ok(spec.components.schemas.SupportRequestTriageUpdateRequest);
  assert.ok(spec.components.schemas.SupportRequestMutationResponse);
  assert.ok(spec.components.schemas.SupportReleaseFeedResponse);
}));

results.push(run('docs route source enforces admin plus debug gating', () => {
  assert.ok(docsRoutesSource.includes("authenticateToken, requireRole('admin')"));
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
    getRequiredPatScopesForRequest({ originalUrl: '/api/auth/scope', method: 'GET' }),
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

results.push(run('audit source wires structured log export behind activity logging', () => {
  const auditSource = require('fs').readFileSync(require.resolve('../services/audit'), 'utf8');
  assert.ok(auditSource.includes('buildGelfEvent'));
  assert.ok(auditSource.includes('maybeExportActivityLog'));
}));

results.push(run('audit middleware source records path and error summary for request outcome entries', () => {
  const auditMiddlewareSource = require('fs').readFileSync(require.resolve('../middleware/audit'), 'utf8');
  assert.ok(auditMiddlewareSource.includes("path: req.originalUrl?.split('?')[0]"));
  assert.ok(auditMiddlewareSource.includes('errorSummary'));
  assert.ok(auditMiddlewareSource.includes('response: errorSummary'));
}));

results.push(run('logout route resolves session user before revoking token for audit attribution', () => {
  const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
  assert.ok(authRoutesSource.includes('getSessionUserByToken'));
  assert.ok(authRoutesSource.includes("await logActivity(auditReq, 'auth.user.logout'"));
}));

results.push(run('auth routes attribute register and login audit events to the acting user id', () => {
  const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
  assert.ok(authRoutesSource.includes("await logActivity({ ...req, user: { id: result.rows[0].id"));
  assert.ok(authRoutesSource.includes("await logActivity({ ...req, user: { id: user.id"));
}));

results.push(run('auth routes expose explicit scope bootstrap and selection endpoints', () => {
  assert.ok(authRoutesSource.includes("router.get('/scope', authenticateToken"));
  assert.ok(authRoutesSource.includes("router.post('/scope', authenticateToken, requireSessionAuth"));
  assert.ok(authRoutesSource.includes("await logActivity(req, 'auth.scope.select'"));
}));

results.push(run('spaces routes expose core spaces and memberships endpoints', () => {
  assert.ok(spacesRoutesSource.includes("router.get('/spaces'"));
  assert.ok(spacesRoutesSource.includes("router.post('/spaces'"));
  assert.ok(spacesRoutesSource.includes("router.patch('/spaces/:id'"));
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/select'"));
  assert.ok(spacesRoutesSource.includes("router.get('/spaces/:id/members'"));
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/:id/members'"));
  assert.ok(spacesRoutesSource.includes("router.patch('/spaces/:id/members/:memberId'"));
  assert.ok(spacesRoutesSource.includes("router.delete('/spaces/:id/members/:memberId'"));
  assert.ok(spacesRoutesSource.includes("router.get('/spaces/:id/invites'"));
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/:id/invites'"));
  assert.ok(spacesRoutesSource.includes("router.patch('/spaces/:id/invites/:inviteId/revoke'"));
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/:id/members/:memberId/transfer-new-space'"));
}));

results.push(run('admin routes expose platform space control-plane endpoints', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.get('/spaces'"));
  assert.ok(adminRoutesSource.includes("platformRouter.post('/spaces'"));
  assert.ok(adminRoutesSource.includes("platformRouter.patch('/spaces/:id/owner'"));
  assert.ok(adminRoutesSource.includes("platformRouter.patch('/spaces/:id/archive'"));
  assert.ok(adminRoutesSource.includes("platformRouter.delete('/spaces/:id'"));
  assert.ok(adminRoutesSource.includes("platformRouter.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(adminRoutesSource.includes("COUNT(*)::int AS membership_count"));
  assert.ok(!adminRoutesSource.includes('contributionScore'));
}));

results.push(run('library service source ensures default scope before returning default library', () => {
  assert.ok(libraryServiceSource.includes('async function ensureUserDefaultScope'));
  assert.ok(libraryServiceSource.includes('ensureDefaultSpaceForClient'));
  assert.ok(libraryServiceSource.includes('SET active_space_id = $2,'));
  assert.ok(libraryServiceSource.includes('async function syncLibraryMembershipsForSpaceUser'));
  assert.ok(libraryServiceSource.includes('FROM users u'));
  assert.ok(libraryServiceSource.includes('async function moveOwnedLibrariesToSpace'));
  assert.ok(libraryServiceSource.includes('async function canUserAccessSpace'));
  assert.ok(libraryServiceSource.includes('async function getAccessibleLibraryRow'));
}));

results.push(run('spaces service source distinguishes global admin from space membership roles', () => {
  assert.ok(spacesServiceSource.includes("const SPACE_MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'];"));
  assert.ok(spacesServiceSource.includes("function isGlobalAdmin(userRole)"));
  assert.ok(spacesServiceSource.includes("function canAssignSpaceRole"));
  assert.ok(spacesServiceSource.includes('FROM space_memberships sm'));
  assert.ok(!spacesServiceSource.includes("COALESCE(sm.role, CASE WHEN s.created_by = $1 THEN 'owner' END, 'admin') AS membership_role"));
  assert.ok(!spacesServiceSource.includes('return isGlobalAdmin(userRole) || SPACE_MANAGE_ROLES.includes(membershipRole);'));
  assert.ok(!spacesServiceSource.includes('if (isGlobalAdmin(actorUserRole)) return true;'));
}));

results.push(run('request origin helper supports configured or forwarded host values for invite URLs', () => {
  const requestOriginSource = require('fs').readFileSync(require.resolve('../services/requestOrigin'), 'utf8');
  assert.ok(requestOriginSource.includes('process.env.APP_PUBLIC_URL'));
  assert.ok(requestOriginSource.includes("req.get('origin')"));
  assert.ok(requestOriginSource.includes("req.get('x-forwarded-host')"));
}));

results.push(run('library routes preserve active space when replacing archived or deleted libraries', () => {
  assert.ok(librariesRoutesSource.includes('SELECT lm.library_id, l.space_id'));
  assert.ok(librariesRoutesSource.includes('SET active_space_id = $2,'));
}));

results.push(run('homelab edition helpers strip surfaced space context while preserving shared library flows', () => {
  const productEditionSource = require('fs').readFileSync(require.resolve('../config/productEdition'), 'utf8');
  assert.ok(productEditionSource.includes('function stripHomelabSpaceContext('));
  assert.ok(productEditionSource.includes('active_space_id: null'));
  assert.ok(productEditionSource.includes('spaces: []'));
  assert.ok(productEditionSource.includes('function stripHomelabSpaceContextFromUser('));
  assert.ok(librariesRoutesSource.includes('stripHomelabSpaceContext({'));
}));

results.push(run('library routes only allow admin scope hints after phase2 hardening', () => {
  assert.ok(librariesRoutesSource.includes("router.use('/libraries', authenticateToken);"));
  assert.ok(librariesRoutesSource.includes("router.use('/libraries', enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(librariesRoutesSource.includes("router.post('/libraries/select', requireSessionAuth"));
  assert.ok(librariesRoutesSource.includes("enforceScopeAccess({ allowedHintRoles: ['admin'] })"));
  assert.ok(librariesRoutesSource.includes('SELECT user_id'));
  assert.ok(librariesRoutesSource.includes('syncLibraryMembershipsForSpaceUser'));
}));

results.push(run('library transfer source revokes previous owner membership on ownership change', () => {
  assert.ok(librariesRoutesSource.includes('DELETE FROM library_memberships'));
  assert.ok(librariesRoutesSource.includes('Number(target.created_by || 0) !== newOwnerUserId'));
}));

results.push(run('spaces select route is session-auth only for active scope mutation', () => {
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/select', requireSessionAuth"));
}));

results.push(run('auth register flow applies scoped invite role before ensuring default scope', () => {
  assert.ok(authRoutesSource.includes("claimedInvite.space_role || 'member'"));
  assert.ok(authRoutesSource.includes('syncLibraryMembershipsForSpaceUser'));
}));

results.push(run('scope access source enforces explicit space membership for non-admin space-only access', () => {
  const scopeAccessSource = require('fs').readFileSync(require.resolve('../middleware/scopeAccess'), 'utf8');
  assert.ok(scopeAccessSource.includes('FROM space_memberships'));
  assert.ok(scopeAccessSource.includes('space_membership_required'));
  assert.ok(scopeAccessSource.includes('admin_support_session_required'));
}));

results.push(run('token auth sources derive fallback scope from accessible libraries', () => {
  assert.ok(personalAccessTokenSource.includes('COALESCE(u.active_space_id, fallback_library.space_id)'));
  assert.ok(serviceAccountKeySource.includes('COALESCE(owner.active_space_id, fallback_library.space_id)'));
}));

results.push(run('frontend syncs active space alongside active library context', () => {
  assert.ok(frontendAppSource.includes('const nextActiveSpaceId = Number(payload?.active_space_id || 0) || null;'));
  assert.ok(frontendAppSource.includes("active_space_id: nextActiveSpaceId, active_library_id: nextActiveLibraryId"));
}));

results.push(run('dashboard content exposes dedicated admin spaces control plane tab', () => {
  assert.ok(dashboardContentSource.includes("case 'admin-spaces'"));
  assert.ok(dashboardContentSource.includes('AdminSpacesView'));
}));

results.push(run('frontend import flow no longer mounts standalone Import Review view', () => {
  assert.ok(!dashboardContentSource.includes('ImportReviewView'));
  assert.ok(!frontendAppSource.includes('const importReviewEnabled'));
}));

results.push(run('admin users view stays platform-only without invitation management tab', () => {
  assert.ok(adminUsersViewSource.includes('Platform-level member administration.'));
  assert.ok(!adminUsersViewSource.includes("activeTab === 'invitations'"));
  assert.ok(!adminUsersViewSource.includes("/admin/invites"));
  assert.ok(adminUsersViewSource.includes('Space memberships'));
  assert.ok(adminUsersViewSource.includes('Owned spaces'));
}));

results.push(run('phase5 smoke scripts avoid tenant admin invite bootstrapping and cover platform boundary checks', () => {
  const adminSpaceSmokeSource = require('fs').readFileSync(require.resolve('./admin-space-control-smoke'), 'utf8');
  const platformBoundarySmokeSource = require('fs').readFileSync(require.resolve('./tenancy-platform-boundary-smoke'), 'utf8');
  const rbacRegressionSource = require('fs').readFileSync(require.resolve('./rbac-regression-check'), 'utf8');
  const backendPackageSource = require('fs').readFileSync(require.resolve('../package.json'), 'utf8');
  assert.ok(!adminSpaceSmokeSource.includes('/api/admin/invites'));
  assert.ok(adminSpaceSmokeSource.includes('createDirectUser'));
  assert.ok(platformBoundarySmokeSource.includes('/api/admin/spaces'));
  assert.ok(platformBoundarySmokeSource.includes('/api/spaces/${spaceId}/members'));
  assert.ok(platformBoundarySmokeSource.includes('/api/spaces/${spaceId}/invites'));
  assert.ok(platformBoundarySmokeSource.includes("expectStatus: 404"));
  assert.ok(!rbacRegressionSource.includes('/api/admin/invites'));
  assert.ok(rbacRegressionSource.includes('/api/auth/scope'));
  assert.ok(rbacRegressionSource.includes('/api/spaces/${targetSpaceId}/invites'));
  assert.ok(backendPackageSource.includes('"test:tenancy-platform-boundary": "node scripts/tenancy-platform-boundary-smoke.js"'));
}));

results.push(run('admin activity route stays in the platform control plane before tenant scope enforcement', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.get('/activity'"));
  assert.ok(adminRoutesSource.indexOf("platformRouter.get('/activity'") < adminRoutesSource.indexOf("platformRouter.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
}));

results.push(run('server source assigns request ids before request logging', () => {
  assert.ok(serverSource.includes("const { requestIdMiddleware } = require('./middleware/requestId');"));
  assert.ok(serverSource.includes('app.use(requestIdMiddleware);'));
  assert.ok(serverSource.indexOf('app.use(requestIdMiddleware);') < serverSource.indexOf('app.use(requestLogger);'));
}));

results.push(run('structured log smoke source falls back to OpenSearch-backed verification', () => {
  assert.ok(structuredLogSmokeSource.includes('const OPENSEARCH_URL'));
  assert.ok(structuredLogSmokeSource.includes('const SMOKE_REQUEST_ID'));
  assert.ok(structuredLogSmokeSource.includes('const FEATURE_FLAG_SETTLE_MS'));
  assert.ok(structuredLogSmokeSource.includes('async function searchOpenSearch'));
  assert.ok(structuredLogSmokeSource.includes("source: 'opensearch-index'"));
  assert.ok(structuredLogSmokeSource.includes("message.request_id === requestId"));
  assert.ok(structuredLogSmokeSource.includes('Waiting ${FEATURE_FLAG_SETTLE_MS}ms for feature-flag cache to settle...'));
}));

results.push(run('feature flags source includes external log export flag', () => {
  const featureFlagsSource = require('fs').readFileSync(require.resolve('../services/featureFlags'), 'utf8');
  assert.ok(featureFlagsSource.includes('external_log_export_enabled'));
}));

if (results.some((ok) => !ok)) {
  process.exit(1);
}

console.log(`All unit tests passed (${results.length})`);
