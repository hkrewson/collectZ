'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCsvText } = require('../services/csv');
const { normalizeBarcodeMatches } = require('../services/barcode');
const { normalizePlexItem, normalizePlexVariant, shouldIncludePlexEntry } = require('../services/plex');
const { wrapTmdbRequestError } = require('../services/tmdb');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIsbn, normalizeIdentifierSet } = require('../services/importIdentifiers');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { normalizeOpdsEntry } = require('../services/cwa');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  buildNormalizationMatchContract,
  detectLikelyComicLikeBook,
  chooseCanonicalRow,
  buildHistoricalRepairPlan,
  buildPersistedMergeEvidence
} = require('../services/bookComicNormalization');
const {
  assessMovieDiscoveryConflictReasons,
  extractStructuredTitleSignals,
  isStructuredTitlePairUnsafeForSharedCoverDiscovery,
  isTitleSafeForGenericYearRecommendation,
  buildGenericManualMergeIdentity,
  normalizeMovieDiscoveryTitle
} = require('../services/manualMergeRecommendations');
const {
  buildMediaIdentityAliasKey,
  buildMediaIdentityAliasEntries
} = require('../services/mediaIdentityAliases');
const { buildOwnedFormatsPayload, buildMergedOwnedFormatsPayload, getOwnedFormatLabel } = require('../services/mediaFormats');
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
const {
  MIN_PRICECHARTING_INTERVAL_MS,
  buildPriceChartingRateLimitPolicy,
  buildValuationLookupInput,
  buildFixtureValuationResult,
  extractPriceChartingValuation,
  extractEbayBrowseValuation,
  deriveEbayTokenUrl,
  buildEbayKeywordCandidate,
  refreshMediaValuation
} = require('../services/valuations');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'unit-test-integration-key';
const { buildIntegrationResponse } = require('../services/integrationResponse');
const { buildCompactJobSummary, formatSyncJob } = require('../services/syncJobs');
const { ICS_FETCH_USER_AGENT, fetchIcsText, parseIcsEvents } = require('../services/schedIcsSync');
const {
  buildLoanReminderPhase,
  wasLoanReminderSentToday,
  getLoanReminderTrackingField,
  isAutomaticReminderEligible,
  buildLoanReminderDeliveryWindowKey
} = require('../services/loanReminders');
const metricsModule = require('../services/metrics');
const { shouldEnforceCsrf } = require('../middleware/csrf');
const observabilityRuntimeSource = fs.readFileSync(require.resolve('../services/observabilityRuntime'), 'utf8');
const releasePreflightLocalSource = fs.readFileSync(require.resolve('../scripts/release-preflight-local'), 'utf8');
const artMigrationBackfillSmokeSource = fs.readFileSync(require.resolve('../scripts/art-migration-backfill-smoke'), 'utf8');
const nativeArtReadCutoverSmokeSource = fs.readFileSync(require.resolve('../scripts/native-art-read-cutover-smoke'), 'utf8');
const authModulePath = require.resolve('../middleware/auth');
const authMiddlewareSource = fs.readFileSync(authModulePath, 'utf8');
const validateMiddlewareSource = fs.readFileSync(require.resolve('../middleware/validate'), 'utf8');
const scopeAccessSource = fs.readFileSync(require.resolve('../middleware/scopeAccess'), 'utf8');
const scopeContextSource = fs.readFileSync(require.resolve('../db/scopeContext'), 'utf8');
const sessionsServiceSource = fs.readFileSync(require.resolve('../services/sessions'), 'utf8');
const productEditionConfigSource = fs.readFileSync(require.resolve('../config/productEdition'), 'utf8');
const {
  hasPersonalAccessTokenScope,
  getRequiredPatScopesForRequest
} = require('../services/personalAccessTokens');
const { isServiceAccountPrefixAllowed } = require('../services/serviceAccountKeys');
const authRoutesSource = fs.readFileSync(require.resolve('../routes/auth'), 'utf8');
const mediaRoutesSource = fs.readFileSync(require.resolve('../routes/media'), 'utf8');
const manualMergeRecommendationsServiceSource = fs.readFileSync(require.resolve('../services/manualMergeRecommendations'), 'utf8');
const openApiSource = fs.readFileSync(require.resolve('../openapi/openapi.yaml'), 'utf8');
const docsRoutesSource = fs.readFileSync(require.resolve('../routes/docs'), 'utf8');
const metricsRoutesSource = fs.readFileSync(require.resolve('../routes/metrics'), 'utf8');
const logExportSource = fs.readFileSync(require.resolve('../services/logExport'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
const migrationsSource = fs.readFileSync(require.resolve('../db/migrations'), 'utf8');
const initSqlSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'init.sql'), 'utf8');
const libraryServiceSource = fs.readFileSync(require.resolve('../services/libraries'), 'utf8');
const personalAccessTokenSource = fs.readFileSync(require.resolve('../services/personalAccessTokens'), 'utf8');
const serviceAccountKeySource = fs.readFileSync(require.resolve('../services/serviceAccountKeys'), 'utf8');
const librariesRoutesSource = fs.readFileSync(require.resolve('../routes/libraries'), 'utf8');
const spacesRoutesSource = fs.readFileSync(require.resolve('../routes/spaces'), 'utf8');
const adminRoutesSource = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
const eventsRoutesSource = fs.readFileSync(require.resolve('../routes/events'), 'utf8');
const collectiblesRoutesSource = fs.readFileSync(require.resolve('../routes/collectibles'), 'utf8');
const integrationsRoutesSource = fs.readFileSync(require.resolve('../routes/integrations'), 'utf8');
const supportRoutesSource = fs.readFileSync(require.resolve('../routes/support'), 'utf8');
const signaturesServiceSource = fs.readFileSync(require.resolve('../services/signatures'), 'utf8');
const eventSocialPlanningSmokeSource = fs.readFileSync(require.resolve('../scripts/event-social-planning-smoke'), 'utf8');
const eventPersonalIcsSyncSmokeSource = fs.readFileSync(require.resolve('../scripts/event-personal-ics-sync-smoke'), 'utf8');
const schedIcsSyncSource = fs.readFileSync(require.resolve('../services/schedIcsSync'), 'utf8');
const spacesServiceSource = fs.readFileSync(require.resolve('../services/spaces'), 'utf8');
function readFrontendSource(relativePath) {
  const base = path.resolve(__dirname, '..', '..', 'frontend', 'src', relativePath);
  for (const ext of ['.jsx', '.js']) {
    const target = `${base}${ext}`;
    if (fs.existsSync(target)) {
      return fs.readFileSync(target, 'utf8');
    }
  }
  throw new Error(`Unable to resolve frontend source for ${relativePath}`);
}
const frontendAppSource = readFrontendSource('App');
const sidebarNavSource = readFrontendSource(path.join('components', 'SidebarNav'));
const dashboardShellSource = readFrontendSource(path.join('components', 'app', 'DashboardShell'));
const dashboardContentSource = readFrontendSource(path.join('components', 'app', 'DashboardContent'));
const dashboardRoutingSource = readFrontendSource(path.join('components', 'app', 'dashboardRouting'));
const productEditionFrontendSource = readFrontendSource(path.join('components', 'app', 'productEdition'));
const supportSessionBannerSource = readFrontendSource(path.join('components', 'app', 'SupportSessionBanner'));
const frontendEnvSource = readFrontendSource(path.join('components', 'app', 'frontendEnv'));
const useApiClientSource = readFrontendSource(path.join('components', 'app', 'hooks', 'useApiClient'));
const helpViewSource = readFrontendSource(path.join('components', 'HelpView'));
const adminActivityViewSource = readFrontendSource(path.join('components', 'AdminActivityView'));
const adminUsersViewSource = readFrontendSource(path.join('components', 'AdminUsersView'));
const libraryLoansViewSource = readFrontendSource(path.join('components', 'LibraryLoansView'));
const adminMergeReviewViewSource = readFrontendSource(path.join('components', 'AdminMergeReviewView'));
const libraryViewSource = readFrontendSource(path.join('components', 'LibraryView'));
const appPrimitivesSource = readFrontendSource(path.join('components', 'app', 'AppPrimitives'));
const eventsViewSource = readFrontendSource(path.join('components', 'EventsView'));
const artViewSource = readFrontendSource(path.join('components', 'ArtView'));
const signatureManagerSource = readFrontendSource(path.join('components', 'app', 'SignatureManager'));
const backendPackageJson = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
const frontendPackageJson = JSON.parse(fs.readFileSync(require.resolve('../../frontend/package.json'), 'utf8'));
const frontendViteConfigSource = fs.readFileSync(require.resolve('../../frontend/vite.config.js'), 'utf8');
const frontendViteIndexHtmlSource = fs.readFileSync(require.resolve('../../frontend/index.html'), 'utf8');
const frontendDockerfileSource = fs.readFileSync(require.resolve('../../frontend/Dockerfile'), 'utf8');
const rootPackageJson = JSON.parse(fs.readFileSync(require.resolve('../../package.json'), 'utf8'));
const playwrightConfigSource = fs.readFileSync(require.resolve('../../playwright.config'), 'utf8');
const helpCenterBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/help-center.browser.spec'), 'utf8');
const helpAdminSupportBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/help-admin-support.browser.spec'), 'utf8');
const approvedSupportSessionBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/approved-support-session.browser.spec'), 'utf8');
const integrationsBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/integrations.browser.spec'), 'utf8');
const importBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/import.browser.spec'), 'utf8');
const importCsvBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/import-csv.browser.spec'), 'utf8');
const adminShellBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/admin-shell.browser.spec'), 'utf8');
const libraryMultiFormatBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/library-multiformat.browser.spec'), 'utf8');
const libraryLifecycleBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/library-lifecycle.browser.spec'), 'utf8');
const spaceManagerBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/space-manager.browser.spec'), 'utf8');
const boundaryBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/boundary.browser.spec'), 'utf8');
const eventsCollectiblesBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/events-collectibles.browser.spec'), 'utf8');
const homelabHelpBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/homelab-help.browser.spec'), 'utf8');
const homelabSharedBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/homelab-shared.browser.spec'), 'utf8');
const homelabEditionBoundarySmokeSource = fs.readFileSync(require.resolve('../scripts/homelab-edition-boundary-smoke'), 'utf8');
const platformEditionBoundarySmokeSource = fs.readFileSync(require.resolve('../scripts/platform-edition-boundary-smoke'), 'utf8');
const dockerPublishWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/docker-publish.yml'), 'utf8');
const browserCapturesWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/browser-captures.yml'), 'utf8');
const dockerComposeSource = fs.readFileSync(require.resolve('../../docker-compose.yml'), 'utf8');
const publicComposeGeneratorSource = fs.readFileSync(require.resolve('../../scripts/generate-public-compose'), 'utf8');
const publicExportValidatorSource = fs.readFileSync(require.resolve('../../scripts/validate-public-export-surface'), 'utf8');
const releaseRoadmapSource = fs.readFileSync(require.resolve('../../docs/wiki/07-Release-Roadmap.md'), 'utf8');
const collectiblesNamingDecisionSource = fs.readFileSync(require.resolve('../../docs/wiki/39-Collectibles-Naming-Decision.md'), 'utf8');
const eventSocialPlanningFoundationSource = fs.readFileSync(require.resolve('../../docs/wiki/40-Event-Social-Planning-Foundation.md'), 'utf8');
const personalSchedIcsSyncSource = fs.readFileSync(require.resolve('../../docs/wiki/41-Personal-Sched-ICS-Sync.md'), 'utf8');
const releaseNotesDir = path.resolve(__dirname, '..', '..', 'docs', 'releases');
const releaseDocsSource = fs.readdirSync(releaseNotesDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => fs.readFileSync(path.join(releaseNotesDir, name), 'utf8'))
  .join('\n');
const backendDockerfileSource = fs.readFileSync(require.resolve('../../backend/Dockerfile'), 'utf8');
const structuredLogSmokeSource = fs.readFileSync(require.resolve('../scripts/structured-log-smoke'), 'utf8');
const structuredLogLokiSmokeSource = fs.readFileSync(require.resolve('../scripts/structured-log-loki-smoke'), 'utf8');
const structuredLogSyslogSmokeSource = fs.readFileSync(require.resolve('../scripts/structured-log-syslog-smoke'), 'utf8');
const structuredLogSmokeSharedSource = fs.readFileSync(require.resolve('../scripts/structured-log-smoke-shared'), 'utf8');
const importNormalizationSmokeSource = fs.readFileSync(require.resolve('../scripts/import-normalization-smoke'), 'utf8');
const importNormalizationReviewSmokeSource = fs.readFileSync(require.resolve('../scripts/import-normalization-review-smoke'), 'utf8');
const repeatSyncIdempotencySmokeSource = fs.readFileSync(require.resolve('../scripts/repeat-sync-idempotency-smoke'), 'utf8');
const crossSourceCanonicalReuseSmokeSource = fs.readFileSync(require.resolve('../scripts/cross-source-canonical-reuse-smoke'), 'utf8');
const providerFamilyCrossSourceCanonicalReuseSmokeSource = fs.readFileSync(require.resolve('../scripts/provider-family-cross-source-canonical-reuse-smoke'), 'utf8');
const sparseMetadataAliasReuseSmokeSource = fs.readFileSync(require.resolve('../scripts/sparse-metadata-alias-reuse-smoke'), 'utf8');
const collectionResyncBoundarySmokeSource = fs.readFileSync(require.resolve('../scripts/collection-resync-boundary-smoke'), 'utf8');
const cwaOpdsRepeatSyncIdempotencySmokeSource = fs.readFileSync(require.resolve('../scripts/cwa-opds-repeat-sync-idempotency-smoke'), 'utf8');
const cwaOpdsLinkContractSmokeSource = fs.readFileSync(require.resolve('../scripts/cwa-opds-link-contract-smoke'), 'utf8');
const cwaOpdsComicIdentityReuseSmokeSource = fs.readFileSync(require.resolve('../scripts/cwa-opds-comic-identity-reuse-smoke'), 'utf8');
const historicalRepairPlanSource = fs.readFileSync(require.resolve('../scripts/book-comic-historical-repair-plan'), 'utf8');
const backfillMergeEvidenceSource = fs.readFileSync(require.resolve('../scripts/backfill-merge-evidence'), 'utf8');
const repairComicLikeBooksSource = fs.readFileSync(require.resolve('../scripts/repair-comic-like-books'), 'utf8');
const repairComicLikeBooksSmokeSource = fs.readFileSync(require.resolve('../scripts/repair-comic-like-books-smoke'), 'utf8');
const repairBookComicDuplicatesSource = fs.readFileSync(require.resolve('../scripts/repair-book-comic-duplicates'), 'utf8');
const repairBookComicDuplicatesSmokeSource = fs.readFileSync(require.resolve('../scripts/repair-book-comic-duplicates-smoke'), 'utf8');
const repairBookComicMultiRevertSmokeSource = fs.readFileSync(require.resolve('../scripts/repair-book-comic-multi-revert-smoke'), 'utf8');
const manualMergePreviewSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-preview-smoke'), 'utf8');
const manualMergeApplySmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-apply-smoke'), 'utf8');
const manualMergeRevertSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-revert-smoke'), 'utf8');
const manualMergeRevertResyncIntegritySmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-revert-resync-integrity-smoke'), 'utf8');
const manualMergeRecommendationsSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-recommendations-smoke'), 'utf8');
const manualMergeRecommendationRejectSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-recommendation-reject-smoke'), 'utf8');
const manualMergeRecommendationRestoreSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-recommendation-restore-smoke'), 'utf8');
const manualMergeIdentityAliasSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-identity-alias-smoke'), 'utf8');
const manualMergeMultiHopIdentityAliasSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-multi-hop-identity-alias-smoke'), 'utf8');
const manualMergeScopeIsolationResyncSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-scope-isolation-resync-smoke'), 'utf8');
const strongIdConflictGuardSmokeSource = fs.readFileSync(require.resolve('../scripts/strong-id-conflict-guard-smoke'), 'utf8');
const strongIdMovieConflictGuardSmokeSource = fs.readFileSync(require.resolve('../scripts/strong-id-movie-conflict-guard-smoke'), 'utf8');
const strongIdPlexTmdbConflictGuardSmokeSource = fs.readFileSync(require.resolve('../scripts/strong-id-plex-tmdb-conflict-guard-smoke'), 'utf8');
const manualMergeMetronIdentityAliasSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-metron-identity-alias-smoke'), 'utf8');
const manualMergePlexIdentityAliasSmokeSource = fs.readFileSync(require.resolve('../scripts/manual-merge-plex-identity-alias-smoke'), 'utf8');
const helpReleasesSmokeSource = fs.readFileSync(require.resolve('../scripts/help-releases-smoke'), 'utf8');
const collectionDuplicatePreviewSmokeSource = fs.readFileSync(require.resolve('../scripts/collection-duplicate-preview-smoke'), 'utf8');
const collectionMergeApplyRevertSmokeSource = fs.readFileSync(require.resolve('../scripts/collection-merge-apply-revert-smoke'), 'utf8');
const comicDuplicateCandidatesSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-duplicate-candidates-smoke'), 'utf8');
const comicQueryContractSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-query-contract-smoke'), 'utf8');
const comicSeriesQueryContractSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-series-query-contract-smoke'), 'utf8');
const comicSeriesIssuesQueryContractSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-series-issues-query-contract-smoke'), 'utf8');
const comicMetronOverviewTruncationSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-metron-overview-truncation-smoke'), 'utf8');
const libraryLoanReminderWorkflowSmokeSource = fs.readFileSync(require.resolve('../scripts/library-loan-reminder-workflow-smoke'), 'utf8');
const automaticLoanRemindersSmokeSource = fs.readFileSync(require.resolve('../scripts/automatic-loan-reminders-smoke'), 'utf8');
const loanRemindersServiceSource = fs.readFileSync(require.resolve('../services/loanReminders'), 'utf8');
const libraryMultiformatBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/library-multiformat.browser.spec.js'), 'utf8');
const comicDuplicateDeferSmokeSource = fs.readFileSync(require.resolve('../scripts/comic-duplicate-defer-smoke'), 'utf8');
const { parseComicMetadataFromTitle, buildComicLikeBookProposal, buildComicLikeBookRevertProposal } = require('../scripts/repair-comic-like-books');
const { buildClusterFromRows, mergeMissingObjectFields } = require('../scripts/repair-book-comic-duplicates');
const supportSessionSmokeSource = fs.readFileSync(require.resolve('../scripts/support-session-smoke'), 'utf8');
const libraryLifecycleSmokeSource = fs.readFileSync(require.resolve('../scripts/library-lifecycle-smoke'), 'utf8');
const spaceLifecycleSmokeSource = fs.readFileSync(require.resolve('../scripts/space-lifecycle-smoke'), 'utf8');
const dashboardSpec = JSON.parse(fs.readFileSync(require.resolve('../../ops/monitoring/grafana/dashboards/collectz-overview.json'), 'utf8'));
const alertRulesSource = fs.readFileSync(require.resolve('../../docs/alerts/collectz-alert-rules.yaml'), 'utf8');
const bookComicNormalizationSource = fs.readFileSync(require.resolve('../services/bookComicNormalization'), 'utf8');

async function run(name, fn) {
  try {
    await fn();
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

results.push(run('bookComicNormalization uses ISBN as the highest-confidence book identity key', () => {
  const identity = buildBookNormalizationIdentity({
    title: 'Wool',
    type_details: { isbn: '978-0-358-44784-9', author: 'Hugh Howey' }
  });
  assert.deepStrictEqual(identity, {
    action: 'auto_attach',
    confidence: 'high',
    kind: 'isbn',
    key: 'book:isbn:9780358447849',
    rationale: ['normalized_isbn']
  });
}));

results.push(run('bookComicNormalization uses series and issue for high-confidence comic identity', () => {
  const identity = buildComicNormalizationIdentity({
    title: 'Alpha Flight #10',
    type_details: { series: 'Alpha Flight', issue_number: '#10', volume: '1' }
  });
  assert.deepStrictEqual(identity, {
    confidence: 'high',
    action: 'auto_attach',
    kind: 'series_issue_volume',
    key: 'comic:series_issue:alpha flight::1::10',
    rationale: ['normalized_series', 'normalized_issue_number', 'normalized_volume']
  });
}));

results.push(run('bookComicNormalization treats series and issue without volume as review confidence', () => {
  const identity = buildComicNormalizationIdentity({
    title: 'Alpha Flight #10',
    type_details: { series: 'Alpha Flight', issue_number: '#10' }
  });
  assert.deepStrictEqual(identity, {
    confidence: 'medium',
    action: 'review',
    kind: 'series_issue',
    key: 'comic:series_issue:alpha flight::-::10',
    rationale: ['normalized_series', 'normalized_issue_number']
  });
}));

results.push(run('manualMergeRecommendations suppresses collection and volume titles from generic title-year recommendations', () => {
  const volumeSignals = extractStructuredTitleSignals('Mystery Science Theater 3000, Vol. XIV');
  assert.strictEqual(volumeSignals.volumeToken, 'xiv');
  assert.strictEqual(volumeSignals.hasCollectionSignal, true);
  assert.strictEqual(isTitleSafeForGenericYearRecommendation('Mystery Science Theater 3000, Vol. XIV'), false);

  const identity = buildGenericManualMergeIdentity({
    title: 'Mystery Science Theater 3000, Vol. XIV',
    media_type: 'movie',
    year: 2015
  });
  assert.strictEqual(identity.confidence, 'low');
  assert.strictEqual(identity.kind, 'title_only');
}));

results.push(run('manualMergeRecommendations suppresses franchise titles with generic subtitles from title-year recommendations', () => {
  const genericSignals = extractStructuredTitleSignals('Mystery Science Theater 3000: The Movie');
  assert.strictEqual(genericSignals.hasGenericSubtitle, true);
  assert.strictEqual(isTitleSafeForGenericYearRecommendation('Mystery Science Theater 3000: The Movie'), false);

  const specificSignals = extractStructuredTitleSignals("Mystery Science Theater 3000: Angel's Revenge");
  assert.strictEqual(specificSignals.hasGenericSubtitle, false);
  assert.strictEqual(isTitleSafeForGenericYearRecommendation("Mystery Science Theater 3000: Angel's Revenge"), true);
}));

results.push(run('manualMergeRecommendations suppresses shared-cover discovery for franchise-separated titles with differing suffixes', () => {
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'Mystery Science Theater 3000: Angel\'s Revenge',
      'Mystery Science Theater 3000: The Movie'
    ),
    true
  );
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'Alpha Flight #12: ...And One Shall Surely Die',
      'Alpha Flight #12: ...And One Shall Surely Die'
    ),
    false
  );
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'Mystery Science Theater 3000, Vol. XIV',
      'Mystery Science Theater 3000, Vol. XXX'
    ),
    true
  );
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'SCTV Disc 2 - Southside Fracas & The Sammy Maudlin Show',
      'SCTV, Volume 2'
    ),
    true
  );
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'SCTV, Volume 2',
      'SCTV - Best Of The Early Years'
    ),
    true
  );
  assert.strictEqual(
    isStructuredTitlePairUnsafeForSharedCoverDiscovery(
      'Star Trek II: The Wrath of Khan',
      'Star Trek II - The Wrath of Khan'
    ),
    false
  );
}));

results.push(run('manualMergeRecommendations suppresses movie discovery when strong identity fields conflict', () => {
  assert.deepStrictEqual(
    assessMovieDiscoveryConflictReasons(
      {
        media_type: 'movie',
        original_title: 'Future Shock',
        year: 2021,
        upc: '0732302616930',
        tmdb_id: '878032',
        director: 'Jose Luis Mora',
        runtime: 98
      },
      {
        media_type: 'movie',
        original_title: 'Future Shock',
        year: 2003,
        upc: '0761450635036',
        tmdb_id: '91605',
        director: 'Oley Sassone',
        runtime: 98
      }
    ).sort(),
    ['director_conflict', 'tmdb_id_conflict', 'upc_conflict', 'year_conflict'].sort()
  );
  assert.deepStrictEqual(
    assessMovieDiscoveryConflictReasons(
      {
        media_type: 'movie',
        original_title: '王立宇宙軍 オネアミスの翼',
        year: 2023,
        tmdb_id: '20043',
        director: 'Hiroyuki Yamaga',
        runtime: 121
      },
      {
        media_type: 'movie',
        original_title: 'Terminal Voyage',
        year: 1994,
        tmdb_id: '183013',
        director: 'Rick Jacobson',
        runtime: 79
      }
    ).sort(),
    ['director_conflict', 'original_title_conflict', 'runtime_conflict', 'tmdb_id_conflict', 'year_conflict'].sort()
  );
}));

results.push(run('manualMergeRecommendations keeps packaging-heavy movie variants eligible for discovery', () => {
  assert.strictEqual(
    normalizeMovieDiscoveryTitle('Creating Rem Lezar 35th Anniversary Edition Blu-ray'),
    'creating rem lezar'
  );
  assert.strictEqual(
    normalizeMovieDiscoveryTitle('BLACK PANTHER US/EC/BD'),
    'black panther'
  );
  assert.strictEqual(
    normalizeMovieDiscoveryTitle('Avengers Infinity War 4K Ultra HD + Blu Ray + Digital Code'),
    'avengers infinity war'
  );
  assert.deepStrictEqual(
    assessMovieDiscoveryConflictReasons(
      {
        media_type: 'movie',
        title: 'Creating Rem Lezar',
        original_title: 'Creating Rem Lezar',
        year: 2021,
        tmdb_id: '124532',
        director: 'Scott Zakarin',
        runtime: 48
      },
      {
        media_type: 'movie',
        title: 'Creating Rem Lezar 35th Anniversary Edition Blu-ray',
        year: 2023
      }
    ),
    []
  );
  assert.deepStrictEqual(
    assessMovieDiscoveryConflictReasons(
      {
        media_type: 'movie',
        title: 'Avengers Infinity War 4K Ultra HD + Blu Ray + Digital Code',
        year: 2018,
        upc: '0786936858112',
        director: 'Joe Russo, Anthony Russo'
      },
      {
        media_type: 'movie',
        title: 'Avengers: Infinity War',
        year: 2018,
        tmdb_id: '299536',
        director: 'Joe Russo',
        runtime: 149
      }
    ),
    []
  );
}));

results.push(run('mediaIdentityAliases builds stable alias keys and duplicate-row alias entries for future reimports', () => {
  assert.strictEqual(
    buildMediaIdentityAliasKey('providerItemId', 'urn:uuid:duplicate-entry'),
    'identity_alias:provider_item_id:urn:uuid:duplicate-entry'
  );
  assert.strictEqual(
    buildMediaIdentityAliasKey('eanUpc', ' 024543079491 '),
    'identity_alias:ean_upc:024543079491'
  );

  const entries = buildMediaIdentityAliasEntries({
    mediaRow: {
      upc: '024543079491',
      type_details: {
        provider_item_id: 'urn:uuid:duplicate-entry',
        calibre_entry_id: 'urn:uuid:duplicate-entry',
        isbn: '978-0-316-76948-8'
      }
    },
    snapshot: {
      media_metadata: [
        { key: 'plex_guid', value: 'plex://movie/123' },
        { key: 'plex_item_key', value: '1:987' }
      ]
    }
  });
  const keys = entries.map((entry) => entry.key);
  assert.ok(keys.includes('identity_alias:provider_item_id:urn:uuid:duplicate-entry'));
  assert.ok(keys.includes('identity_alias:calibre_entry_id:urn:uuid:duplicate-entry'));
  assert.ok(keys.includes('identity_alias:isbn:9780316769488'));
  assert.ok(keys.includes('identity_alias:ean_upc:024543079491'));
  assert.ok(keys.includes('identity_alias:plex_guid:plex://movie/123'));
  assert.ok(keys.includes('identity_alias:plex_item_key:1:987'));
}));

results.push(run('bookComicNormalization flags comic-like book rows for review', () => {
  const signal = detectLikelyComicLikeBook({
    title: 'Invader Zim #1 Comics Dungeon Exclusive Variant by Vincent Perea',
    type_details: {}
  });
  assert.strictEqual(signal.likely, true);
  assert.ok(signal.reasons.includes('issue_number_in_title'));
  assert.ok(signal.reasons.includes('variant_in_title'));
}));

results.push(run('bookComicNormalization exposes explicit match contract precedence', () => {
  const contract = buildNormalizationMatchContract();
  assert.strictEqual(contract.books[0].kind, 'isbn');
  assert.strictEqual(contract.books[0].action, 'auto_attach');
  assert.strictEqual(contract.comics[2].kind, 'series_issue');
  assert.strictEqual(contract.comics[2].confidence, 'medium');
  assert.strictEqual(contract.comics[2].action, 'review');
}));

results.push(run('bookComicNormalization chooses canonical rows by richer identity before falling back to older ids', () => {
  const chosen = chooseCanonicalRow([
    {
      id: 9,
      media_type: 'comic_book',
      title: 'Alpha Flight #10',
      import_source: 'csv',
      type_details: { series: 'Alpha Flight', issue_number: '10', volume: '1' }
    },
    {
      id: 12,
      media_type: 'comic_book',
      title: 'Alpha Flight #10',
      import_source: 'cwa',
      type_details: { series: 'Alpha Flight', issue_number: '10', volume: '1', provider_name: 'cwa_opds', provider_item_id: 'abc-123' }
    }
  ]);
  assert.strictEqual(chosen.id, 12);
}));

results.push(run('bookComicNormalization builds persisted merge evidence for canonical plus duplicate history rows', () => {
  const evidence = buildPersistedMergeEvidence({
    canonicalRow: {
      id: 4935,
      media_type: 'comic_book',
      title: 'Alpha Flight #11',
      import_source: 'metron',
      type_details: { series: 'Alpha Flight', issue_number: '11', volume: '1', provider_name: 'metron', provider_issue_id: '37018' }
    },
    duplicateRow: {
      id: 6757,
      media_type: 'comic_book',
      title: 'Alpha Flight #11',
      import_source: 'cwa',
      type_details: { series: 'Alpha Flight', issue_number: '11', volume: '1', provider_name: 'cwa_opds', provider_issue_id: '37018' }
    }
  });

  assert.strictEqual(evidence.confidence, 'high');
  assert.strictEqual(evidence.kind, 'series_issue_volume');
  assert.strictEqual(evidence.key, 'comic:series_issue:alpha flight::1::11');
  assert.ok(Array.isArray(evidence.rationale));
  assert.ok(evidence.rationale.includes('normalized_series'));
  assert.strictEqual(evidence.canonical_selection.canonical_id, 4935);
  assert.strictEqual(evidence.canonical_selection.duplicate_id, 6757);
  assert.strictEqual(evidence.canonical_selection.selection_reason, 'choose_canonical_row_by_identifier_richness_then_lowest_id');
}));

results.push(run('bookComicNormalization builds a dry-run historical repair plan with safe attach and review buckets', () => {
  const plan = buildHistoricalRepairPlan({
    duplicateBookClusters: [
      {
        key: 'book:isbn:9780306406157',
        confidence: 'high',
        kind: 'isbn',
        rationale: ['normalized_isbn'],
        rows: [
          { id: 1, media_type: 'book', title: 'Dune', import_source: 'csv', type_details: { isbn: '9780306406157', author: 'Frank Herbert' } },
          { id: 2, media_type: 'book', title: 'Dune', import_source: 'opds', type_details: { isbn: '9780306406157' } }
        ]
      }
    ],
    duplicateComicClusters: [
      {
        key: 'comic:series_issue:alpha flight::-::10',
        confidence: 'medium',
        kind: 'series_issue',
        rationale: ['normalized_series', 'normalized_issue_number'],
        rows: [
          { id: 3, media_type: 'comic_book', title: 'Alpha Flight #10', import_source: 'csv', type_details: { series: 'Alpha Flight', issue_number: '10' } },
          { id: 4, media_type: 'comic_book', title: 'Alpha Flight #10', import_source: 'opds', type_details: { series: 'Alpha Flight', issue_number: '10', volume: '1' } }
        ]
      }
    ],
    likelyComicLikeBooks: [
      {
        row: { id: 5, media_type: 'book', title: 'Groo The Wanderer v1 #1', import_source: 'opds', type_details: {} },
        signal: { likely: true, reasons: ['volume_issue_pattern'] }
      }
    ]
  });
  assert.strictEqual(plan.dryRun, true);
  assert.strictEqual(plan.summary.safeAutoAttachDuplicateClusters, 1);
  assert.strictEqual(plan.summary.reviewDuplicateClusters, 1);
  assert.strictEqual(plan.summary.likelyTypeRepairs, 1);
  assert.strictEqual(plan.safeAutoAttachDuplicateClusters[0].action, 'attach_duplicate_to_canonical');
  assert.strictEqual(plan.reviewDuplicateClusters[0].action, 'review_duplicate_cluster');
  assert.strictEqual(plan.likelyTypeRepairs[0].action, 'review_reclassify_book_to_comic');
}));

results.push(run('repairComicLikeBooks infers comic metadata from year-prefixed and volume issue titles', () => {
  const yearPrefixed = parseComicMetadataFromTitle('(1982) Starslayer #05');
  assert.strictEqual(yearPrefixed.series, 'Starslayer');
  assert.strictEqual(yearPrefixed.issue_number, '05');
  assert.strictEqual(yearPrefixed.cover_date, '1982-01-01');

  const volumeHash = parseComicMetadataFromTitle('Groo The Wanderer v1 #1 - Friends and Enemies');
  assert.strictEqual(volumeHash.series, 'Groo The Wanderer');
  assert.strictEqual(volumeHash.volume, '1');
  assert.strictEqual(volumeHash.issue_number, '1');
}));

results.push(run('repairComicLikeBooks builds a comic reclassification proposal with preserved metadata', () => {
  const proposal = buildComicLikeBookProposal({
    id: 77,
    title: 'Groo The Wanderer v1 #1 - Friends and Enemies',
    media_type: 'book',
    import_source: 'cwa_opds',
    type_details: {
      author: 'Sergio Aragonés, Mark Evanier',
      provider_name: 'cwa_opds',
      provider_item_id: 'urn:uuid:test'
    }
  });
  assert.strictEqual(proposal.action, 'reclassify_book_to_comic');
  assert.strictEqual(proposal.proposed_media_type, 'comic_book');
  assert.strictEqual(proposal.proposed_type_details.series, 'Groo The Wanderer');
  assert.strictEqual(proposal.proposed_type_details.issue_number, '1');
  assert.strictEqual(proposal.proposed_type_details.volume, '1');
  assert.strictEqual(proposal.proposed_type_details.author, 'Sergio Aragonés, Mark Evanier');
  assert.strictEqual(proposal.proposed_type_details.provider_name, 'cwa_opds');
}));

results.push(run('repairComicLikeBooks builds a revert proposal from stored historical metadata', () => {
  const proposal = buildComicLikeBookRevertProposal({
    id: 88,
    title: 'Groo The Wanderer v1 #1 - Friends and Enemies',
    media_type: 'comic_book',
    historical_repair_action: 'reclassify_book_to_comic',
    historical_repair_previous_media_type: 'book',
    historical_repair_previous_type_details: JSON.stringify({
      author: 'Sergio Aragonés, Mark Evanier',
      provider_name: 'cwa_opds'
    })
  });
  assert.strictEqual(proposal.action, 'revert_comic_to_book');
  assert.strictEqual(proposal.proposed_media_type, 'book');
  assert.strictEqual(proposal.proposed_type_details.author, 'Sergio Aragonés, Mark Evanier');
  assert.strictEqual(proposal.proposed_type_details.provider_name, 'cwa_opds');
}));

results.push(run('repairBookComicDuplicates merges only missing canonical type-detail fields', () => {
  const merged = mergeMissingObjectFields(
    {
      isbn: '9780358447849',
      author: '',
      publisher: 'Crown',
      owned_formats: []
    },
    {
      author: 'Hugh Howey',
      publisher: 'Broad Reach',
      owned_formats: ['Hardcover'],
      language: 'en'
    }
  );

  assert.deepStrictEqual(merged, {
    isbn: '9780358447849',
    author: 'Hugh Howey',
    publisher: 'Crown',
    owned_formats: ['Hardcover'],
    language: 'en'
  });
}));

results.push(run('repairBookComicDuplicates builds a single high-confidence duplicate cluster for homogeneous rows', () => {
  const cluster = buildClusterFromRows([
    {
      id: 21,
      title: 'Duplicate Attach Smoke Book',
      media_type: 'book',
      type_details: { isbn: '9780358447849' }
    },
    {
      id: 22,
      title: 'Duplicate Attach Smoke Book',
      media_type: 'book',
      type_details: { isbn: '978-0-358-44784-9', author: 'Hugh Howey' }
    }
  ]);

  assert.strictEqual(cluster.confidence, 'high');
  assert.strictEqual(cluster.kind, 'isbn');
  assert.strictEqual(cluster.key, 'book:isbn:9780358447849');
  assert.strictEqual(cluster.rows.length, 2);
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

results.push(run('importIdentifiers.normalizeIsbn converts ISBN-10 values with X check digits into canonical ISBN-13', () => {
  assert.strictEqual(normalizeIsbn('055357275X'), '9780553572759');
}));

results.push(run('importIdentifiers.normalizeIsbn rejects invalid ISBN-10 values with bad X check digits', () => {
  assert.strictEqual(normalizeIsbn('0553572751'), '');
}));

results.push(run('mediaFormats.buildOwnedFormatsPayload preserves multi-format ownership and derives primary display format', () => {
  const moviePayload = buildOwnedFormatsPayload('movie', ['dvd', 'uhd', 'bluray'], null);
  assert.deepStrictEqual(moviePayload.ownedFormats, ['dvd', 'bluray', 'uhd']);
  assert.strictEqual(moviePayload.format, '4K UHD');

  const audioPayload = buildOwnedFormatsPayload('audio', ['cassette', 'vinyl', 'digital'], null);
  assert.deepStrictEqual(audioPayload.ownedFormats, ['cassette', 'vinyl', 'digital']);
  assert.strictEqual(audioPayload.format, 'Digital');
}));

results.push(run('mediaFormats.buildMergedOwnedFormatsPayload unions owned formats and derives the merged primary format', () => {
  const mergedPayload = buildMergedOwnedFormatsPayload('book', ['hardcover'], 'Hardcover', ['digital'], 'Digital');
  assert.deepStrictEqual(mergedPayload.ownedFormats, ['digital', 'hardcover']);
  assert.strictEqual(mergedPayload.format, 'Hardcover');
}));

results.push(run('mediaFormats.getOwnedFormatLabel maps canonical values to stable UI labels', () => {
  assert.strictEqual(getOwnedFormatLabel('book', 'trade_paperback'), 'Trade Paperback');
  assert.strictEqual(getOwnedFormatLabel('movie', 'bluray'), 'Blu-ray');
  assert.strictEqual(getOwnedFormatLabel('audio', 'eight_track'), '8 Track');
}));

results.push(run('media routes expose explicit owned_formats import parsing for generic CSV rows', () => {
  assert.ok(mediaRoutesSource.includes('function parseOwnedFormatsInput('));
  assert.ok(mediaRoutesSource.includes("value('owned_formats') || value('owned formats')"));
  assert.ok(mediaRoutesSource.includes('owned_formats,format'));
}));

results.push(run('media route source includes valuation refresh + media detail endpoints', () => {
  assert.ok(mediaRoutesSource.includes("router.get('/:id'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/valuation-refresh'"));
  assert.ok(mediaRoutesSource.includes("String(req.params.id || '')"));
  assert.ok(mediaRoutesSource.includes("jobType: 'valuation_refresh'"));
  assert.ok(mediaRoutesSource.includes('async function queueImportedValuationRefresh('));
  assert.ok(mediaRoutesSource.includes("req.get('x-valuation-refresh-mode')"));
  assert.ok(mediaRoutesSource.includes('valuationRefresh'));
}));

results.push(run('media format filter matches any owned format instead of only derived primary format', () => {
  assert.ok(mediaRoutesSource.includes('function normalizeOwnedFormatFilterValue('));
  assert.ok(mediaRoutesSource.includes('owned_formats @> ARRAY['));
}));

results.push(run('playwright multi-format regressions cover create, edit, and import paths', () => {
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("owned_formats).toEqual(['dvd', 'bluray', 'digital'])"));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("owned_formats).toEqual(['dvd', 'uhd', 'digital'])"));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("mode: 'fixture'"));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("PriceCharting (fixture)"));
  assert.ok(importBrowserSpecSource.includes("getByRole('tab', { name: 'Barcode', exact: true })).toHaveCount(0)"));
  assert.ok(importCsvBrowserSpecSource.includes("owned_formats).toEqual(['dvd', 'bluray', 'digital'])"));
}));

results.push(run('playwright library lifecycle regressions cover archive and transfer fallback in browser-visible shell state', () => {
  assert.ok(libraryLifecycleBrowserSpecSource.includes('archiving the active library falls back the browser shell onto a surviving accessible library'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes('transferring the active library away from the previous owner falls back the browser shell onto a surviving accessible library'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("postWithCsrf(requestContext, `/api/libraries/${archiveTarget.id}/archive`"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("postWithCsrf(ownerContext, `/api/libraries/${transferTarget.id}/transfer`"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("Bring titles into “${libraryName}” from files or connected services."));
}));

results.push(run('valuations.buildFixtureValuationResult returns deterministic normalized ranges', () => {
  const first = buildFixtureValuationResult({ id: 7, title: 'Chrono Trigger', media_type: 'game', year: 1995 }, 'pricecharting');
  const second = buildFixtureValuationResult({ id: 7, title: 'Chrono Trigger', media_type: 'game', year: 1995 }, 'pricecharting');
  assert.strictEqual(first.provider, 'pricecharting');
  assert.strictEqual(first.fixture, true);
  assert.strictEqual(first.liveNetwork, false);
  assert.deepStrictEqual(
    { ...first.valuation, lastUpdatedAt: null },
    { ...second.valuation, lastUpdatedAt: null }
  );
  assert.ok(/\d{4}-\d{2}-\d{2}T/.test(String(first.valuation.lastUpdatedAt || '')));
  assert.ok(first.valuation.mid >= first.valuation.low);
  assert.ok(first.valuation.high >= first.valuation.mid);
}));

results.push(run('valuations.extractPriceChartingValuation normalizes cents-style payloads into USD fields', () => {
  const extracted = extractPriceChartingValuation({
    id: 123,
    'product-name': 'Chrono Trigger',
    'loose-price': 2599,
    'cib-price': 7499,
    'new-price': 18999
  });
  assert.deepStrictEqual(extracted, {
    low: 25.99,
    mid: 74.99,
    high: 189.99,
    currency: 'USD',
    source: 'PriceCharting',
    productId: 123,
    productName: 'Chrono Trigger',
    consoleName: null
  });
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

results.push(run('admin route source includes automatic loan reminder operations readback', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.get('/loan-reminder-operations'"));
  assert.ok(adminRoutesSource.includes("action = 'media.loan.reminder.auto_run'"));
  assert.ok(adminRoutesSource.includes("action = 'media.loan.reminder.auto_fail'"));
  assert.ok(adminRoutesSource.includes('buildAutomaticLoanReminderRunRecord'));
  assert.ok(adminRoutesSource.includes('buildAutomaticLoanReminderFailureRecord'));
  assert.ok(adminActivityViewSource.includes("/admin/loan-reminder-operations"));
  assert.ok(adminActivityViewSource.includes('Loan reminder operations'));
  assert.ok(adminActivityViewSource.includes('Latest automatic run'));
  assert.ok(adminActivityViewSource.includes('Recent failures'));
}));

results.push(run('auth route source includes explicit support session endpoints', () => {
  assert.ok(authRoutesSource.includes("platformRouter.post('/support-session/start'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/support-session'"));
  assert.strictEqual(backendPackageJson.scripts['test:support-session-smoke'], 'node scripts/support-session-smoke.js');
  assert.strictEqual(backendPackageJson.scripts['test:library-lifecycle-smoke'], 'node scripts/library-lifecycle-smoke.js');
  assert.strictEqual(backendPackageJson.scripts['test:space-lifecycle-smoke'], 'node scripts/space-lifecycle-smoke.js');
  assert.ok(authRoutesSource.includes('function clearSupportSessionAuthState(req, { clearScope = true } = {})'));
  assert.ok(authRoutesSource.includes('async function normalizeRequestAuthState(req)'));
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
  assert.ok(authRoutesSource.includes('const normalized = await normalizeRequestAuthState(req);'));
  assert.ok(authRoutesSource.includes("router.get('/me', authenticateToken, asyncHandler(async (req, res) => {"));
  assert.ok(authRoutesSource.includes("router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {"));
  assert.ok(authRoutesSource.includes('await normalizeRequestAuthState(req);'));
  assert.ok(authRoutesSource.includes('active_space_id: null'));
  assert.ok(authRoutesSource.includes('support_session: null'));
  assert.ok(authRoutesSource.includes('stripHomelabSpaceContext('));
  assert.ok(authRoutesSource.includes('stripHomelabSpaceContextFromUser('));
  assert.ok(authRoutesSource.includes('const homelabEdition = isHomelabEdition(productEdition);'));
  assert.ok(authRoutesSource.includes('} else if (!homelabEdition && existingUserCount > 0 && !selfRegistrationEnabled) {'));
  assert.ok(authRoutesSource.includes('if (homelabEdition && requestedSpaceId) {'));
  assert.ok(authRoutesSource.includes("return res.status(403).json({ error: 'Homelab does not expose generic space selection' });"));
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
  assert.ok(migrationsSource.includes('version: 70'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS media_loans'));
  assert.ok(migrationsSource.includes('idx_media_loans_unique_active_per_media'));
}));

results.push(run('frontend app source includes support session banner and admin trigger plumbing', () => {
  assert.ok(supportSessionBannerSource.includes('Support session active'));
  assert.ok(frontendAppSource.includes('/auth/support-session/start'));
  assert.ok(frontendAppSource.includes('request_id: requestId || undefined'));
  assert.ok(dashboardContentSource.includes('onStartSupportSession'));
}));

results.push(run('auth page waits for backend auth config before showing registration-unavailable state', () => {
  const authPageSource = readFrontendSource(path.join('components', 'AuthPage'));
  assert.ok(authPageSource.includes('const [authConfigLoaded, setAuthConfigLoaded] = useState(false);'));
  assert.ok(authPageSource.includes("route === 'register' && authConfigLoaded && !registerAvailable"));
  assert.ok(authPageSource.includes('setAuthConfigLoaded(true);'));
}));

results.push(run('platform first-user bootstrap no longer depends on SMTP delivery being configured', () => {
  assert.ok(authRoutesSource.includes('const firstUserBootstrap = existingUserCount === 0;'));
  assert.ok(authRoutesSource.includes('const bootstrapWithoutSmtp = !homelabEdition && firstUserBootstrap && !smtpConfigured;'));
  assert.ok(authRoutesSource.includes(': firstUserBootstrap || (registrationRequested && smtpConfigured);'));
  assert.ok(authRoutesSource.includes('email_verification_required: !homelabEdition && !firstUserBootstrap'));
  assert.ok(authRoutesSource.includes('const emailVerified = homelabEdition || Boolean(claimedInvite) || bootstrapWithoutSmtp;'));
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
  assert.ok(frontendAppSource.includes('isSupportHelpEnabled'));
  assert.ok(frontendAppSource.includes("const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes"));
  assert.ok(frontendAppSource.includes('const supportSessionActiveInEdition = supportHelpEnabled && Boolean(supportSession?.active);'));
  assert.ok(frontendAppSource.includes('supportSessionActive: supportSessionActiveInEdition,'));
  assert.ok(adminUsersViewSource.includes('support_admin'));
  assert.ok(dashboardContentSource.includes('<HelpView'));
  assert.ok(helpViewSource.includes('/support/releases'));
  assert.ok(helpViewSource.includes('Guidance'));
  assert.ok(helpViewSource.includes('Recent Releases'));
  assert.ok(productEditionFrontendSource.includes('Help Admin'));
  assert.ok(helpViewSource.includes("HELP_ARTICLES.filter((article) => article.id !== 'spaces')"));
  assert.ok(helpViewSource.includes("supportHelpEnabled && ['admin', 'support_admin'].includes"));
  assert.ok(helpViewSource.includes('isSupportStaff && supportHelpEnabled'));
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
  assert.ok(dashboardShellSource.includes('supportBadgeCount'));
  assert.ok(supportSessionBannerSource.includes('Requester:'));
  assert.ok(supportSessionBannerSource.includes('Case:'));
  assert.ok(helpViewSource.includes('Reply to Support'));
  assert.ok(dashboardShellSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(dashboardShellSource.includes("const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes"));
  assert.ok(dashboardShellSource.includes('const supportSessionActiveInEdition = supportHelpEnabled && Boolean(supportSession?.active);'));
  assert.ok(dashboardShellSource.includes("supportBadgeCount={supportStaffInEdition ? supportSummary.open : null}"));
  assert.ok(supportSessionBannerSource.includes('isSupportHelpEnabled(productEdition)'));
  assert.ok(supportSessionBannerSource.includes("&& ['admin', 'support_admin'].includes(String(user?.role || ''));"));
  assert.ok(sidebarNavSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(sidebarNavSource.includes('const isSupportStaff = supportHelpEnabled && (isAdmin || isSupportAdmin);'));
  assert.ok(sidebarNavSource.includes('const canUseLibraryShell = !isSupportAdmin || !supportHelpEnabled;'));
}));

results.push(run('edition boundary source includes backend-owned homelab shell and help surface rules', () => {
  assert.ok(productEditionConfigSource.includes('process.env.APP_EDITION'));
  assert.ok(productEditionConfigSource.includes("'platform'"));
  assert.ok(productEditionConfigSource.includes("'homelab'"));
  assert.ok(productEditionConfigSource.includes('resolvePersistedActiveSpaceId'));
  assert.ok(authRoutesSource.includes('product_edition: getProductEdition()'));
  assert.ok(authRoutesSource.includes('edition_contract: buildEditionContract(getProductEdition())'));
  assert.ok(authRoutesSource.includes('edition_contract: buildEditionContract(productEdition)'));
  assert.ok(openApiSource.includes('"product_edition"'));
  assert.ok(openApiSource.includes('"EditionContract"'));
  assert.ok(openApiSource.includes('"edition_contract"'));
  assert.ok(productEditionFrontendSource.includes('getHelpTabDefinitions'));
  assert.ok(productEditionFrontendSource.includes('getHelpSurfaceTitle'));
  assert.ok(productEditionFrontendSource.includes('getAllowedDashboardTabs'));
  assert.ok(productEditionFrontendSource.includes("if (!isHomelabEdition(productEdition) && supportSessionActive && canManageActiveSpace)"));
  assert.ok(productEditionFrontendSource.includes('return DEFAULT_PLATFORM_TAB;'));
  assert.ok(helpViewSource.includes('<h1 className="section-title">{helpTitle}</h1>'));
  assert.ok(!helpViewSource.includes('A lightweight home for self-serve guidance and recent release notes for homelab users.'));
  assert.ok(frontendAppSource.includes('getSafeDashboardTab'));
  assert.ok(frontendAppSource.includes('supportSessionActiveInEdition'));
  assert.ok(dashboardContentSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(dashboardContentSource.includes("const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes"));
  assert.ok(dashboardContentSource.includes("...(supportHelpEnabled ? ['support-inbox'] : []),"));
  assert.ok(sidebarNavSource.includes('getAllowedDashboardTabs'));
  assert.ok(sidebarNavSource.includes('showAdminGroup'));
  assert.ok(productEditionConfigSource.includes("return PRODUCT_EDITIONS.has(normalized) ? normalized : 'homelab';"));
  assert.ok(!dockerComposeSource.includes('APP_EDITION'));
  assert.ok(dockerComposeSource.includes('Generated by scripts/generate-public-compose.js'));
  assert.ok(dockerComposeSource.includes('collectz-backend:${IMAGE_TAG:-'));
  assert.ok(publicComposeGeneratorSource.includes('Public homelab deployment compose'));
  assert.ok(publicExportValidatorSource.includes('Public export surface validation passed.'));
  assert.ok(dockerComposeSource.includes('${FRONTEND_PORT:-3000}:3000'));
  assert.ok(serverSource.includes('const HOMELAB_EDITION = isHomelabEdition();'));
  assert.ok(serverSource.includes("app.use('/api/auth', authPlatformRouter);"));
  assert.ok(serverSource.includes("app.use('/api/support', supportSharedRouter);"));
  assert.ok(serverSource.includes("app.use('/api/admin', adminCommonRouter);"));
  assert.ok(serverSource.includes("app.use('/api', sharedIntegrationsRouter);"));
  assert.ok(serverSource.includes("app.use('/api/docs', docsRouter);"));
  assert.ok(serverSource.includes("app.use('/api/metrics', metricsRouter);"));
  assert.ok(serverSource.includes("app.use('/api/support', supportPlatformRouter);"));
  assert.ok(serverSource.includes("app.use('/api', platformIntegrationsRouter);"));
  assert.ok(serverSource.includes("app.use('/api', spaceIntegrationsRouter);"));
  assert.ok(serverSource.includes("app.use('/api', spacesRouter);"));
  assert.ok(serverSource.includes("app.use('/api/admin', adminPlatformRouter);"));
  assert.ok(authRoutesSource.includes('authPlatformRouter'));
  assert.ok(authMiddlewareSource.includes('scopeSpaceId: serviceAccountPrincipal.scope_space_id'));
  assert.ok(authMiddlewareSource.includes('activeSpaceId: serviceAccountPrincipal.scope_space_id ?? serviceAccountPrincipal.active_space_id ?? null'));
  assert.ok(authMiddlewareSource.includes('scopeSpaceId: patPrincipal.scope_space_id'));
  assert.ok(authMiddlewareSource.includes('activeSpaceId: patPrincipal.scope_space_id ?? patPrincipal.active_space_id ?? null'));
  assert.ok(authMiddlewareSource.includes('scopeSpaceId: sessionUser.support_space_id ?? sessionUser.scope_space_id'));
  assert.ok(authMiddlewareSource.includes('activeSpaceId: sessionUser.support_space_id ?? sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null'));
  assert.ok(sessionsServiceSource.includes('COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS scope_space_id'));
  assert.ok(sessionsServiceSource.includes('COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS active_space_id'));
  assert.ok(personalAccessTokenSource.includes('COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS scope_space_id'));
  assert.ok(personalAccessTokenSource.includes('COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS active_space_id'));
  assert.ok(serviceAccountKeySource.includes('COALESCE(active_library.space_id, owner.active_space_id, fallback_library.space_id) AS scope_space_id'));
  assert.ok(serviceAccountKeySource.includes('COALESCE(active_library.space_id, owner.active_space_id, fallback_library.space_id) AS active_space_id'));
  assert.ok(sessionsServiceSource.includes('LEFT JOIN libraries active_library'));
  assert.ok(sessionsServiceSource.includes('active_library.archived_at IS NULL'));
  assert.ok(personalAccessTokenSource.includes('LEFT JOIN libraries active_library'));
  assert.ok(personalAccessTokenSource.includes('active_library.archived_at IS NULL'));
  assert.ok(serviceAccountKeySource.includes('LEFT JOIN libraries active_library'));
  assert.ok(serviceAccountKeySource.includes('active_library.archived_at IS NULL'));
  assert.ok(scopeContextSource.includes('req?.user?.scopeSpaceId ?? req?.user?.activeSpaceId'));
  assert.ok(authRoutesSource.includes('async function resolveSupportPreviousScope(client, req, currentSession) {'));
  assert.ok(authRoutesSource.includes('const previousLibrary = await getAccessibleLibrary({'));
  assert.ok(authRoutesSource.includes('const previousSpace = await getAccessibleSpaceForUser(client, {'));
  assert.ok(authRoutesSource.includes('const previousLibraries = await listLibrariesForSpace({'));
  assert.ok(authRoutesSource.includes('} = await resolveSupportPreviousScope(client, req, currentSession);'));
  assert.ok(authRoutesSource.includes('const supportSpace = await getSupportSpaceSummary(client, Number(req.user.supportSpaceId));'));
  assert.ok(authRoutesSource.includes('const libraries = await listSupportLibrariesForSpace(client, supportSpace.id);'));
  assert.ok(authRoutesSource.includes('const requestedLibraryId = Number(req.user.supportLibraryId || 0) || null;'));
  assert.ok(authRoutesSource.includes("if (['admin', 'support_admin'].includes(String(req.user?.role || '')) && Number(req.user?.supportSpaceId || 0) > 0) {"));
  assert.ok(authRoutesSource.includes('req.user.supportSpaceId = supportSpace.id;'));
  assert.ok(authRoutesSource.includes('req.user.supportSpaceId = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportLibraryId = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportRequestId = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportStartedAt = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportReason = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportPreviousSpaceId = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportPreviousLibraryId = null;'));
  assert.ok(authRoutesSource.includes('req.user.supportLibraryId = activeLibraryId;'));
  assert.ok(authRoutesSource.includes('req.user.scopeSpaceId = supportSpace.id;'));
  assert.ok(authRoutesSource.includes('req.user.scopeSpaceId = previousSpaceId;'));
  assert.ok(authRoutesSource.includes('req.user.scopeSpaceId = null;'));
  assert.ok(authRoutesSource.includes('previousSpaceId,'));
  assert.ok(authRoutesSource.includes('previousLibraryId'));
  assert.ok(authRoutesSource.includes('scopeSpaceId: sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null'));
  assert.ok(authRoutesSource.includes('active_space_id: req.user.scopeSpaceId ?? req.user.activeSpaceId ?? row.active_space_id ?? null'));
  assert.ok(librariesRoutesSource.includes('const existingScopeSpaceId = req.user.scopeSpaceId ?? req.user.activeSpaceId ?? null;'));
  assert.ok(supportRoutesSource.includes("const { resolveScopeContext } = require('../db/scopeContext');"));
  assert.ok(supportRoutesSource.includes('const scopeContext = resolveScopeContext(req);'));
  assert.ok(spacesRoutesSource.includes('req.user.scopeSpaceId = spaceId;'));
  assert.ok(authRoutesSource.includes("platformRouter.post('/support-session/start'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/support-session'"));
  assert.ok(adminRoutesSource.includes('adminCommonRouter'));
  assert.ok(adminRoutesSource.includes('adminPlatformRouter'));
  assert.ok(adminRoutesSource.includes('HOMELAB_ALLOWED_FEATURE_FLAGS'));
  assert.ok(adminRoutesSource.includes("platformRouter.get('/settings/email-delivery'"));
  assert.ok(adminRoutesSource.includes("platformRouter.put('/settings/email-delivery'"));
  assert.ok(adminRoutesSource.includes("platformRouter.post('/settings/email-delivery/test'"));
  assert.ok(adminRoutesSource.includes("Unknown feature flag: ${key}"));
  assert.ok(integrationsRoutesSource.includes("const { resolveScopeContext } = require('../db/scopeContext');"));
  assert.ok(integrationsRoutesSource.includes('const scopeContext = resolveScopeContext(req);'));
  assert.ok(integrationsRoutesSource.includes('loadGeneralSettings(scopeContext?.spaceId || null)'));
  assert.ok(mediaRoutesSource.includes('const scopeContext = resolveScopeContext(req);'));
  assert.ok(mediaRoutesSource.includes('loadScopedIntegrationConfig(scopeContext?.spaceId || null)'));
  assert.ok(mediaRoutesSource.includes('loadScopedIntegrationConfig(effectiveScopeContext.spaceId || null)'));
  assert.ok(supportRoutesSource.includes('supportSharedRouter'));
  assert.ok(supportRoutesSource.includes('supportPlatformRouter'));
  assert.ok(homelabHelpBrowserSpecSource.includes('product_edition'));
  assert.ok(homelabHelpBrowserSpecSource.includes("name: 'Help Admin'"));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-spaces'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-users'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=admin-activity'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=space-manage'));
  assert.ok(homelabHelpBrowserSpecSource.includes("toHaveURL(/tab=help/)"));
  assert.ok(homelabHelpBrowserSpecSource.includes("not.toHaveURL(/tab=admin-spaces/)"));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(homelabSharedBrowserSpecSource.includes("name: 'CSV'"));
  assert.ok(homelabSharedBrowserSpecSource.includes("name: 'Download Template'"));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-settings'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=barcode'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/admin/settings/general'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/admin/settings/integrations'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/config'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/me'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('single_library_household'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('local_accounts'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/scope'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/libraries'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/support/releases'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/media/feature-flags'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/register'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/settings/integrations'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/settings/email-delivery'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-pricecharting'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-ebay'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-logs'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('valuationProviders'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('logExportControl'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('observabilityRuntime'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/feature-flags'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/feature-flags/self_registration_enabled'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('events_enabled'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('collectibles_enabled'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/support/requests'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/support/staff/summary'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/spaces/1/integrations'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/spaces'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/admin/users'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/support-session/start'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/auth/support-session'));
  assert.ok(homelabEditionBoundarySmokeSource.includes("method: 'POST'"));
  assert.ok(homelabEditionBoundarySmokeSource.includes('Homelab does not expose generic space selection'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/libraries/select'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('Homelab /api/libraries/select must switch the active library'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('Homelab /api/auth/scope after library switch must keep the selected library'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('persistedScope?.active_space_id === null'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('persistedScopeAfterLibrarySwitch?.active_space_id === null'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('Homelab edition boundary smoke passed'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/auth/config'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/spaces'));
  assert.ok(platformEditionBoundarySmokeSource.includes('multi_workspace_platform'));
  assert.ok(platformEditionBoundarySmokeSource.includes('workspace_memberships'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/spaces/${defaultSpaceId}/invites'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/spaces/${managedSpaceId}/integrations'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/auth/register'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/email-delivery'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/media/feature-flags'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-pricecharting'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-ebay'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-logs'));
  assert.ok(platformEditionBoundarySmokeSource.includes('self_registration_enabled'));
  assert.ok(platformEditionBoundarySmokeSource.includes('metrics_enabled'));
  assert.ok(platformEditionBoundarySmokeSource.includes('external_log_export_enabled'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/support/staff/summary'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/users'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/auth/support-session/start'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/auth/support-session'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/auth/support-session/start must stay mounted'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform edition boundary smoke passed'));
  assert.ok(supportSessionSmokeSource.includes('support_previous_space_id: detachedSpaceId'));
  assert.ok(supportSessionSmokeSource.includes('support_previous_library_id: detachedLibraryId'));
  assert.ok(supportSessionSmokeSource.includes('support_library_id: detachedLibraryId'));
  assert.ok(supportSessionSmokeSource.includes('const detachedSpace = await createDetachedSpace({'));
  assert.ok(supportSessionSmokeSource.includes("const meWithDriftedSupportLibrary = await admin.request('/api/auth/me', { expectStatus: 200 });"));
  assert.ok(supportSessionSmokeSource.includes("const scopeWithDriftedSupportLibrary = await admin.request('/api/auth/scope', { expectStatus: 200 });"));
  assert.ok(supportSessionSmokeSource.includes('Support session start should normalize stale previous space pointers'));
  assert.ok(supportSessionSmokeSource.includes('Support session start should persist normalized previous library pointers'));
  assert.ok(libraryLifecycleSmokeSource.includes("await ownerClient.request(`/api/libraries/${archiveTarget.id}/archive`, {"));
  assert.ok(libraryLifecycleSmokeSource.includes("await transferOwnerClient.request(`/api/libraries/${transferTarget.id}/transfer`, {"));
  assert.ok(libraryLifecycleSmokeSource.includes('Archive should move affected member to replacement library'));
  assert.ok(libraryLifecycleSmokeSource.includes('Transfer should move previous owner off transferred library via default-scope fallback'));
  assert.ok(libraryLifecycleSmokeSource.includes('Library lifecycle smoke passed'));
  assert.ok(spaceLifecycleSmokeSource.includes("await suspendOwnerClient.request(`/api/spaces/${suspendSpace.id}/members/${suspendMemberMembership.id}/suspension`, {"));
  assert.ok(spaceLifecycleSmokeSource.includes("await removalOwnerClient.request(`/api/spaces/${removalSpace.id}/members/${removalMemberMembership.id}`, {"));
  assert.ok(spaceLifecycleSmokeSource.includes("await transferAdminClient.request(`/api/spaces/${transferSpace.id}/members/${transferOwnerMembership.id}/transfer-new-space`, {"));
  assert.ok(spaceLifecycleSmokeSource.includes('Suspension should clear active space for suspended member'));
  assert.ok(spaceLifecycleSmokeSource.includes('Membership removal should clear current support space tied to removed access'));
  assert.ok(spaceLifecycleSmokeSource.includes('Transfer should preserve new active space after source invalidation cleanup'));
  assert.ok(spaceLifecycleSmokeSource.includes('Space lifecycle smoke passed'));
  assert.ok(rootPackageJson.scripts['stack:up:homelab']);
  assert.ok(rootPackageJson.scripts['stack:up:platform']);
  assert.ok(rootPackageJson.scripts['compose:generate']);
  assert.ok(rootPackageJson.scripts['validate:public-export']);
  assert.ok(rootPackageJson.scripts['stack:up:homelab'].includes('docker compose --env-file .env up -d'));
  assert.ok(rootPackageJson.scripts['stack:up:platform'].includes('docker-compose.localhost.yml'));
  assert.ok(rootPackageJson.scripts['stack:ps:homelab']);
  assert.ok(rootPackageJson.scripts['stack:ps:platform']);
  assert.ok(rootPackageJson.scripts['test:edition-boundaries:local']);
}));

results.push(run('repo includes 2.9.4 Playwright browser regression foundation harness', () => {
  assert.ok(rootPackageJson.scripts['test:browser']);
  assert.ok(rootPackageJson.scripts['test:browser:capture']);
  assert.ok(rootPackageJson.devDependencies['@playwright/test']);
  assert.ok(playwrightConfigSource.includes("http://localhost:3000"));
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
  assert.ok(scopeAccessSource.includes('allowSupportSessionLibraryAccess'));
  assert.ok(scopeAccessSource.includes("Number(libraryRow.space_id || 0) === Number(req.user?.supportSpaceId || 0)"));
  assert.ok(dockerComposeSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN: ${PLAYWRIGHT_E2E_BYPASS_TOKEN:-}'));
  assert.ok(dockerPublishWorkflowSource.includes('browser-regression:'));
  assert.ok(dockerPublishWorkflowSource.includes('npx playwright install --with-deps chromium'));
  assert.ok(dockerPublishWorkflowSource.includes('npm run test:browser'));
  assert.ok(dockerPublishWorkflowSource.includes('playwright-browser-regression'));
  assert.ok(dockerPublishWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(!dockerPublishWorkflowSource.includes('collectz-playwright-ci'));
  assert.ok(dockerPublishWorkflowSource.includes('homelab-edition-boundary:'));
  assert.ok(dockerPublishWorkflowSource.includes('platform-edition-boundary:'));
  assert.ok(dockerPublishWorkflowSource.includes('npm run test:homelab-edition-boundary'));
  assert.ok(dockerPublishWorkflowSource.includes('npm run test:platform-edition-boundary'));
  assert.ok(dockerPublishWorkflowSource.includes('- Homelab edition boundary: PASS'));
  assert.ok(dockerPublishWorkflowSource.includes('- Platform edition boundary: PASS'));
  assert.ok(browserCapturesWorkflowSource.includes('workflow_dispatch:'));
  assert.ok(browserCapturesWorkflowSource.includes('npm run test:browser:capture'));
  assert.ok(browserCapturesWorkflowSource.includes('playwright-browser-captures'));
  assert.ok(browserCapturesWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(helpCenterBrowserSpecSource.includes('Help Center'));
  assert.ok(helpCenterBrowserSpecSource.includes('Create help request'));
  assert.ok(helpAdminSupportBrowserSpecSource.includes('Help Admin'));
  assert.ok(helpAdminSupportBrowserSpecSource.includes('Close Case'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('Start Approved Support Session'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('Workspace'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('updateSupportSessionStateForRequestContext'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('createDetachedLibraryForCurrentUser'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes("getByRole('combobox', { name: 'Support Library' })"));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes('not.toHaveValue(switchedLibraryId)'));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes("page.goto('/dashboard?tab=space-manage')"));
  assert.ok(approvedSupportSessionBrowserSpecSource.includes("toHaveURL(/tab=help/)"));
  assert.ok(integrationsBrowserSpecSource.includes("saveSection(page, 'LOGS')"));
  assert.ok(integrationsBrowserSpecSource.includes("getByRole('tablist', { name: 'Integration sections' })"));
  assert.ok(integrationsBrowserSpecSource.includes('Metrics Export'));
  assert.ok(importBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(importBrowserSpecSource.includes("getByRole('tablist', { name: 'Import sources' })"));
  assert.ok(importBrowserSpecSource.includes("getByRole('tab', { name: 'CSV', exact: true })"));
  assert.ok(importBrowserSpecSource.includes("getByRole('tab', { name: 'Barcode', exact: true })).toHaveCount(0)"));
  assert.ok(importBrowserSpecSource.includes('Choose Delicious CSV'));
  assert.ok(importCsvBrowserSpecSource.includes('/api/media/import-csv'));
  assert.ok(importCsvBrowserSpecSource.includes('CSV import queued'));
  assert.ok(importCsvBrowserSpecSource.includes('waitForSyncJob('));
  assert.ok(importCsvBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes('Bring titles into “${libraryName}” from files or connected services.'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("toHaveCount(0)"));
  assert.ok(spaceManagerBrowserSpecSource.includes('expectManageableFallbackWorkspace'));
  assert.ok(spaceManagerBrowserSpecSource.includes("getByRole('heading', { name: excludedSpaceName, exact: true })).toHaveCount(0)"));
  assert.ok(spaceManagerBrowserSpecSource.includes("getByRole('button', { name: 'Workspace', exact: true })).toBeVisible()"));
  assert.ok(boundaryBrowserSpecSource.includes('support_admin'));
  assert.ok(boundaryBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=logs'));
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
  assert.ok(dashboardRoutingSource.includes("'pricecharting'"));
  assert.ok(dashboardRoutingSource.includes("'ebay'"));
  assert.ok(backendDockerfileSource.includes('COPY package*.json ./'));
  assert.ok(frontendDockerfileSource.includes('COPY package*.json ./'));
  assert.ok(!backendDockerfileSource.includes('@playwright/test'));
  assert.ok(!frontendDockerfileSource.includes('@playwright/test'));
}));

results.push(run('release docs do not preserve fixed local Playwright bypass token values', () => {
  const fixedBypassTokenPattern = /PLAYWRIGHT_E2E_BYPASS_TOKEN=collectz-playwright\b/;
  assert.ok(!fixedBypassTokenPattern.test(releaseRoadmapSource));
  assert.ok(!fixedBypassTokenPattern.test(releaseDocsSource));
  assert.ok(releaseRoadmapSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted>'));
}));

results.push(run('integrations route source extends platform integrations with valuation providers plus observability controls', () => {
  assert.ok(integrationsRoutesSource.includes('const sharedRouter = express.Router();'));
  assert.ok(integrationsRoutesSource.includes('const platformRouter = express.Router();'));
  assert.ok(integrationsRoutesSource.includes('async function buildSharedIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('async function buildPlatformIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('buildHomelabIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('hasPlatformOnlyIntegrationUpdate'));
  assert.ok(integrationsRoutesSource.includes('valuationProviders'));
  assert.ok(integrationsRoutesSource.includes('pricecharting_enabled = EXCLUDED.pricecharting_enabled'));
  assert.ok(integrationsRoutesSource.includes('ebay_browse_enabled = EXCLUDED.ebay_browse_enabled'));
  assert.ok(integrationsRoutesSource.includes('log_export_backend = EXCLUDED.log_export_backend'));
  assert.ok(integrationsRoutesSource.includes('log_export_host = EXCLUDED.log_export_host'));
  assert.ok(integrationsRoutesSource.includes('Platform-only integration settings are not available in homelab edition'));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/admin/settings/integrations'"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.put('/admin/settings/integrations'"));
  assert.ok(integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-pricecharting'"));
  assert.ok(integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-ebay'"));
  assert.ok(integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-logs'"));
  assert.ok(integrationsRoutesSource.includes("/admin/settings/integrations/test-pricecharting"));
  assert.ok(integrationsRoutesSource.includes("/admin/settings/integrations/test-ebay"));
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

results.push(run('media route source prefers direct isbn lookup for explicit book identifiers', () => {
  assert.ok(mediaRoutesSource.includes('const directBookIsbn = mediaType === \'book\' ? normalizeIsbn(upc) : \'\''));
  assert.ok(mediaRoutesSource.includes("provider: 'books:isbn-direct'"));
  assert.ok(mediaRoutesSource.includes("stage: 'book_isbn_direct'"));
}));

results.push(run('media route source applies high-confidence normalization before title fallback for books and comics', () => {
  assert.ok(mediaRoutesSource.includes('matched_by_normalization_high'));
  assert.ok(mediaRoutesSource.includes('findExistingByNormalizationIdentity'));
  assert.ok(mediaRoutesSource.includes('buildNormalizationIdentityForImportedItem'));
}));

results.push(run('media route source keeps medium-confidence normalization candidates in audit without silent title fallback merges', () => {
  assert.ok(mediaRoutesSource.includes('normalization_review_medium'));
  assert.ok(mediaRoutesSource.includes('review_candidate_created'));
  assert.ok(mediaRoutesSource.includes('normalizationReviewRows'));
  assert.ok(mediaRoutesSource.includes('findNormalizationReviewCandidates'));
  assert.ok(mediaRoutesSource.includes('normalizationReviewCandidates.length > 0'));
  assert.ok(mediaRoutesSource.includes('normalization_review_candidates'));
}));

results.push(run('media route source exposes merge details provenance for canonical records', () => {
  assert.ok(mediaRoutesSource.includes("router.get('/:id/merge-details'"));
  assert.ok(mediaRoutesSource.includes('loadScopedMergeDetails'));
  assert.ok(mediaRoutesSource.includes('field_provenance'));
  assert.ok(mediaRoutesSource.includes('merged_sources'));
  assert.ok(mediaRoutesSource.includes('source_count'));
  assert.ok(mediaRoutesSource.includes('source_provider_label'));
  assert.ok(mediaRoutesSource.includes('source_import_label'));
  assert.ok(mediaRoutesSource.includes('source_label'));
  assert.ok(mediaRoutesSource.includes('humanizeMergeSourceToken'));
  assert.ok(mediaRoutesSource.includes('buildAggregateMergeFieldProvenance'));
  assert.ok(mediaRoutesSource.includes('technical_details'));
  assert.ok(mediaRoutesSource.includes('mergeEvidence'));
  assert.ok(mediaRoutesSource.includes('applied_at'));
  assert.ok(mediaRoutesSource.includes('canonical_id'));
  assert.ok(mediaRoutesSource.includes('formatMergeMatchKind'));
  assert.ok(mediaRoutesSource.includes('media_repair_history'));
}));

results.push(run('media route source exposes operator-only manual merge preview for same-type records', () => {
  assert.ok(mediaRoutesSource.includes("router.get('/collections/duplicates'"));
  assert.ok(mediaRoutesSource.includes("router.get('/collections/:id/merge-details'"));
  assert.ok(mediaRoutesSource.includes("router.post('/collections/merge-apply'"));
  assert.ok(mediaRoutesSource.includes("router.post('/collections/merge-revert'"));
  assert.ok(mediaRoutesSource.includes("router.get('/comics/duplicate-candidates'"));
  assert.ok(mediaRoutesSource.includes("router.get('/merge-recommendations'"));
  assert.ok(mediaRoutesSource.includes("router.post('/merge-recommendations/reject'"));
  assert.ok(mediaRoutesSource.includes("router.post('/merge-recommendations/defer'"));
  assert.ok(mediaRoutesSource.includes("router.post('/merge-preview'"));
  assert.ok(mediaRoutesSource.includes("router.post('/merge-apply'"));
  assert.ok(mediaRoutesSource.includes('loadScopedManualMergePreview'));
  assert.ok(mediaRoutesSource.includes('loadScopedManualMergeRecommendations'));
  assert.ok(mediaRoutesSource.includes('buildManualMergeRecommendationIdentity'));
  assert.ok(mediaRoutesSource.includes('recordManualMergeRecommendationFeedback'));
  assert.ok(mediaRoutesSource.includes('media_merge_recommendation_feedback'));
  assert.ok(mediaRoutesSource.includes('runManualMediaMergeApply'));
  assert.ok(mediaRoutesSource.includes("requireRole('admin', 'support_admin')"));
  assert.ok(mediaRoutesSource.includes('requireSessionAuth'));
  assert.ok(mediaRoutesSource.includes('Cross-type merges are not allowed'));
  assert.ok(mediaRoutesSource.includes('buildManualMergeFieldComparisons'));
  assert.ok(mediaRoutesSource.includes('loadManualMergeDependentSummary'));
  assert.ok(mediaRoutesSource.includes('requested_matches_recommended'));
  assert.ok(mediaRoutesSource.includes('operator_review_required'));
  assert.ok(mediaRoutesSource.includes('CANONICAL_SELECTION_REASON'));
  assert.ok(mediaRoutesSource.includes('collection_merge_history'));
  assert.ok(mediaRoutesSource.includes('runManualCollectionMergeApply'));
  assert.ok(mediaRoutesSource.includes('runManualCollectionMergeRevert'));
  assert.ok(mediaRoutesSource.includes('Only the latest collection merge event can be reverted right now'));
  assert.ok(mediaRoutesSource.includes('loadScopedComicDuplicateCandidates'));
  assert.ok(mediaRoutesSource.includes('assessComicRecommendationSuppression'));
  assert.ok(mediaRoutesSource.includes('title_issue_mismatch'));
}));

results.push(run('repo includes import normalization smoke coverage for high-confidence auto-attach', () => {
  assert.ok(backendPackageJson.scripts['test:import-normalization-smoke']);
  assert.ok(importNormalizationSmokeSource.includes('matched_by_normalization_high'));
  assert.ok(importNormalizationSmokeSource.includes('normalization_series_issue_volume'));
  assert.ok(importNormalizationSmokeSource.includes('/api/media/import-csv?sync=1'));
}));

results.push(run('repo includes import normalization review smoke coverage for medium-confidence candidates', () => {
  assert.ok(backendPackageJson.scripts['test:import-normalization-review-smoke']);
  assert.ok(importNormalizationReviewSmokeSource.includes('normalization_review_medium'));
  assert.ok(importNormalizationReviewSmokeSource.includes('review_candidate_created'));
  assert.ok(importNormalizationReviewSmokeSource.includes('normalizationReviewRows'));
  assert.ok(importNormalizationReviewSmokeSource.includes('normalization_series_issue'));
  assert.ok(importNormalizationReviewSmokeSource.includes('normalization_review_candidate_count'));
  assert.ok(importNormalizationReviewSmokeSource.includes('/api/media/import-csv?sync=1'));
}));

results.push(run('repo includes repeat-sync idempotency smoke coverage for csv import families', () => {
  assert.ok(backendPackageJson.scripts['test:repeat-sync-idempotency-smoke']);
  assert.ok(repeatSyncIdempotencySmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(repeatSyncIdempotencySmokeSource.includes('/api/media/import-csv/calibre?sync=1'));
  assert.ok(repeatSyncIdempotencySmokeSource.includes('/api/media/import-csv/delicious?sync=1'));
  assert.ok(repeatSyncIdempotencySmokeSource.includes('secondUpdated'));
  assert.ok(repeatSyncIdempotencySmokeSource.includes('scopedCount'));
}));

results.push(run('repo includes cross-source canonical reuse smoke coverage for csv import families', () => {
  assert.ok(backendPackageJson.scripts['test:cross-source-canonical-reuse-smoke']);
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('/api/media/import-csv/calibre?sync=1'));
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('/api/media/import-csv/delicious?sync=1'));
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('canonicalId'));
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('canonicalImportSource'));
  assert.ok(crossSourceCanonicalReuseSmokeSource.includes('scopedCount'));
}));

results.push(run('repo includes provider-family cross-source canonical reuse smoke coverage for non-csv imports', () => {
  assert.ok(backendPackageJson.scripts['test:provider-family-cross-source-canonical-reuse-smoke']);
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes('/api/media/import-plex?sync=1'));
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes('Expected Plex sync to reuse the original canonical row'));
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes('Expected canonical title variant to remain unchanged, proving TMDB-based reuse instead of title fallback'));
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes("matchedBy: 'provider_tmdb'"));
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes("stableIdentity: 'tmdb_id'"));
  assert.ok(providerFamilyCrossSourceCanonicalReuseSmokeSource.includes('scopedMovieCount'));
}));

results.push(run('repo includes sparse-metadata alias reuse smoke coverage for degraded post-merge payloads', () => {
  assert.ok(backendPackageJson.scripts['test:sparse-metadata-alias-reuse-smoke']);
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes('/api/media/merge-apply'));
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes('Expected sparse follow-up payload to reuse the canonical row'));
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes('Expected richer canonical author metadata to survive sparse follow-up import'));
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes("stableIdentity: 'provider_item_id_alias'"));
  assert.ok(sparseMetadataAliasReuseSmokeSource.includes('scopedBookCount'));
}));

results.push(run('repo includes collection re-sync boundary smoke coverage for merged collection durability', () => {
  assert.ok(backendPackageJson.scripts['test:collection-resync-boundary-smoke']);
  assert.ok(collectionResyncBoundarySmokeSource.includes('/api/media/collections/merge-apply'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('Expected merged canonical collection to preserve the absorbed csv alias'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('Expected re-sync to avoid recreating a duplicate collection'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('Expected later collection-shaped re-sync to land a new contained item on the canonical collection'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('scopedCollectionCount'));
}));

results.push(run('repo includes CWA OPDS repeat-sync idempotency smoke coverage for digital-library imports', () => {
  assert.ok(backendPackageJson.scripts['test:cwa-opds-repeat-sync-idempotency-smoke']);
  assert.ok(cwaOpdsRepeatSyncIdempotencySmokeSource.includes('/api/media/import-cwa?sync=1'));
  assert.ok(cwaOpdsRepeatSyncIdempotencySmokeSource.includes('Expected second CWA import to avoid duplicate creation'));
  assert.ok(cwaOpdsRepeatSyncIdempotencySmokeSource.includes('Expected calibre_entry_id to persist OPDS identity'));
  assert.ok(cwaOpdsRepeatSyncIdempotencySmokeSource.includes("stableIdentity: 'provider_item_id/calibre_entry_id'"));
  assert.ok(cwaOpdsRepeatSyncIdempotencySmokeSource.includes('scopedBookCount'));
}));

results.push(run('repo includes CWA OPDS link-contract smoke coverage for separated browse and download urls', () => {
  assert.ok(backendPackageJson.scripts['test:cwa-opds-link-contract-smoke']);
  assert.ok(cwaOpdsLinkContractSmokeSource.includes('/api/media/import-cwa?sync=1'));
  assert.ok(cwaOpdsLinkContractSmokeSource.includes('Expected OPDS import to leave tmdb_url null'));
  assert.ok(cwaOpdsLinkContractSmokeSource.includes('Expected provider_download_url to keep acquisition URL'));
  assert.ok(cwaOpdsLinkContractSmokeSource.includes('stableIdentity'));
}));

results.push(run('repo includes CWA OPDS comic identity reuse smoke coverage for comic-heavy repeat syncs', () => {
  assert.ok(backendPackageJson.scripts['test:cwa-opds-comic-identity-reuse-smoke']);
  assert.ok(cwaOpdsComicIdentityReuseSmokeSource.includes('/api/media/import-cwa?sync=1'));
  assert.ok(cwaOpdsComicIdentityReuseSmokeSource.includes('Expected OPDS comic import to classify as comic_book'));
  assert.ok(cwaOpdsComicIdentityReuseSmokeSource.includes('Expected second CWA comic import to avoid duplicate creation'));
  assert.ok(cwaOpdsComicIdentityReuseSmokeSource.includes('Expected comic issue metadata to persist'));
  assert.ok(cwaOpdsComicIdentityReuseSmokeSource.includes('scopedComicCount'));
}));

results.push(run('repo includes comic query contract smoke coverage for paginated server-backed issue ordering', () => {
  assert.ok(backendPackageJson.scripts['test:comic-query-contract-smoke']);
  assert.ok(comicQueryContractSmokeSource.includes('/api/media?media_type=comic_book&sortBy=comic_issue'));
  assert.ok(comicQueryContractSmokeSource.includes('Expected comic query to honor requested page limit instead of forcing a full fetch'));
  assert.ok(comicQueryContractSmokeSource.includes('Expected first comic page to start with the earliest issue in series order'));
  assert.ok(comicQueryContractSmokeSource.includes('Expected server sort to group later series after finishing the first series'));
  assert.ok(comicQueryContractSmokeSource.includes("stableSort: 'comic_issue'"));
}));

results.push(run('repo includes comic series query contract smoke coverage for paginated grouped summaries', () => {
  assert.ok(backendPackageJson.scripts['test:comic-series-query-contract-smoke']);
  assert.ok(comicSeriesQueryContractSmokeSource.includes('/api/media/comic-series?page=1&limit=2'));
  assert.ok(comicSeriesQueryContractSmokeSource.includes('Expected comic series query to honor requested page size'));
  assert.ok(comicSeriesQueryContractSmokeSource.includes('Expected grouped comic series total to reflect unique series count'));
  assert.ok(comicSeriesQueryContractSmokeSource.includes('Expected Alpha Flight summary to aggregate both issues into one series row'));
  assert.ok(comicSeriesQueryContractSmokeSource.includes("stableGrouping: 'comic_series'"));
}));

results.push(run('repo includes comic series issues query contract smoke coverage for paginated server-backed series browsing', () => {
  assert.ok(backendPackageJson.scripts['test:comic-series-issues-query-contract-smoke']);
  assert.ok(comicSeriesIssuesQueryContractSmokeSource.includes('/api/media/comic-series/issues?series=Alpha%20Flight&page=1&limit=2'));
  assert.ok(comicSeriesIssuesQueryContractSmokeSource.includes('Expected comic series issues query to honor requested page size'));
  assert.ok(comicSeriesIssuesQueryContractSmokeSource.includes('Expected selected series query to return only the chosen series count'));
  assert.ok(comicSeriesIssuesQueryContractSmokeSource.includes('Expected selected series query to exclude issues from other series'));
  assert.ok(comicSeriesIssuesQueryContractSmokeSource.includes("stableSeriesFilter: 'Alpha Flight'"));
}));

results.push(run('repo includes comic Metron overview truncation smoke coverage for oversized provider descriptions', () => {
  assert.ok(backendPackageJson.scripts['test:comic-metron-overview-truncation-smoke']);
  assert.ok(comicMetronOverviewTruncationSmokeSource.includes('/api/media/enrich/comic/search'));
  assert.ok(comicMetronOverviewTruncationSmokeSource.includes('Expected fake Metron search result to exceed overview validation cap'));
  assert.ok(comicMetronOverviewTruncationSmokeSource.includes('Expected saved overview to clamp to 10000'));
  assert.ok(comicMetronOverviewTruncationSmokeSource.includes('savedOverviewLength'));
  assert.ok(comicMetronOverviewTruncationSmokeSource.includes('truncated'));
}));

results.push(run('repo includes dry-run historical repair plan coverage for duplicate and type-repair reporting', () => {
  assert.ok(backendPackageJson.scripts['test:book-comic-historical-repair-plan']);
  assert.ok(historicalRepairPlanSource.includes('buildHistoricalRepairPlan'));
  assert.ok(bookComicNormalizationSource.includes('attach_duplicate_to_canonical'));
  assert.ok(bookComicNormalizationSource.includes('review_reclassify_book_to_comic'));
  assert.ok(bookComicNormalizationSource.includes('dryRun: true'));
}));

results.push(run('repo includes comic-like book reclassification repair tooling with snapshot metadata and smoke proof', () => {
  assert.ok(backendPackageJson.scripts['repair:comic-like-books']);
  assert.ok(backendPackageJson.scripts['test:repair-comic-like-books-smoke']);
  assert.ok(repairComicLikeBooksSource.includes('historical_repair_previous_media_type'));
  assert.ok(repairComicLikeBooksSource.includes('historical_repair_previous_type_details'));
  assert.ok(repairComicLikeBooksSource.includes('reclassify_book_to_comic'));
  assert.ok(repairComicLikeBooksSource.includes('revert_comic_to_book'));
  assert.ok(repairComicLikeBooksSource.includes('historical_repair_reverted_at'));
  assert.ok(repairComicLikeBooksSmokeSource.includes('Repair comic-like books smoke passed'));
  assert.ok(repairComicLikeBooksSmokeSource.includes('historical_repair_previous_media_type'));
  assert.ok(repairComicLikeBooksSmokeSource.includes('historical_repair_reverted_at'));
}));

results.push(run('repo includes historical duplicate attach repair tooling with snapshot metadata and smoke proof', () => {
  assert.ok(backendPackageJson.scripts['repair:book-comic-duplicates']);
  assert.ok(backendPackageJson.scripts['test:repair-book-comic-duplicates-smoke']);
  assert.ok(backendPackageJson.scripts['test:repair-book-comic-multi-revert-smoke']);
  assert.ok(repairBookComicDuplicatesSource.includes('media_repair_history'));
  assert.ok(repairBookComicDuplicatesSource.includes('buildPersistedMergeEvidence'));
  assert.ok(repairBookComicDuplicatesSource.includes('mergeEvidence'));
  assert.ok(repairBookComicDuplicatesSource.includes('upsertDuplicateAttachHistory'));
  assert.ok(repairBookComicDuplicatesSource.includes('getDuplicateAttachHistory'));
  assert.ok(repairBookComicDuplicatesSource.includes('getExistingDuplicateAttachHistory'));
  assert.ok(repairBookComicDuplicatesSource.includes('markDuplicateAttachHistoryReverted'));
  assert.ok(repairBookComicDuplicatesSource.includes("status: 'already_attached'"));
  assert.ok(repairBookComicDuplicatesSource.includes('alreadyAppliedDuplicateIds'));
  assert.ok(repairBookComicDuplicatesSource.includes('mergeDuplicateMetadataIntoCanonical'));
  assert.ok(repairBookComicDuplicatesSource.includes('buildMergedFormatState'));
  assert.ok(repairBookComicDuplicatesSource.includes('buildMediaIdentityAliasEntries'));
  assert.ok(repairBookComicDuplicatesSource.includes('preserveDuplicateIdentityAliases'));
  assert.ok(repairBookComicDuplicatesSource.includes('preservedIdentityAliases'));
  assert.ok(repairBookComicDuplicatesSource.includes('previousCanonicalOwnedFormats'));
  assert.ok(repairBookComicDuplicatesSource.includes('previousCanonicalFormat'));
  assert.ok(repairBookComicDuplicatesSource.includes('listActiveDuplicateAttachHistories'));
  assert.ok(repairBookComicDuplicatesSource.includes('rebuildCanonicalFormatStateAfterRevert'));
  assert.ok(repairBookComicDuplicatesSource.includes('rewireDuplicateReferences'));
  assert.ok(repairBookComicDuplicatesSource.includes('DELETE FROM media WHERE id = $1'));
  assert.ok(repairBookComicDuplicatesSource.includes('restoreDuplicateMediaRow'));
  assert.ok(repairBookComicDuplicatesSource.includes('revertDuplicateAttachIntoSeparateRow'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('Repair book/comic duplicates smoke passed'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('media_repair_history'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('historyStored'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('revertRecorded'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('canonicalAuthorAfterRevert'));
  assert.ok(repairBookComicDuplicatesSmokeSource.includes('collection_items'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('/api/media/${canonicalId}/merge-details'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('/api/auth/scope'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('beforeActiveMergeCount'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('afterActiveMergeCount'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('remainingMergeDetailDuplicateId'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('canonicalOwnedFormatsAfterRevert'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('revertedDuplicateOwnedFormats'));
  assert.ok(repairBookComicMultiRevertSmokeSource.includes('remainingHistoryStillActive'));
}));

results.push(run('repo includes manual merge preview smoke coverage for same-type preview and cross-type rejection', () => {
  assert.ok(backendPackageJson.scripts['test:manual-merge-preview-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-apply-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-revert-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-revert-resync-integrity-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-identity-alias-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-multi-hop-identity-alias-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-metron-identity-alias-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-plex-identity-alias-smoke']);
  assert.ok(backendPackageJson.scripts['test:help-releases-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-recommendations-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-recommendation-restore-smoke']);
  assert.ok(backendPackageJson.scripts['test:comic-duplicate-candidates-smoke']);
  assert.ok(backendPackageJson.scripts['test:manual-merge-recommendation-reject-smoke']);
  assert.ok(backendPackageJson.scripts['test:comic-duplicate-defer-smoke']);
  assert.ok(backendPackageJson.scripts['test:collection-duplicate-preview-smoke']);
  assert.ok(backendPackageJson.scripts['test:collection-merge-apply-revert-smoke']);
  assert.ok(backendPackageJson.scripts['test:collection-resync-boundary-smoke']);
  assert.ok(backendPackageJson.scripts['test:cwa-opds-repeat-sync-idempotency-smoke']);
  assert.ok(manualMergePreviewSmokeSource.includes('/api/media/merge-preview'));
  assert.ok(manualMergeApplySmokeSource.includes('/api/media/merge-apply'));
  assert.ok(manualMergeRevertSmokeSource.includes('/api/media/merge-revert'));
  assert.ok(manualMergeRevertResyncIntegritySmokeSource.includes('/api/media/merge-revert'));
  assert.ok(manualMergeRevertResyncIntegritySmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(manualMergeRevertResyncIntegritySmokeSource.includes('aliasRemoved'));
  assert.ok(manualMergeRevertResyncIntegritySmokeSource.includes('restoredDuplicateImportSource'));
  assert.ok(manualMergeIdentityAliasSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(manualMergeIdentityAliasSmokeSource.includes('aliasStored'));
  assert.ok(manualMergeIdentityAliasSmokeSource.includes('matchedBy'));
  assert.ok(manualMergeIdentityAliasSmokeSource.includes('scopedBookCount'));
  assert.ok(manualMergeMultiHopIdentityAliasSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(manualMergeMultiHopIdentityAliasSmokeSource.includes('firstImport'));
  assert.ok(manualMergeMultiHopIdentityAliasSmokeSource.includes('secondImport'));
  assert.ok(manualMergeMultiHopIdentityAliasSmokeSource.includes('aliasKeys'));
  assert.ok(manualMergeMultiHopIdentityAliasSmokeSource.includes('finalCanonicalId'));
  assert.ok(backendPackageJson.scripts['test:manual-merge-scope-isolation-resync-smoke']);
  assert.ok(manualMergeScopeIsolationResyncSmokeSource.includes('/api/libraries/select'));
  assert.ok(manualMergeScopeIsolationResyncSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(manualMergeScopeIsolationResyncSmokeSource.includes('Scope B untouched marker'));
  assert.ok(manualMergeScopeIsolationResyncSmokeSource.includes('isolationPreserved'));
  assert.ok(backendPackageJson.scripts['test:strong-id-conflict-guard-smoke']);
  assert.ok(strongIdConflictGuardSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(strongIdConflictGuardSmokeSource.includes('Conflicting same-title import should create a separate row'));
  assert.ok(strongIdConflictGuardSmokeSource.includes('conflictGuarded'));
  assert.ok(backendPackageJson.scripts['test:strong-id-movie-conflict-guard-smoke']);
  assert.ok(strongIdMovieConflictGuardSmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(strongIdMovieConflictGuardSmokeSource.includes('Conflicting same-title movie import should create a separate row'));
  assert.ok(strongIdMovieConflictGuardSmokeSource.includes('canonicalTmdbId'));
  assert.ok(strongIdMovieConflictGuardSmokeSource.includes('conflictGuarded'));
  assert.ok(backendPackageJson.scripts['test:strong-id-plex-tmdb-conflict-guard-smoke']);
  assert.ok(strongIdPlexTmdbConflictGuardSmokeSource.includes('/api/media/import-plex?sync=1'));
  assert.ok(strongIdPlexTmdbConflictGuardSmokeSource.includes('Canonical Plex TMDB conflict row should stay untouched'));
  assert.ok(strongIdPlexTmdbConflictGuardSmokeSource.includes('conflictingTmdbId'));
  assert.ok(strongIdPlexTmdbConflictGuardSmokeSource.includes('conflictGuarded'));
  assert.ok(mediaRoutesSource.includes('strong_identifier_conflict_guarded'));
  assert.ok(mediaRoutesSource.includes('assessTitleFallbackStrongIdentifierConflicts'));
  assert.ok(mediaRoutesSource.includes("router.post('/import-cwa'"));
  assert.ok(mediaRoutesSource.includes('fetchCwaOpdsItems'));
  assert.ok(mediaRoutesSource.includes("'media.import.cwa'"));
  assert.ok(!mediaRoutesSource.includes("code: 'cwa_import_deferred'"));
  assert.ok(manualMergeMetronIdentityAliasSmokeSource.includes('/api/media/import-comics?sync=1'));
  assert.ok(manualMergeMetronIdentityAliasSmokeSource.includes("buildMediaIdentityAliasKey('providerIssueId'"));
  assert.ok(manualMergeMetronIdentityAliasSmokeSource.includes('canonicalProviderIssueId'));
  assert.ok(manualMergeMetronIdentityAliasSmokeSource.includes('scopedComicCount'));
  assert.ok(manualMergePlexIdentityAliasSmokeSource.includes('/api/media/import-plex?sync=1'));
  assert.ok(manualMergePlexIdentityAliasSmokeSource.includes("buildMediaIdentityAliasKey('plexGuid'"));
  assert.ok(manualMergePlexIdentityAliasSmokeSource.includes("buildMediaIdentityAliasKey('plexItemKey'"));
  assert.ok(manualMergePlexIdentityAliasSmokeSource.includes('Imported from Plex section 1'));
  assert.ok(helpReleasesSmokeSource.includes('/api/support/releases?limit=5'));
  assert.ok(helpReleasesSmokeSource.includes('EXPECTED_VERSION'));
  assert.ok(helpReleasesSmokeSource.includes('foundExpectedVersion'));
  assert.ok(manualMergeRecommendationsSmokeSource.includes('/api/media/merge-recommendations'));
  assert.ok(comicDuplicateCandidatesSmokeSource.includes('/api/media/comics/duplicate-candidates'));
  assert.ok(manualMergeRecommendationRejectSmokeSource.includes('/api/media/merge-recommendations/reject'));
  assert.ok(manualMergeRecommendationRestoreSmokeSource.includes('/api/media/merge-recommendations/history'));
  assert.ok(manualMergeRecommendationRestoreSmokeSource.includes('/api/media/merge-recommendations/restore'));
  assert.ok(comicDuplicateDeferSmokeSource.includes('/api/media/merge-recommendations/defer'));
  assert.ok(collectionDuplicatePreviewSmokeSource.includes('/api/media/collections/duplicate-preview'));
  assert.ok(collectionMergeApplyRevertSmokeSource.includes('/api/media/collections/merge-apply'));
  assert.ok(collectionMergeApplyRevertSmokeSource.includes('/api/media/collections/merge-revert'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('/api/media/collections/merge-apply'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('/api/media/import-csv?sync=1'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('aliasStored'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('scopedCollectionCount'));
  assert.ok(manualMergePreviewSmokeSource.includes('Matched on ISBN'));
  assert.ok(manualMergePreviewSmokeSource.includes('Cross-type merges are not allowed'));
  assert.ok(manualMergeApplySmokeSource.includes('manual_merge'));
  assert.ok(manualMergeApplySmokeSource.includes('activeMergeCount'));
  assert.ok(manualMergeRevertSmokeSource.includes('Expected manual merge revert to succeed'));
  assert.ok(manualMergeRevertSmokeSource.includes('restoredDuplicateId'));
  assert.ok(manualMergeApplySmokeSource.includes('Expected preview to show merged format ownership'));
  assert.ok(manualMergeApplySmokeSource.includes('Expected canonical row to keep both owned formats after merge apply'));
  assert.ok(manualMergeRecommendationsSmokeSource.includes('Matched on title and year'));
  assert.ok(manualMergeRecommendationsSmokeSource.includes('Mystery Science Theater 3000, Vol. XIV'));
  assert.ok(manualMergeRecommendationsSmokeSource.includes('franchise volume titles to stay out of the recommendation queue'));
  assert.ok(comicDuplicateCandidatesSmokeSource.includes('Expected safe Alpha Flight duplicate group to be surfaced'));
  assert.ok(comicDuplicateCandidatesSmokeSource.includes('Expected broken Dark Avengers / Uncanny X-Men cluster to be suppressed'));
  assert.ok(manualMergeRecommendationRejectSmokeSource.includes('rejectedPairRemoved'));
  assert.ok(manualMergeRecommendationRejectSmokeSource.includes('feedbackOutcome'));
  assert.ok(manualMergeRecommendationRejectSmokeSource.includes('feedbackReasonCode'));
  assert.ok(manualMergeRecommendationRestoreSmokeSource.includes('recommendationReturned'));
  assert.ok(manualMergeRecommendationRestoreSmokeSource.includes('removedFromHistory'));
  assert.ok(comicDuplicateDeferSmokeSource.includes('deferredPairRemovedFromRecommendations'));
  assert.ok(comicDuplicateDeferSmokeSource.includes('deferredPairRemovedFromComicCandidates'));
  assert.ok(collectionDuplicatePreviewSmokeSource.includes('Matched on collection name and expected item count'));
  assert.ok(collectionDuplicatePreviewSmokeSource.includes('Expected duplicate collection preview to be allowed'));
  assert.ok(collectionMergeApplyRevertSmokeSource.includes('Expected collection merge apply to succeed'));
  assert.ok(collectionMergeApplyRevertSmokeSource.includes('Expected duplicate collection to be restored with two items after revert'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('Expected re-sync to avoid recreating a duplicate collection'));
  assert.ok(collectionResyncBoundarySmokeSource.includes('Expected later collection-shaped re-sync to land a new contained item on the canonical collection'));
}));

results.push(run('LibraryView renders distinct OPDS browse and download actions without leaking TMDB labels for books', () => {
  assert.ok(libraryViewSource.includes('calibre_download_url'));
  assert.ok(libraryViewSource.includes('provider_download_url'));
  assert.ok(libraryViewSource.includes('Download EPUB'));
  assert.ok(libraryViewSource.includes('Download from Calibre'));
  assert.ok(libraryViewSource.includes('Read in Calibre'));
}));

results.push(run('LibraryView renders compact lookup thumbnails for provider search matches', () => {
  assert.ok(libraryViewSource.includes('const resolveLookupThumbnailPath = (match) => ('));
  assert.ok(libraryViewSource.includes("aria-label=\"Search result thumbnail\""));
  assert.ok(libraryViewSource.includes('const thumbnailSrc = posterUrl(resolveLookupThumbnailPath(m));'));
  assert.ok(libraryViewSource.includes("className=\"relative mt-0.5 h-16 w-11 shrink-0 overflow-hidden rounded-[4px] border border-edge/70 bg-panel\""));
}));

results.push(run('LibraryView keeps a detail header band when media items only have cover art', () => {
  assert.ok(appPrimitivesSource.includes('export function DrawerBackdrop'));
  assert.ok(appPrimitivesSource.includes('const imageSrc = posterUrl(imagePath);'));
  assert.ok(appPrimitivesSource.includes('renderWhenEmpty = false'));
  assert.ok(libraryViewSource.includes('imagePath={item.backdrop_path || item.poster_path}'));
  assert.ok(libraryViewSource.includes('testId="media-detail-backdrop"'));
  assert.ok(libraryViewSource.includes('renderWhenEmpty'));
  assert.ok(libraryViewSource.includes('className="h-48 border-b border-edge/60 bg-panel"'));
  assert.ok(artViewSource.includes('<DrawerBackdrop imagePath={item?.image_path} className="h-32 sm:h-44 md:h-48" />'));
  assert.ok(eventsViewSource.includes('<DrawerBackdrop imagePath={event?.image_path} className="h-48" />'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes('<DrawerBackdrop imagePath={item?.image_path} className="h-48" />'));
  assert.ok(!libraryViewSource.includes('{posterUrl(item.backdrop_path) && ('));
}));

results.push(run('detail drawers share the standard shell and mobile density spacing', () => {
  const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
  assert.ok(appPrimitivesSource.includes('export function DetailDrawerShell'));
  assert.ok(appPrimitivesSource.includes("className=\"absolute inset-0 bg-void/72\""));
  assert.ok(appPrimitivesSource.includes("'relative ml-auto h-full w-full bg-abyss border-l border-edge flex flex-col animate-slide-in'"));
  assert.ok(libraryViewSource.includes('<DetailDrawerShell onClose={onClose} panelClassName={isBook ? \'max-w-2xl\' : \'max-w-xl\'} testId="media-detail-drawer">'));
  assert.ok(artViewSource.includes('<DetailDrawerShell onClose={onClose} testId="art-detail-drawer">'));
  assert.ok(collectiblesViewSource.includes('<DetailDrawerShell onClose={onClose} testId="collectible-detail-drawer">'));
  assert.ok(eventsViewSource.includes('<DetailDrawerShell onClose={onClose} testId="event-detail-drawer">'));
  assert.ok(libraryViewSource.includes('px-4 pt-4 pb-3 shrink-0 sm:px-6 sm:pt-6 sm:pb-4'));
  assert.ok(collectiblesViewSource.includes('p-4 space-y-4 sm:p-6 sm:space-y-5'));
  assert.ok(eventsViewSource.includes('p-4 space-y-4 sm:p-6 sm:space-y-5'));
}));

results.push(run('repo includes local release preflight helper coverage for dependency audits and go-no-go reporting', () => {
  assert.ok(backendPackageJson.scripts['test:release-preflight-local']);
  assert.ok(releasePreflightLocalSource.includes("artifacts', 'dependency-audit'"));
  assert.ok(releasePreflightLocalSource.includes('preflight-go-no-go.md'));
  assert.ok(releasePreflightLocalSource.includes('Compose smoke basics'));
  assert.ok(releasePreflightLocalSource.includes('Secret scan'));
  assert.ok(releasePreflightLocalSource.includes('RELEASE_PREFLIGHT_RUN_BROWSER'));
  assert.ok(releasePreflightLocalSource.includes('Browser regression'));
  assert.ok(releasePreflightLocalSource.includes('test:browser'));
  assert.ok(releasePreflightLocalSource.includes('Image security and SBOM'));
  assert.ok(releasePreflightLocalSource.includes('test:integration-smoke'));
  assert.ok(releasePreflightLocalSource.includes('/api/auth/csrf-token'));
  assert.ok(releasePreflightLocalSource.includes('/api/auth/me'));
  assert.ok(releasePreflightLocalSource.includes('npm audit'));
}));

results.push(run('repo includes merge evidence backfill tooling for older duplicate attach history rows', () => {
  assert.ok(backendPackageJson.scripts['test:backfill-merge-evidence']);
  assert.ok(backendPackageJson.scripts['repair:backfill-merge-evidence']);
  assert.ok(backfillMergeEvidenceSource.includes("context->'mergeEvidence'"));
  assert.ok(backfillMergeEvidenceSource.includes('buildPersistedMergeEvidence'));
  assert.ok(backfillMergeEvidenceSource.includes('updated_at = NOW()'));
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

results.push(run('media drawer avoids redundant follow-up title lookups for enriched identifier results', () => {
  assert.ok(libraryViewSource.includes('const enrichIdentifierSelection = async (match) => {'));
  assert.ok(libraryViewSource.includes('if (match?.tmdb || match?.book || match?.typeEnrichment)'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('titleLookupCount'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('expect(titleLookupCount).toBe(1)'));
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

results.push(run('scope.resolveScopeContext prefers internal scopeSpaceId before activeSpaceId', () => {
  const req = {
    user: { scopeSpaceId: 12, activeSpaceId: 4, activeLibraryId: 10 }
  };
  const scope = resolveScopeContext(req);
  assert.deepStrictEqual(scope, { spaceId: 12, libraryId: 10 });
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
    isbn: '978-0-316-76948-8',
    ean_upc: '0 12345 67890 5',
    asin: 'https://www.amazon.com/dp/B00005NZ1G'
  });
  assert.strictEqual(out.isbn, '9780316769488');
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
    provider_download_url: 'https://cwa.example/downloads/abc-123.epub',
    calibre_entry_id: 'urn:uuid:abc-123',
    calibre_external_url: 'https://cwa.example/books/abc-123',
    calibre_download_url: 'https://cwa.example/downloads/abc-123.epub'
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, []);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.value, {
    author: 'Alan Moore',
    provider_name: 'cwa_opds',
    provider_item_id: 'urn:uuid:abc-123',
    provider_external_url: 'https://cwa.example/books/abc-123',
    provider_download_url: 'https://cwa.example/downloads/abc-123.epub',
    calibre_entry_id: 'urn:uuid:abc-123',
    calibre_external_url: 'https://cwa.example/books/abc-123',
    calibre_download_url: 'https://cwa.example/downloads/abc-123.epub'
  });
}));

results.push(run('cwa.normalizeOpdsEntry separates browse and download links without misusing tmdb_url', () => {
  const normalized = normalizeOpdsEntry({
    id: 'urn:uuid:opds-entry-1',
    title: 'OPDS Contract Smoke Book',
    author: { name: 'Contract Smoke Author' },
    identifier: '9781476735402',
    published: '2021-09-15',
    summary: 'Contract smoke summary',
    link: [
      { '@_rel': 'alternate', '@_type': 'text/html', '@_href': '/books/opds-entry-1' },
      { '@_rel': 'http://opds-spec.org/acquisition', '@_type': 'application/epub+zip', '@_href': '/download/opds-entry-1.epub' }
    ]
  }, 'https://cwa.example/opds/books');

  assert.strictEqual(normalized.tmdb_url, null);
  assert.strictEqual(normalized.external_url, 'https://cwa.example/books/opds-entry-1');
  assert.strictEqual(normalized.type_details.provider_external_url, 'https://cwa.example/books/opds-entry-1');
  assert.strictEqual(normalized.type_details.provider_download_url, 'https://cwa.example/download/opds-entry-1.epub');
  assert.strictEqual(normalized.type_details.calibre_external_url, 'https://cwa.example/books/opds-entry-1');
  assert.strictEqual(normalized.type_details.calibre_download_url, 'https://cwa.example/download/opds-entry-1.epub');
}));

results.push(run('generic import mapping keeps OPDS external urls out of tmdb_url for books and preserves download links', () => {
  assert.ok(mediaRoutesSource.includes("['movie', 'tv_series', 'tv_episode'].includes(mappedMediaType) ? value('external_url') : null"));
  assert.ok(mediaRoutesSource.includes("provider_download_url: value('provider_download_url')"));
  assert.ok(mediaRoutesSource.includes("calibre_download_url: value('calibre_download_url')"));
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

results.push(run('valuations.buildPriceChartingRateLimitPolicy enforces serialized provider safety floor', () => {
  const policy = buildPriceChartingRateLimitPolicy({ priceChartingRateLimitMs: 250 });
  assert.strictEqual(policy.provider, 'pricecharting');
  assert.strictEqual(policy.queueMode, 'serialized');
  assert.strictEqual(policy.concurrency, 1);
  assert.strictEqual(policy.minIntervalMs, MIN_PRICECHARTING_INTERVAL_MS);
  assert.strictEqual(policy.automatedTesting, 'fixture_only');
}));

results.push(run('valuations.buildValuationLookupInput prefers identifiers before title fallback', () => {
  const input = buildValuationLookupInput({
    title: 'Halo',
    original_title: 'Halo: Combat Evolved',
    media_type: 'game',
    upc: '885370541981',
    type_details: {
      asin: 'B000B6MLPU',
      series: 'Halo'
    }
  });
  assert.deepStrictEqual(input.identifierSequence, [
    { kind: 'ean_upc', value: '885370541981' },
    { kind: 'asin', value: 'B000B6MLPU' }
  ]);
  assert.ok(input.titleCandidates.includes('Halo'));
  assert.ok(input.titleCandidates.includes('Halo: Combat Evolved'));
}));

results.push(run('valuations.extractEbayBrowseValuation derives low mid high from live listing samples', () => {
  const extracted = extractEbayBrowseValuation({
    itemSummaries: [
      { itemId: 'a', title: 'Chrono Trigger', price: { value: '49.99', currency: 'USD' } },
      { itemId: 'b', title: 'Chrono Trigger', price: { value: '59.99', currency: 'USD' } },
      { itemId: 'c', title: 'Chrono Trigger', price: { value: '79.99', currency: 'USD' } }
    ]
  });

  assert.deepStrictEqual(extracted, {
    low: 49.99,
    mid: 59.99,
    high: 79.99,
    currency: 'USD',
    source: 'eBay Browse',
    sampleSize: 3,
    sampleTitles: ['Chrono Trigger', 'Chrono Trigger', 'Chrono Trigger'],
    itemIds: ['a', 'b', 'c']
  });
}));

results.push(run('valuations.deriveEbayTokenUrl switches to sandbox identity for sandbox browse urls', () => {
  assert.strictEqual(
    deriveEbayTokenUrl('https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'),
    'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
  );
  assert.strictEqual(
    deriveEbayTokenUrl('https://api.ebay.com/buy/browse/v1/item_summary/search'),
    'https://api.ebay.com/identity/v1/oauth2/token'
  );
}));

results.push(run('valuations.buildEbayKeywordCandidate includes year when present', () => {
  assert.strictEqual(buildEbayKeywordCandidate('Halo', 2001), 'Halo 2001');
  assert.strictEqual(buildEbayKeywordCandidate('Halo', null), 'Halo');
}));

results.push(run('valuations.refreshMediaValuation falls back to eBay Browse after a PriceCharting no-match', async () => {
  const requests = [];
  const httpClient = {
    async get(url, options = {}) {
      requests.push({ url, params: options.params || null, headers: options.headers || null });
      if (String(url).includes('pricecharting.com')) {
        return { status: 200, data: {} };
      }
      return {
        status: 200,
        data: {
          itemSummaries: [
            { itemId: 'ebay-1', title: 'Halo 2001', price: { value: '24.99', currency: 'USD' } },
            { itemId: 'ebay-2', title: 'Halo 2001', price: { value: '34.99', currency: 'USD' } },
            { itemId: 'ebay-3', title: 'Halo 2001', price: { value: '44.99', currency: 'USD' } }
          ]
        }
      };
    },
    async post() {
      return {
        status: 200,
        data: {
          access_token: 'ebay-token',
          expires_in: 7200
        }
      };
    }
  };

  const outcome = await refreshMediaValuation(
    {
      id: 41,
      title: 'Halo',
      media_type: 'game',
      year: 2001,
      upc: '885370541981'
    },
    {
      priceChartingEnabled: true,
      priceChartingApiKey: 'pc-key',
      priceChartingApiUrl: 'https://www.pricecharting.com/api',
      priceChartingRateLimitMs: 1100,
      eBayBrowseEnabled: true,
      eBayBrowseApiUrl: 'https://api.ebay.com/buy/browse/v1/item_summary/search',
      eBayBrowseClientId: 'ebay-client',
      eBayBrowseClientSecret: 'ebay-secret',
      eBayBrowseMarketplaceId: 'EBAY_US'
    },
    { httpClient }
  );

  assert.strictEqual(outcome.provider, 'ebay_browse');
  assert.strictEqual(outcome.matched, true);
  assert.strictEqual(outcome.fixture, false);
  assert.strictEqual(outcome.valuation.source, 'eBay Browse');
  assert.deepStrictEqual(
    requests.map((entry) => entry.params && Object.keys(entry.params).sort()),
    [['t', 'upc'], ['q', 't'], ['gtin', 'limit']]
  );
}));

results.push(run('observability runtime source includes log and metrics drift diagnosis', () => {
  assert.ok(observabilityRuntimeSource.includes("getFeatureFlag('external_log_export_enabled')"));
  assert.ok(observabilityRuntimeSource.includes("getFeatureFlag('metrics_enabled')"));
  assert.ok(observabilityRuntimeSource.includes("config.backend === 'off'"));
  assert.ok(observabilityRuntimeSource.includes('DEFAULT_LOG_HOSTS'));
  assert.ok(observabilityRuntimeSource.includes('METRICS_SCRAPE_TOKEN'));
  assert.ok(observabilityRuntimeSource.includes('DEBUG_LEVEL < 1'));
  assert.ok(observabilityRuntimeSource.includes('TRUST_PROXY'));
  assert.ok(observabilityRuntimeSource.includes('Scrape token looks weak'));
  assert.ok(observabilityRuntimeSource.includes('Exporter debug tracing is on'));
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

results.push(run('media route source prevents sync jobs and collections routes from being shadowed by generic media ids', () => {
  assert.ok(mediaRoutesSource.includes("router.get('/sync-jobs'"));
  assert.ok(mediaRoutesSource.includes("router.get('/collections'"));
  assert.ok(mediaRoutesSource.includes("return next();"));
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
  assert.ok(spec.paths['/api/auth/register']);
  assert.ok(spec.paths['/api/auth/config']);
  assert.ok(spec.paths['/api/auth/email-verification/request']);
  assert.ok(spec.paths['/api/auth/email-verification/consume']);
  assert.ok(spec.paths['/api/auth/password-reset/request']);
  assert.ok(spec.paths['/api/auth/password-reset/consume']);
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
  assert.ok(spec.paths['/api/admin/loan-reminder-operations']);
  assert.ok(spec.components.schemas.LoanReminderOperationsResponse);
  assert.ok(spec.components.schemas.AutomaticLoanReminderRunRecord);
  assert.ok(spec.components.schemas.AutomaticLoanReminderFailureRecord);
  assert.ok(!spec.paths['/api/admin/invites']);
  assert.ok(spec.paths['/api/docs']);
  assert.ok(spec.paths['/api/docs/openapi.json']);
  assert.ok(spec.paths['/api/metrics']);
  assert.ok(spec.paths['/api/media']);
  assert.ok(spec.paths['/api/media/loans']);
  assert.ok(spec.paths['/api/media/loans/{loanId}']);
  assert.ok(spec.paths['/api/media/loans/{loanId}/return']);
  assert.ok(spec.paths['/api/media/loans/{loanId}/reminder']);
  assert.ok(spec.paths['/api/media/{id}/loans']);
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
  assert.ok(spec.components.schemas.MediaLoanRecord);
  assert.ok(spec.components.schemas.MediaLoanListResponse);
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
  assert.ok(authRoutesSource.includes("platformRouter.get('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("platformRouter.post('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/service-account-keys/:id'"));
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
  assert.ok(authSource.includes("process.env.SESSION_COOKIE_NAME || 'session_token'"));
  assert.ok(authSource.includes("process.env.CSRF_COOKIE_NAME || 'csrf_token'"));
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

results.push(run('public compose source keeps homelab-safe cookie defaults in the single tracked stack', () => {
  assert.ok(dockerComposeSource.includes('SESSION_COOKIE_NAME: ${SESSION_COOKIE_NAME:-session_token}'));
  assert.ok(dockerComposeSource.includes('CSRF_COOKIE_NAME: ${CSRF_COOKIE_NAME:-csrf_token}'));
  assert.ok(!dockerComposeSource.includes('session_token_homelab'));
  assert.ok(!dockerComposeSource.includes('csrf_token_homelab'));
  assert.ok(frontendDockerfileSource.includes('ARG REACT_APP_CSRF_COOKIE_NAME=csrf_token'));
  assert.ok(frontendDockerfileSource.includes('ARG VITE_CSRF_COOKIE_NAME=csrf_token'));
  assert.ok(frontendViteConfigSource.includes("const csrfCookieName = env.VITE_CSRF_COOKIE_NAME || env.REACT_APP_CSRF_COOKIE_NAME || 'csrf_token';"));
  assert.ok(useApiClientSource.includes("readFrontendEnv('VITE_CSRF_COOKIE_NAME', 'REACT_APP_CSRF_COOKIE_NAME', 'csrf_token')"));
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
  assert.deepStrictEqual(
    getRequiredPatScopesForRequest({ originalUrl: '/api/art/14', method: 'PATCH' }),
    ['collectibles:write']
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

results.push(run('auth routes expose public password reset request and consume endpoints', () => {
  const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
  assert.ok(authRoutesSource.includes("router.post('/password-reset/request'"));
  assert.ok(authRoutesSource.includes("router.post('/password-reset/consume'"));
  assert.ok(authRoutesSource.includes("sendPasswordResetEmail"));
  assert.ok(authRoutesSource.includes("issuePasswordResetToken"));
}));

results.push(run('auth routes expose public email verification request and consume endpoints', () => {
  const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
  const emailServiceSource = require('fs').readFileSync(require.resolve('../services/email'), 'utf8');
  assert.ok(authRoutesSource.includes("router.post('/email-verification/request'"));
  assert.ok(authRoutesSource.includes("router.post('/email-verification/consume'"));
  assert.ok(authRoutesSource.includes('issueEmailVerificationToken'));
  assert.ok(authRoutesSource.includes('email_verified = true'));
  assert.ok(authRoutesSource.includes('createPersonalWorkspaceForUser'));
  assert.ok(authRoutesSource.includes('workspace.create.personal'));
  assert.ok(emailServiceSource.includes('sendEmailVerificationEmail'));
}));

results.push(run('auth routes expose public auth config and self-registration flag gating', () => {
  const authRoutesSource = require('fs').readFileSync(require.resolve('../routes/auth'), 'utf8');
  const featureFlagsSource = require('fs').readFileSync(require.resolve('../services/featureFlags'), 'utf8');
  assert.ok(authRoutesSource.includes("router.get('/config'"));
  assert.ok(authRoutesSource.includes("isFeatureEnabled('self_registration_enabled', true)"));
  assert.ok(authRoutesSource.includes('email_verification_required'));
  assert.ok(authRoutesSource.includes('smtp_configured'));
  assert.ok(featureFlagsSource.includes('self_registration_enabled'));
}));

results.push(run('auth routes expose explicit scope bootstrap and selection endpoints', () => {
  assert.ok(authRoutesSource.includes("router.get('/scope', authenticateToken"));
  assert.ok(authRoutesSource.includes("router.post('/scope', authenticateToken, requireSessionAuth"));
  assert.ok(authRoutesSource.includes('resolvePersistedActiveSpaceId'));
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
  assert.ok(spacesRoutesSource.includes('invalidateUserSpaceAccess'));
  assert.ok(spacesRoutesSource.includes('clearPersistedScope: false'));
  assert.ok(spacesRoutesSource.includes("await logActivity(req, 'space.member.transfer_new_space'"));
}));

results.push(run('admin routes expose platform space control-plane endpoints', () => {
  assert.ok(adminRoutesSource.includes("platformRouter.get('/spaces'"));
  assert.ok(adminRoutesSource.includes("platformRouter.post('/spaces'"));
  assert.ok(adminRoutesSource.includes("platformRouter.patch('/spaces/:id/owner'"));
  assert.ok(adminRoutesSource.includes("platformRouter.patch('/spaces/:id/archive'"));
  assert.ok(adminRoutesSource.includes("platformRouter.delete('/spaces/:id'"));
  assert.ok(adminRoutesSource.includes("platformRouter.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(adminRoutesSource.includes("COUNT(*)::int AS membership_count"));
  assert.ok(adminRoutesSource.includes('FROM libraries l'));
  assert.ok(adminRoutesSource.includes('WHERE l.id = u.active_library_id'));
  assert.ok(adminRoutesSource.includes('AND l.space_id = $1'));
  assert.ok(adminRoutesSource.includes('UPDATE user_sessions s'));
  assert.ok(adminRoutesSource.includes('s.support_previous_space_id = $1'));
  assert.ok(!adminRoutesSource.includes('contributionScore'));
}));

results.push(run('library service source ensures default scope before returning default library', () => {
  assert.ok(libraryServiceSource.includes('async function ensureUserDefaultScope'));
  assert.ok(libraryServiceSource.includes('ensureDefaultSpaceForClient'));
  assert.ok(libraryServiceSource.includes('resolvePersistedActiveSpaceId'));
  assert.ok(libraryServiceSource.includes('SET active_space_id = $2,'));
  assert.ok(libraryServiceSource.includes('const activeLibrary = userRow.active_library_id'));
  assert.ok(libraryServiceSource.includes('if (!spaceId && activeLibrary) {'));
  assert.ok(libraryServiceSource.includes('let libraryId = activeLibrary && Number(activeLibrary.space_id || 0) === Number(spaceId || 0)'));
  assert.ok(libraryServiceSource.includes('AND suspended_at IS NULL'));
  assert.ok(libraryServiceSource.includes('async function syncLibraryMembershipsForSpaceUser'));
  assert.ok(libraryServiceSource.includes('const productEdition = getProductEdition();'));
  assert.ok(libraryServiceSource.includes('SELECT active_library_id'));
  assert.ok(libraryServiceSource.includes('const currentActiveLibraryId = Number(userScope.rows[0]?.active_library_id || 0) || null;'));
  assert.ok(libraryServiceSource.includes('WHERE id = $1\n           AND active_library_id IS NULL'));
  assert.ok(libraryServiceSource.includes('FROM users u'));
  assert.ok(libraryServiceSource.includes('async function findReplacementAccessibleLibrary'));
  assert.ok(libraryServiceSource.includes('async function repairUserStateAfterLibraryAccessLoss'));
  assert.ok(libraryServiceSource.includes('async function removeLibraryMembershipsForSpaceUser'));
  assert.ok(libraryServiceSource.includes('RETURNING lm.library_id'));
  assert.ok(libraryServiceSource.includes('support_space_id = CASE'));
  assert.ok(libraryServiceSource.includes('support_request_id = CASE'));
  assert.ok(libraryServiceSource.includes('support_previous_space_id = CASE'));
  assert.ok(libraryServiceSource.includes('await repairUserStateAfterLibraryAccessLoss(client, {'));
  assert.ok(libraryServiceSource.includes('async function moveOwnedLibrariesToSpace'));
  assert.ok(libraryServiceSource.includes('const affectedUsers = await client.query('));
  assert.ok(libraryServiceSource.includes('UPDATE user_sessions s'));
  assert.ok(libraryServiceSource.includes('await repairUserStateAfterLibraryAccessLoss(client, {'));
  assert.ok(libraryServiceSource.includes('const replacement = await findReplacementAccessibleLibrary(client, { userId: numericUserId });'));
  assert.ok(libraryServiceSource.includes('async function canUserAccessSpace'));
  assert.ok(libraryServiceSource.includes('async function getAccessibleLibraryRow'));
}));

results.push(run('spaces service source distinguishes global admin from space membership roles', () => {
  assert.ok(spacesServiceSource.includes("const SPACE_MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'];"));
  assert.ok(spacesServiceSource.includes("function isGlobalAdmin(userRole)"));
  assert.ok(spacesServiceSource.includes("function canAssignSpaceRole"));
  assert.ok(spacesServiceSource.includes('FROM space_memberships sm'));
  assert.ok(spacesServiceSource.includes('async function invalidateUserSpaceAccess'));
  assert.ok(spacesServiceSource.includes('support_space_id = CASE'));
  assert.ok(spacesServiceSource.includes('support_previous_space_id = CASE'));
  assert.ok(spacesServiceSource.includes('clearPersistedScope = true'));
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
  assert.ok(librariesRoutesSource.includes('repairUserStateAfterLibraryAccessLoss'));
  assert.ok(librariesRoutesSource.includes('removedLibraryIds: [libraryId]'));
  assert.ok(librariesRoutesSource.includes('fallbackToDefaultScope: true'));
}));

results.push(run('library routes shape /libraries payload from request scope instead of re-reading persisted user scope', () => {
  assert.ok(!librariesRoutesSource.includes('const userScopeResult = await pool.query('));
  assert.ok(librariesRoutesSource.includes('const activeSpaceId = Number(req.user.scopeSpaceId || req.user.activeSpaceId || 0) || null;'));
  assert.ok(librariesRoutesSource.includes('const resolvedActiveLibraryId = req.user.activeLibraryId || (libraries[0]?.id || null);'));
  assert.ok(librariesRoutesSource.includes('active_space_id: req.user.scopeSpaceId ?? req.user.activeSpaceId ?? (libraries[0]?.space_id || null),'));
}));

results.push(run('homelab edition helpers strip surfaced space context while preserving shared library flows', () => {
  const productEditionSource = require('fs').readFileSync(require.resolve('../config/productEdition'), 'utf8');
  assert.ok(productEditionSource.includes('function buildEditionContract('));
  assert.ok(productEditionSource.includes("library_model: 'single_library_household'"));
  assert.ok(productEditionSource.includes("additional_user_model: 'workspace_memberships'"));
  assert.ok(productEditionSource.includes('function stripHomelabSpaceContext('));
  assert.ok(productEditionSource.includes('active_space_id: null'));
  assert.ok(productEditionSource.includes('spaces: []'));
  assert.ok(productEditionSource.includes('function stripHomelabSpaceContextFromUser('));
  assert.ok(librariesRoutesSource.includes('stripHomelabSpaceContext({'));
}));

results.push(run('library routes keep shared library selection while retaining platform admin support-session safeguards', () => {
  assert.ok(librariesRoutesSource.includes("router.use('/libraries', authenticateToken);"));
  assert.ok(librariesRoutesSource.includes("router.use('/libraries', enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(librariesRoutesSource.includes("router.post('/libraries/select', requireSessionAuth"));
  assert.ok(librariesRoutesSource.includes("enforceScopeAccess({ allowedHintRoles: ['admin'] })"));
  assert.ok(scopeAccessSource.includes('const allowUserLibrarySelectHints = ('));
  assert.ok(scopeAccessSource.includes("isLibrarySelectPath"));
  assert.ok(scopeAccessSource.includes("role !== 'support_admin'"));
  assert.ok(scopeAccessSource.includes('&& !homelabEdition'));
  assert.ok(scopeAccessSource.includes('admin_support_session_required'));
  assert.ok(librariesRoutesSource.includes('SELECT user_id'));
  assert.ok(librariesRoutesSource.includes('syncLibraryMembershipsForSpaceUser'));
}));

results.push(run('library transfer source revokes previous owner membership on ownership change', () => {
  assert.ok(librariesRoutesSource.includes('DELETE FROM library_memberships'));
  assert.ok(librariesRoutesSource.includes('Number(target.created_by || 0) !== newOwnerUserId'));
  assert.ok(librariesRoutesSource.includes('const productEdition = getProductEdition();'));
  assert.ok(librariesRoutesSource.includes('repairUserStateAfterLibraryAccessLoss(pool, {'));
  assert.ok(librariesRoutesSource.includes('fallbackToDefaultScope: true'));
}));

results.push(run('spaces select route is session-auth only for active scope mutation', () => {
  assert.ok(spacesRoutesSource.includes("router.post('/spaces/select', requireSessionAuth"));
  assert.ok(spacesRoutesSource.includes('const productEdition = getProductEdition();'));
  assert.ok(spacesRoutesSource.includes('stripHomelabSpaceContext({'));
  assert.ok(spacesRoutesSource.includes('active_space_id: spaceId,'));
  assert.ok(spacesRoutesSource.includes('resolvePersistedActiveSpaceId(spaceId, productEdition)'));
  assert.ok(spacesRoutesSource.includes('resolvePersistedActiveSpaceId(newSpace.id, getProductEdition())'));
  assert.ok(spacesRoutesSource.includes('invalidateUserSpaceAccess'));
  assert.ok(spacesRoutesSource.includes('clearPersistedScope: false'));
}));

results.push(run('auth register flow applies scoped invite role before ensuring default scope', () => {
  assert.ok(authRoutesSource.includes("claimedInvite.space_role || 'member'"));
  assert.ok(authRoutesSource.includes('syncLibraryMembershipsForSpaceUser'));
}));

results.push(run('scope access source enforces explicit space membership for non-admin space-only access', () => {
  const scopeAccessSource = require('fs').readFileSync(require.resolve('../middleware/scopeAccess'), 'utf8');
  assert.ok(scopeAccessSource.includes('FROM space_memberships'));
  assert.ok(scopeAccessSource.includes('JOIN space_memberships sm'));
  assert.ok(scopeAccessSource.includes('sm.suspended_at IS NULL'));
  assert.ok(scopeAccessSource.includes('space_membership_required'));
  assert.ok(scopeAccessSource.includes('admin_support_session_required'));
  assert.ok(scopeAccessSource.includes('const isLibraryCreatePath = ('));
  assert.ok(scopeAccessSource.includes("String(req.method || '').toUpperCase() === 'POST'"));
  assert.ok(scopeAccessSource.includes('!isLibraryCreatePath'));
}));

results.push(run('token auth sources derive fallback scope from accessible libraries', () => {
  assert.ok(personalAccessTokenSource.includes('COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id)'));
  assert.ok(personalAccessTokenSource.includes('COALESCE(active_library.id, fallback_library.id) AS active_library_id'));
  assert.ok(sessionsServiceSource.includes('COALESCE(active_library.id, fallback_library.id) AS active_library_id'));
  assert.ok(serviceAccountKeySource.includes('COALESCE(active_library.space_id, owner.active_space_id, fallback_library.space_id)'));
  assert.ok(serviceAccountKeySource.includes('COALESCE(active_library.id, fallback_library.id) AS active_library_id'));
  assert.ok(sessionsServiceSource.includes('JOIN space_memberships sm'));
  assert.ok(personalAccessTokenSource.includes('JOIN space_memberships sm'));
  assert.ok(serviceAccountKeySource.includes('JOIN space_memberships sm'));
  assert.ok(sessionsServiceSource.includes('sm.suspended_at IS NULL'));
  assert.ok(personalAccessTokenSource.includes('sm.suspended_at IS NULL'));
  assert.ok(serviceAccountKeySource.includes('sm.suspended_at IS NULL'));
}));

results.push(run('frontend syncs active space alongside active library context', () => {
  assert.ok(frontendAppSource.includes('const nextActiveSpaceId = Number(payload?.active_space_id || 0) || null;'));
  assert.ok(frontendAppSource.includes("active_space_id: nextActiveSpaceId, active_library_id: nextActiveLibraryId"));
}));

results.push(run('frontend package and vite scaffold support the Vite-first build contract', () => {
  assert.strictEqual(frontendPackageJson.devDependencies.vite !== undefined, true);
  assert.strictEqual(frontendPackageJson.devDependencies['@vitejs/plugin-react'] !== undefined, true);
  assert.strictEqual(frontendPackageJson.devDependencies.esbuild !== undefined, true);
  assert.strictEqual(frontendPackageJson.devDependencies['react-scripts'], undefined);
  assert.strictEqual(frontendPackageJson.scripts.start, 'vite');
  assert.strictEqual(frontendPackageJson.scripts.build, 'vite build');
  assert.strictEqual(frontendPackageJson.scripts.preview, 'vite preview --host 0.0.0.0');
  assert.strictEqual(frontendPackageJson.scripts['dev:vite'], 'vite');
  assert.strictEqual(frontendPackageJson.scripts['build:vite'], 'vite build');
  assert.strictEqual(frontendPackageJson.scripts['start:cra'], undefined);
  assert.strictEqual(frontendPackageJson.scripts['build:cra'], undefined);
  assert.strictEqual(frontendPackageJson.scripts.test, undefined);
  assert.strictEqual(frontendPackageJson.scripts.eject, undefined);
  assert.ok(frontendViteConfigSource.includes('VITE_API_URL'));
  assert.ok(frontendEnvSource.includes('import.meta.env'));
  assert.ok(frontendAppSource.includes("readFrontendEnv('VITE_APP_VERSION', 'REACT_APP_VERSION'"));
  assert.ok(useApiClientSource.includes("readFrontendEnv('VITE_API_URL', 'REACT_APP_API_URL', '/api')"));
  assert.ok(frontendViteConfigSource.includes("'/api'"));
  assert.ok(frontendViteConfigSource.includes("'/uploads'"));
  assert.ok(frontendViteConfigSource.includes("outDir: 'dist'"));
  assert.ok(frontendViteIndexHtmlSource.includes('src="/src/main.jsx"'));
  assert.ok(frontendViteIndexHtmlSource.includes('<div id="root"></div>'));
  assert.ok(frontendDockerfileSource.includes('ARG VITE_API_URL=/api'));
  assert.ok(frontendDockerfileSource.indexOf('ARG VITE_API_URL=/api') < frontendDockerfileSource.indexOf('ARG REACT_APP_API_URL=/api'));
  assert.ok(frontendDockerfileSource.includes('RUN npm run build:vite'));
  assert.ok(frontendDockerfileSource.includes('COPY --from=builder /app/dist /usr/share/nginx/html'));
}));

results.push(run('dashboard content exposes dedicated admin spaces control plane tab', () => {
  assert.ok(dashboardContentSource.includes("case 'admin-spaces'"));
  assert.ok(dashboardContentSource.includes('AdminSpacesView'));
}));

results.push(run('dashboard shell exposes admin merge review as a dedicated operator tab', () => {
  assert.ok(dashboardRoutingSource.includes("'admin-merges'"));
  assert.ok(sidebarNavSource.includes("admin-merges"));
  assert.ok(sidebarNavSource.includes('Merge Review'));
  assert.ok(dashboardContentSource.includes("case 'admin-merges'"));
  assert.ok(dashboardContentSource.includes('AdminMergeReviewView'));
  assert.ok(productEditionFrontendSource.includes("allowed.add('admin-merges')"));
}));

results.push(run('loan reminder helpers distinguish due-soon versus overdue automation state', () => {
  const today = new Date().toISOString().slice(0, 10);
  const dueSoonDate = new Date(`${today}T00:00:00Z`);
  dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + 2);
  const overdueDate = new Date(`${today}T00:00:00Z`);
  overdueDate.setUTCDate(overdueDate.getUTCDate() - 1);

  const dueSoonLoan = {
    due_at: dueSoonDate.toISOString().slice(0, 10),
    borrower_email: 'due-soon@example.com',
    due_soon_reminder_last_sent_at: null,
    overdue_reminder_last_sent_at: null
  };
  const overdueLoan = {
    due_at: overdueDate.toISOString().slice(0, 10),
    borrower_email: 'overdue@example.com',
    due_soon_reminder_last_sent_at: null,
    overdue_reminder_last_sent_at: null
  };

  assert.strictEqual(buildLoanReminderPhase(dueSoonLoan), 'due_soon');
  assert.strictEqual(buildLoanReminderPhase(overdueLoan), 'overdue');
  assert.strictEqual(getLoanReminderTrackingField('due_soon'), 'due_soon_reminder_last_sent_at');
  assert.strictEqual(getLoanReminderTrackingField('overdue'), 'overdue_reminder_last_sent_at');
  assert.strictEqual(isAutomaticReminderEligible(dueSoonLoan), true);
  assert.strictEqual(isAutomaticReminderEligible(overdueLoan), true);

  const sentDueSoonLoan = {
    ...dueSoonLoan,
    due_soon_reminder_last_sent_at: new Date().toISOString()
  };
  const sentOverdueLoan = {
    ...overdueLoan,
    overdue_reminder_last_sent_at: new Date().toISOString()
  };

  assert.strictEqual(wasLoanReminderSentToday(sentDueSoonLoan, 'due_soon'), true);
  assert.strictEqual(wasLoanReminderSentToday(sentOverdueLoan, 'overdue'), true);
  assert.strictEqual(isAutomaticReminderEligible(sentDueSoonLoan), false);
  assert.strictEqual(isAutomaticReminderEligible(sentOverdueLoan), false);
}));

results.push(run('loan reminder helpers build stable delivery window keys by phase', () => {
  assert.strictEqual(buildLoanReminderDeliveryWindowKey({ due_at: '2026-04-30' }, 'due_soon'), 'due_soon:2026-04-30');
  assert.strictEqual(buildLoanReminderDeliveryWindowKey({ due_at: '2026-04-30' }, 'overdue'), `overdue:${new Date().toISOString().slice(0, 10)}`);
}));

results.push(run('library loans workflow is wired into dashboard navigation routes and media source', () => {
  assert.ok(dashboardRoutingSource.includes("'library-loans'"));
  assert.ok(productEditionFrontendSource.includes("'library-loans'"));
  assert.ok(sidebarNavSource.includes("library-loans"));
  assert.ok(sidebarNavSource.includes('label="Loans"'));
  assert.ok(dashboardContentSource.includes("case 'library-loans'"));
  assert.ok(dashboardContentSource.includes('LibraryLoansView'));
  assert.ok(libraryLoansViewSource.includes("/media/loans?${params.toString()}"));
  assert.ok(libraryLoansViewSource.includes("/media/loans/${loanId}/return"));
  assert.ok(libraryLoansViewSource.includes("/media/loans/${loan.id}/reminder"));
  assert.ok(libraryViewSource.includes("/media/${item.id}/loans"));
  assert.ok(libraryViewSource.includes("/media/${item.id}/loans`, loanForm"));
  assert.ok(mediaRoutesSource.includes("router.get('/loans'"));
  assert.ok(mediaRoutesSource.includes("router.get('/:id/loans'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/loans'"));
  assert.ok(mediaRoutesSource.includes("router.patch('/loans/:loanId/return'"));
  assert.ok(mediaRoutesSource.includes("router.post('/loans/:loanId/reminder'"));
  assert.ok(mediaRoutesSource.includes("router.post('/loan-reminders/run-auto'"));
  assert.ok(mediaRoutesSource.includes('loadLoanReminderEventsByLoanIds'));
  assert.ok(mediaRoutesSource.includes('reminder_events: reminderEventsByLoanId.get'));
  assert.ok(backendPackageJson.scripts['test:library-loans-workflow-smoke']);
  assert.ok(backendPackageJson.scripts['test:library-loan-reminder-workflow-smoke']);
  assert.ok(backendPackageJson.scripts['test:automatic-loan-reminders-smoke']);
}));

results.push(run('art library surface is promoted through shared collectible contracts without losing event linkage', () => {
  assert.ok(sidebarNavSource.includes("library-art"));
  assert.ok(sidebarNavSource.includes('label="Art"'));
  assert.ok(dashboardRoutingSource.includes("'library-art'"));
  assert.ok(dashboardContentSource.includes("case 'library-art'"));
  assert.ok(dashboardContentSource.includes('ArtView'));
  assert.ok(frontendAppSource.includes("activeTab === 'library-art'"));
  assert.ok(productEditionFrontendSource.includes("allowed.add('library-art')"));
  assert.ok(artViewSource.includes('export default function ArtView'));
  assert.ok(artViewSource.includes("api('get', `/art?${params.toString()}`)"));
  assert.ok(artViewSource.includes('ArtDetailDrawer'));
  assert.ok(artViewSource.includes('ArtDrawer'));
  assert.ok(openApiSource.includes('"/api/art"'));
  assert.ok(openApiSource.includes('"/api/art/{id}"'));
  assert.ok(openApiSource.includes('"ArtRecord"'));
  assert.ok(openApiSource.includes('"ArtUpsertRequest"'));
  assert.ok(openApiSource.includes('"series"'));
  assert.ok(openApiSource.includes('"vendor"'));
  assert.ok(openApiSource.includes('"booth"'));
  assert.ok(openApiSource.includes('"summary": "List art records in the active scope"'));
  assert.ok(collectiblesRoutesSource.includes("'/art'"));
  assert.ok(collectiblesRoutesSource.includes('Art items stay in the Art library'));
  assert.ok(collectiblesRoutesSource.includes('entityLabel'));
  assert.ok(collectiblesRoutesSource.includes('ADD COLUMN IF NOT EXISTS series') || migrationsSource.includes('version: 73'));
  assert.ok(libraryViewSource.includes('comic_series'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes('Series'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes('Vendor'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes('Booth'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes('COLLECTIBLE_CLASSIFICATIONS'));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes("categoryFilter === 'card'"));
  assert.ok(readFrontendSource(path.join('components', 'CollectiblesView')).includes("setForm((p) => ({ ...p, ...next }))"));
}));

results.push(run('native art schema and shared event purchased-item contract are wired for the 3.4.1 bridge phase', () => {
  assert.ok(migrationsSource.includes('version: 74'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS art_items'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_purchased_items'));
  assert.ok(migrationsSource.includes("item_type IN ('art', 'collectible')"));
  assert.ok(collectiblesRoutesSource.includes('upsertNativeArtFromCollectible'));
  assert.ok(collectiblesRoutesSource.includes('source_collectible_id'));
  assert.ok(collectiblesRoutesSource.includes('native_art_id'));
  assert.ok(collectiblesRoutesSource.includes('archiveNativeArtFromCollectible'));
  assert.ok(openApiSource.includes('"NativeArtRecord"'));
  assert.ok(openApiSource.includes('"EventPurchasedItemRecord"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/purchased-items"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/purchased-items/{purchasedItemId}"'));
  assert.ok(eventsRoutesSource.includes('/events/:id/purchased-items'));
  assert.ok(eventsRoutesSource.includes('events.purchased_item.create'));
  assert.ok(backendPackageJson.scripts['test:event-purchased-items-smoke']);
}));

results.push(run('event social planning foundation contract is wired for 3.4.30', () => {
  assert.ok(releaseRoadmapSource.includes('3.4.30 — Event Social Planning Foundation'));
  assert.ok(eventSocialPlanningFoundationSource.includes('Event social planning belongs in collectZ as event-scoped planning data'));
  assert.ok(eventSocialPlanningFoundationSource.includes('no real-time location sharing'));
  assert.ok(migrationsSource.includes('version: 84'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_attendees'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_groups'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_meetups'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_plans'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_attendees'));
  assert.ok(initSqlSource.includes("(84, 'Add event social planning foundation tables')"));
  assert.ok(validateMiddlewareSource.includes('eventAttendeeCreateSchema'));
  assert.ok(validateMiddlewareSource.includes('eventSchedulePlanCreateSchema'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/attendees'"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/groups'"));
  assert.ok(eventsRoutesSource.includes("router.patch('/events/:id/meetups/:meetupId'"));
  assert.ok(eventsRoutesSource.includes("router.delete('/events/:id/schedule-plans/:planId'"));
  assert.ok(openApiSource.includes('"/api/events/{id}/attendees"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/groups/{groupId}"'));
  assert.ok(openApiSource.includes('EventMeetupRecord'));
  assert.ok(openApiSource.includes('EventSchedulePlanRecord'));
  assert.ok(backendPackageJson.scripts['test:event-social-planning-smoke']);
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/attendees'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-plans'));
  assert.ok(eventsViewSource.includes('function EventSocialPlanningPanel'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/meetups'));
  assert.ok(eventsViewSource.includes('Social planning'));
}));

results.push(run('personal Sched ICS sync contract is wired for 3.4.31', () => {
  assert.ok(releaseRoadmapSource.includes('3.4.31 — Personal Sched ICS Sync Contract and Parser Spike'));
  assert.ok(personalSchedIcsSyncSource.includes('personal plan sync adapter'));
  assert.ok(personalSchedIcsSyncSource.includes('never returns the raw ICS URL'));
  assert.ok(migrationsSource.includes('version: 85'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_personal_ics_sources'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_personal_ics_sources'));
  assert.ok(initSqlSource.includes("(85, 'Add personal Sched ICS sources for event schedule plans')"));
  assert.ok(validateMiddlewareSource.includes('eventPersonalIcsSourceSchema'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/personal-ics-source'"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/personal-ics-source/sync'"));
  assert.ok(eventsRoutesSource.includes('events.personal_ics_source.sync.success'));
  assert.ok(schedIcsSyncSource.includes('function parseIcsEvents'));
  assert.ok(schedIcsSyncSource.includes('encryptSecret(feedUrl)'));
  assert.ok(schedIcsSyncSource.includes('source_type = $3'));
  assert.ok(schedIcsSyncSource.includes('source_categories'));
  assert.ok(migrationsSource.includes('Add richer personal ICS schedule detail fields'));
  assert.ok(initSqlSource.includes('source_url TEXT'));
  assert.ok(openApiSource.includes('EventPersonalIcsSourceRecord'));
  assert.ok(openApiSource.includes('\"/api/events/{id}/personal-ics-source\"'));
  assert.ok(openApiSource.includes('\"/api/events/{id}/personal-ics-source/sync\"'));
  assert.ok(backendPackageJson.scripts['test:event-personal-ics-sync-smoke']);
  assert.ok(eventPersonalIcsSyncSmokeSource.includes('startIcsServer'));
  assert.ok(eventPersonalIcsSyncSmokeSource.includes('urlLeaked: false'));
  assert.ok(eventsViewSource.includes('Personal Sched ICS'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/personal-ics-source/sync'));
}));

results.push(run('personal Sched ICS parser preserves categories urls and readable descriptions', () => {
  const [item] = parseIcsEvents(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:sched-1
SUMMARY:Spotlight on Jim Lee
DESCRIPTION:World-renowned artist &amp; publisher\\nSketches live.
CATEGORIES:Comics, Art ,Comics
URL:https://example.test/session/spotlight
DTSTART:20250724T194500Z
DTEND:20250724T204500Z
DTSTAMP:20250701T120000Z
SEQUENCE:3
END:VEVENT
END:VCALENDAR`);

  assert.strictEqual(item.title, 'Spotlight on Jim Lee');
  assert.deepStrictEqual(item.source_categories, ['Comics', 'Art']);
  assert.strictEqual(item.source_url, 'https://example.test/session/spotlight');
  assert.strictEqual(item.source_sequence, 3);
  assert.strictEqual(item.source_updated_at, '2025-07-01T12:00:00.000Z');
  assert.ok(item.notes.includes('artist & publisher'));
}));

results.push(run('personal Sched ICS fetch sends provider-friendly calendar headers', async () => {
  const calls = [];
  const text = await fetchIcsText('https://example.test/personal.ics', async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR'
    };
  });

  assert.strictEqual(text.includes('BEGIN:VCALENDAR'), true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.headers['User-Agent'], ICS_FETCH_USER_AGENT);
  assert.ok(calls[0].options.headers.Accept.includes('text/calendar'));
}));

results.push(run('native art migration and shared event purchase backfill are wired for the 3.4.2 migration phase', () => {
  assert.ok(migrationsSource.includes('version: 75'));
  assert.ok(migrationsSource.includes('Backfill native art rows and shared event purchased item links'));
  assert.ok(migrationsSource.includes("WHERE c.subtype = 'art'"));
  assert.ok(migrationsSource.includes("COALESCE(NULLIF(c.vendor, ''), NULLIF(c.booth_or_vendor, ''))"));
  assert.ok(migrationsSource.includes('INSERT INTO event_purchased_items'));
  assert.ok(migrationsSource.includes("AND epi.item_type = 'art'"));
  assert.ok(initSqlSource.includes("(75, 'Backfill native art rows and shared event purchased item links')"));
  assert.ok(backendPackageJson.scripts['test:art-migration-backfill-smoke']);
  assert.ok(artMigrationBackfillSmokeSource.includes('backfillMigration.up'));
}));

results.push(run('native art read cutover and event purchase readback are wired for the 3.4.3 read phase', () => {
  assert.ok(collectiblesRoutesSource.includes('serializeNativeArtRow'));
  assert.ok(collectiblesRoutesSource.includes('buildNativeArtSelect'));
  assert.ok(collectiblesRoutesSource.includes('FROM art_items a'));
  assert.ok(collectiblesRoutesSource.includes('LEFT JOIN LATERAL'));
  assert.ok(collectiblesRoutesSource.includes('event_purchased_items'));
  assert.ok(collectiblesRoutesSource.includes('source_collectible_id'));
  assert.ok(collectiblesRoutesSource.includes('purchased_item_id'));
  assert.ok(eventsViewSource.includes('EventPurchasedItemsReadback'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/purchased-items'));
  assert.ok(eventsViewSource.includes('resolved_item'));
  assert.ok(eventsViewSource.includes('Link item'));
  assert.ok(eventsViewSource.includes("searchType === 'art' ? '/art' : '/collectibles'"));
  assert.ok(eventsViewSource.includes('That item is already linked to this event.'));
  assert.ok(eventsViewSource.includes('Purchase details saved'));
  assert.ok(artViewSource.includes('hasPurchaseContext'));
  assert.ok(artViewSource.includes('const record = item || {};'));
  assert.ok(artViewSource.includes("api('patch', `/art/${editing.id}`, payload)"));
  assert.ok(backendPackageJson.scripts['test:native-art-read-cutover-smoke']);
  assert.ok(nativeArtReadCutoverSmokeSource.includes('/api/art?q=Bast&series=Croyance&vendor=Studio&booth=A12&exclusive=true'));
  assert.ok(nativeArtReadCutoverSmokeSource.includes('/api/art/${nativeArtPublicId}'));
  assert.ok(nativeArtReadCutoverSmokeSource.includes('purchased_item_id'));
}));

results.push(run('art ui divergence keeps Art out of the Collectibles component for the 3.4.4 product split', () => {
  const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
  assert.ok(artViewSource.includes('function ArtDrawer'));
  assert.ok(artViewSource.includes('function ArtDetailDrawer'));
  assert.ok(artViewSource.includes("api('get', `/art?${params.toString()}`)"));
  assert.ok(artViewSource.includes("api('post', '/art', payload)"));
  assert.ok(artViewSource.includes("api('delete', `/art/${id}`)"));
  assert.ok(artViewSource.includes('hasPurchaseContext'));
  assert.ok(!artViewSource.includes('CollectiblesView'));
  assert.ok(validateMiddlewareSource.includes('const artBaseSchema'));
  assert.ok(collectiblesRoutesSource.includes("router.post('/art', validate(artCreateSchema), createArt)"));
  assert.ok(collectiblesRoutesSource.includes("router.patch('/art/:id', validate(artUpdateSchema), updateArt)"));
  assert.ok(collectiblesRoutesSource.includes("router.get('/collectibles/categories'"));
  assert.ok(collectiblesRoutesSource.includes("router.get('/art/categories'"));
  assert.ok(collectiblesRoutesSource.includes('Art categories are not available'));
  assert.ok(!openApiSource.includes('"/api/art/categories"'));
  assert.ok(!openApiSource.includes('"ArtCategoriesResponse"'));
  assert.ok(collectiblesRoutesSource.includes("COALESCE(c.subtype, c.item_type, 'collectible') <> '${ART_SUBTYPE}'"));
  assert.ok(collectiblesRoutesSource.includes('Use the Art library for art records'));
  assert.ok(!collectiblesViewSource.includes('VIEW_VARIANTS'));
  assert.ok(!collectiblesViewSource.includes('mode="art"'));
  assert.ok(!collectiblesViewSource.includes("lockedSubtype: 'art'"));
  assert.ok(!collectiblesViewSource.includes("apiBasePath: '/art'"));
}));

results.push(run('collectibles taxonomy cleanup and art medium boundary are wired for the 3.4.5 split', () => {
  const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
  assert.ok(artViewSource.includes('ART_MEDIUM_OPTIONS'));
  assert.ok(artViewSource.includes("'comic_panel'"));
  assert.ok(artViewSource.includes('Medium / Type'));
  assert.ok(artViewSource.includes('Signed'));
  assert.ok(artViewSource.includes('signed: Boolean(form.signed)'));
  assert.ok(!collectiblesViewSource.includes("{ key: 'comic_panels'"));
  assert.ok(!collectiblesViewSource.includes("{ key: 'anime'"));
  assert.ok(collectiblesViewSource.includes("{ value: 'card', label: 'Card'"));
  assert.ok(validateMiddlewareSource.includes('const artMediumValues'));
  assert.ok(validateMiddlewareSource.includes('signed: z.boolean().optional().nullable()'));
  assert.ok(collectiblesRoutesSource.includes('ACTIVE_COLLECTIBLE_CATEGORY_KEYS'));
  assert.ok(collectiblesRoutesSource.includes('medium: row.medium || null'));
  assert.ok(collectiblesRoutesSource.includes('signed: row.signed === true'));
  assert.ok(migrationsSource.includes('version: 76'));
  assert.ok(migrationsSource.includes('Add art medium and signed fields with comic panel migration boundary'));
  assert.ok(migrationsSource.includes("medium = 'comic_panel'"));
  assert.ok(migrationsSource.includes("category_key = 'comic_panels'"));
  assert.ok(initSqlSource.includes('medium VARCHAR(50)'));
  assert.ok(initSqlSource.includes('signed BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(initSqlSource.includes("(76, 'Add art medium and signed fields with comic panel migration boundary')"));
  assert.ok(openApiSource.includes('"medium"'));
  assert.ok(openApiSource.includes('"signed"'));
}));

results.push(run('fandom franchise metadata is shared by Art and Collectibles without taxonomy drift', () => {
  const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
  assert.ok(migrationsSource.includes('version: 77'));
  assert.ok(migrationsSource.includes('Add shared fandom franchise metadata to Art and Collectibles'));
  assert.ok(initSqlSource.includes('franchise VARCHAR(255)'));
  assert.ok(initSqlSource.includes('idx_collectibles_franchise'));
  assert.ok(initSqlSource.includes('idx_art_items_franchise'));
  assert.ok(validateMiddlewareSource.includes('franchise: z.preprocess(emptyStringToNull'));
  assert.ok(collectiblesRoutesSource.includes('COALESCE(a.franchise'));
  assert.ok(collectiblesRoutesSource.includes('COALESCE(c.franchise'));
  assert.ok(artViewSource.includes('Fandom / Franchise'));
  assert.ok(collectiblesViewSource.includes('Fandom / Franchise'));
  assert.ok(eventsViewSource.includes('candidate.franchise'));
  assert.ok(openApiSource.includes('"franchise"'));
}));

results.push(run('collectibles naming decision keeps fandom as metadata instead of a library rename', () => {
  assert.ok(collectiblesNamingDecisionSource.includes('Keep the library name `Collectibles` for now.'));
  assert.ok(collectiblesNamingDecisionSource.includes('Do not rename the library to `Fandom`'));
  assert.ok(collectiblesNamingDecisionSource.includes('`Fandom / Franchise` is metadata, not taxonomy.'));
  assert.ok(collectiblesNamingDecisionSource.includes('Future Rename Checklist'));
  assert.ok(releaseRoadmapSource.includes('3.4.29 — Collectibles Naming Review'));
}));

results.push(run('mobile image upload controls use the media-style cover picker on primary edit screens', () => {
  const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
  assert.ok(appPrimitivesSource.includes('function CoverImagePicker'));
  assert.ok(appPrimitivesSource.includes('function ImageSourceControl'));
  assert.ok(appPrimitivesSource.includes('Photo library, camera, or file'));
  assert.ok(appPrimitivesSource.includes('capture="environment"'));
  assert.ok(artViewSource.includes('CoverImagePicker'));
  assert.ok(artViewSource.includes("label: 'Core Details'"));
  assert.ok(!artViewSource.includes("label: 'Artwork'"));
  assert.ok(artViewSource.includes('label="Artwork image"'));
  assert.ok(collectiblesViewSource.includes('CoverImagePicker'));
  assert.ok(collectiblesViewSource.includes('label="Item image"'));
  assert.ok(eventsViewSource.includes('CoverImagePicker'));
  assert.ok(eventsViewSource.includes('label="Artifact image"'));
  assert.ok(eventsViewSource.includes('label="Event image"'));
  assert.ok(signatureManagerSource.includes('label="Proof image"'));
  assert.ok(!artViewSource.includes('capture="environment"'));
  assert.ok(!collectiblesViewSource.includes('capture="environment"'));
  assert.ok(!eventsViewSource.includes('capture="environment"'));
  assert.ok(!signatureManagerSource.includes('capture="environment"'));
}));

results.push(run('shared signature provenance foundation supports Art and media title endpoints', () => {
  assert.ok(migrationsSource.includes('version: 78'));
  assert.ok(migrationsSource.includes('Add shared signature provenance records for Art and media'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS signature_records'));
  assert.ok(migrationsSource.includes("owner_type VARCHAR(20) NOT NULL CHECK (owner_type IN ('media', 'art'))"));
  assert.ok(migrationsSource.includes('idx_signature_records_primary_active'));
  assert.ok(migrationsSource.includes("SELECT\n        'media'"));
  assert.ok(migrationsSource.includes("SELECT\n        'art'"));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS signature_records'));
  assert.ok(initSqlSource.includes("(78, 'Add shared signature provenance records for Art and media')"));
  assert.ok(signaturesServiceSource.includes('syncPrimarySignatureRecord'));
  assert.ok(signaturesServiceSource.includes('loadSignatureRecordsForOwner'));
  assert.ok(collectiblesRoutesSource.includes('syncArtPrimarySignature'));
  assert.ok(collectiblesRoutesSource.includes('signatures: signaturesByOwner.get'));
  assert.ok(mediaRoutesSource.includes('syncMediaPrimarySignature'));
  assert.ok(mediaRoutesSource.includes('attachSignaturesToMediaRecord'));
  assert.ok(validateMiddlewareSource.includes('signer_name: z.preprocess(emptyStringToNull'));
  assert.ok(validateMiddlewareSource.includes('signature_notes: z.preprocess(emptyStringToNull'));
  assert.ok(artViewSource.includes("label: 'Signatures'"));
  assert.ok(artViewSource.includes('Signature provenance'));
  assert.ok(artViewSource.includes('signer_name: form.signer_name || null'));
  assert.ok(openApiSource.includes('"SignatureRecord"'));
  assert.ok(openApiSource.includes('"signatures"'));
}));

results.push(run('shared signature proof attachments support Art upload removal and media compatibility sync', () => {
  assert.ok(collectiblesRoutesSource.includes("router.post('/art/:id/upload-signature-proof', memoryUpload.single('proof')"));
  assert.ok(collectiblesRoutesSource.includes("router.delete('/art/:id/signature-proof'"));
  assert.ok(collectiblesRoutesSource.includes("router.post('/art/:id/signatures/:signatureId/proof', memoryUpload.single('proof')"));
  assert.ok(collectiblesRoutesSource.includes("router.delete('/art/:id/signatures/:signatureId/proof'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/signatures/:signatureId/proof', memoryImageUpload.single('proof')"));
  assert.ok(mediaRoutesSource.includes("router.delete('/:id/signatures/:signatureId/proof'"));
  assert.ok(signaturesServiceSource.includes('updateSignatureProofPath'));
  assert.ok(collectiblesRoutesSource.includes('art.signature_proof.upload'));
  assert.ok(collectiblesRoutesSource.includes('art.signature_proof.remove'));
  assert.ok(collectiblesRoutesSource.includes('art.signature.proof.upload'));
  assert.ok(mediaRoutesSource.includes('media.signature.proof.upload'));
  assert.ok(collectiblesRoutesSource.includes('buildArtSignaturePayloadFromRecord'));
  assert.ok(mediaRoutesSource.includes('const updated = await pool.query'));
  assert.ok(mediaRoutesSource.includes('signed_proof_path: null'));
  assert.ok(artViewSource.includes('/upload-signature-proof'));
  assert.ok(artViewSource.includes('/signature-proof'));
  assert.ok(artViewSource.includes('Proof file upload and removal live on each signature record below'));
  assert.ok(libraryViewSource.includes('Proof file upload and removal live on each signature record below'));
  assert.ok(signatureManagerSource.includes('/proof'));
  assert.ok(signatureManagerSource.includes('Add proof image'));
  assert.ok(signatureManagerSource.includes('Remove proof'));
  assert.ok(openApiSource.includes('"/api/art/{id}/upload-signature-proof"'));
  assert.ok(openApiSource.includes('"/api/art/{id}/signature-proof"'));
  assert.ok(openApiSource.includes('"/api/art/{id}/signatures/{signatureId}/proof"'));
  assert.ok(openApiSource.includes('"/api/media/{id}/signatures/{signatureId}/proof"'));
  assert.ok(openApiSource.includes('"SignatureProofResponse"'));
}));

results.push(run('image and proof controls share source language across drawer surfaces', () => {
  assert.ok(appPrimitivesSource.includes("chooseLabel = 'Choose from Library'"));
  assert.ok(appPrimitivesSource.includes("cameraLabel = 'Take Photo'"));
  assert.ok(appPrimitivesSource.includes("replaceLabel = 'Replace image'"));
  assert.ok(appPrimitivesSource.includes("removeLabel = 'Remove image'"));
  assert.ok(libraryViewSource.includes('Replace cover'));
  assert.ok(libraryViewSource.includes('Photo library, camera, or file'));
  assert.ok(libraryViewSource.includes('Remove cover'));
  assert.ok(!libraryViewSource.includes('Choose or take a photo'));
  assert.ok(eventsViewSource.includes('Open image'));
  assert.ok(eventsViewSource.includes('Remove image'));
  assert.ok(eventsViewSource.includes('selectedLabel="Selected image"'));
  assert.ok(eventsViewSource.includes('cameraLabel="Take Photo"'));
  assert.ok(signatureManagerSource.includes('label="Proof image"'));
  assert.ok(signatureManagerSource.includes('selectedLabel="Selected proof image"'));
  assert.ok(signatureManagerSource.includes('Open proof'));
  assert.ok(signatureManagerSource.includes('Add proof image'));
  assert.ok(signatureManagerSource.includes('Remove proof'));
  assert.ok(!signatureManagerSource.includes('Remove primary proof'));
}));

results.push(run('multi-proof signature evidence keeps shared proof arrays and compatibility projection wired', () => {
  assert.ok(migrationsSource.includes('version: 82'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS signature_proofs'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS signature_proofs'));
  assert.ok(initSqlSource.includes('idx_signature_proofs_primary_active'));
  assert.ok(signaturesServiceSource.includes('serializeSignatureProofRow'));
  assert.ok(signaturesServiceSource.includes('loadSignatureProofs'));
  assert.ok(signaturesServiceSource.includes('addSignatureProof'));
  assert.ok(signaturesServiceSource.includes('archiveSignatureProof'));
  assert.ok(signaturesServiceSource.includes('proofs,'));
  assert.ok(collectiblesRoutesSource.includes("router.delete('/art/:id/signatures/:signatureId/proofs/:proofId'"));
  assert.ok(mediaRoutesSource.includes("router.delete('/:id/signatures/:signatureId/proofs/:proofId'"));
  assert.ok(signatureManagerSource.includes('Proof images'));
  assert.ok(signatureManagerSource.includes('/proofs/${proofId}'));
  assert.ok(openApiSource.includes('"SignatureProofRecord"'));
  assert.ok(openApiSource.includes('"/api/art/{id}/signatures/{signatureId}/proofs/{proofId}"'));
  assert.ok(openApiSource.includes('"/api/media/{id}/signatures/{signatureId}/proofs/{proofId}"'));
}));

results.push(run('signature proof evidence metadata is stored and editable per proof', () => {
  assert.ok(migrationsSource.includes('version: 83'));
  assert.ok(migrationsSource.includes('ADD COLUMN IF NOT EXISTS proof_type VARCHAR(50)'));
  assert.ok(initSqlSource.includes('proof_type VARCHAR(50)'));
  assert.ok(initSqlSource.includes('label VARCHAR(255)'));
  assert.ok(initSqlSource.includes('notes TEXT'));
  assert.ok(signaturesServiceSource.includes('updateSignatureProofMetadata'));
  assert.ok(signaturesServiceSource.includes('proof_type: row.proof_type || null'));
  assert.ok(collectiblesRoutesSource.includes("router.patch('/art/:id/signatures/:signatureId/proofs/:proofId'"));
  assert.ok(mediaRoutesSource.includes("router.patch('/:id/signatures/:signatureId/proofs/:proofId'"));
  assert.ok(signatureManagerSource.includes('Evidence type'));
  assert.ok(signatureManagerSource.includes('Save metadata'));
  assert.ok(openApiSource.includes('"SignatureProofMetadataRequest"'));
  assert.ok(openApiSource.includes('"proof_type"'));
}));

results.push(run('event autograph artifacts can link into shared object signature provenance', () => {
  assert.ok(migrationsSource.includes('version: 79'));
  assert.ok(migrationsSource.includes('Link event autograph artifacts to shared signature provenance'));
  assert.ok(migrationsSource.includes("CHECK (owner_type IN ('media', 'art', 'event_artifact'))"));
  assert.ok(initSqlSource.includes('signature_record_id INTEGER'));
  assert.ok(initSqlSource.includes("(79, 'Link event autograph artifacts to shared signature provenance')"));
  assert.ok(signaturesServiceSource.includes("['media', 'art', 'event_artifact']"));
  assert.ok(validateMiddlewareSource.includes('eventArtifactSignatureLinkSchema'));
  assert.ok(validateMiddlewareSource.includes("owner_type: z.enum(['art', 'media'])"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/artifacts/:artifactId/link-signature'"));
  assert.ok(eventsRoutesSource.includes('syncEventArtifactSignature'));
  assert.ok(eventsRoutesSource.includes("ownerType: 'event_artifact'"));
  assert.ok(eventsRoutesSource.includes('events.artifact.signature.link'));
  assert.ok(eventsRoutesSource.includes('signed_event_id: event.id'));
  assert.ok(fs.existsSync(path.resolve(__dirname, 'event-signature-linking-smoke.js')));
  assert.ok(openApiSource.includes('"/api/events/{id}/artifacts/{artifactId}/link-signature"'));
  assert.ok(openApiSource.includes('"EventArtifactSignatureLinkRequest"'));
  assert.ok(openApiSource.includes('"event_artifact"'));
}));

results.push(run('event autograph linking UI exposes shared Art and media signature attachment workflow', () => {
  assert.ok(eventsViewSource.includes('EventAutographSignatureLinker'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/artifacts/${artifact.id}/link-signature'));
  assert.ok(eventsViewSource.includes("owner_type: targetType"));
  assert.ok(eventsViewSource.includes("const path = targetType === 'art' ? '/art' : '/media';"));
  assert.ok(eventsViewSource.includes("params.set('search', searchTerm.trim())"));
  assert.ok(eventsViewSource.includes('event_artifact_signature'));
  assert.ok(eventsViewSource.includes('linked_signature'));
  assert.ok(eventsViewSource.includes('Link signature'));
  assert.ok(eventsViewSource.includes('Signature notes'));
}));

results.push(run('multi-signature Art and media support keeps primary compatibility wired', () => {
  assert.ok(signaturesServiceSource.includes('createSignatureRecord'));
  assert.ok(signaturesServiceSource.includes('updateSignatureRecord'));
  assert.ok(signaturesServiceSource.includes('archiveSignatureRecord'));
  assert.ok(signaturesServiceSource.includes('setPrimarySignatureRecord'));
  assert.ok(signaturesServiceSource.includes('archiveSignatureRecordsForOwner'));
  assert.ok(collectiblesRoutesSource.includes("router.post('/art/:id/signatures'"));
  assert.ok(collectiblesRoutesSource.includes("router.patch('/art/:id/signatures/:signatureId'"));
  assert.ok(collectiblesRoutesSource.includes("router.post('/art/:id/signatures/:signatureId/primary'"));
  assert.ok(collectiblesRoutesSource.includes("router.delete('/art/:id/signatures/:signatureId'"));
  assert.ok(collectiblesRoutesSource.includes('refreshArtSignatureState'));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/signatures'"));
  assert.ok(mediaRoutesSource.includes("router.patch('/:id/signatures/:signatureId'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/signatures/:signatureId/primary'"));
  assert.ok(mediaRoutesSource.includes("router.delete('/:id/signatures/:signatureId'"));
  assert.ok(mediaRoutesSource.includes('syncMediaLegacyFieldsFromSignatures'));
  assert.ok(validateMiddlewareSource.includes('signatureRecordCreateSchema'));
  assert.ok(validateMiddlewareSource.includes('signatureRecordUpdateSchema'));
  assert.ok(artViewSource.includes('All signatures'));
  assert.ok(libraryViewSource.includes('All signatures'));
  assert.ok(openApiSource.includes('"/api/art/{id}/signatures"'));
  assert.ok(openApiSource.includes('"/api/art/{id}/signatures/{signatureId}/primary"'));
  assert.ok(openApiSource.includes('"/api/media/{id}/signatures"'));
  assert.ok(openApiSource.includes('"/api/media/{id}/signatures/{signatureId}/primary"'));
  assert.ok(openApiSource.includes('"SignatureRecordMutationRequest"'));
  assert.ok(openApiSource.includes('"SignatureRecordMutationResponse"'));
}));

results.push(run('Art physical dimensions and framed metadata are wired through native Art contracts', () => {
  assert.ok(migrationsSource.includes('version: 80'));
  assert.ok(migrationsSource.includes('Add Art physical dimensions and framed metadata'));
  assert.ok(initSqlSource.includes('height NUMERIC(10,2)'));
  assert.ok(initSqlSource.includes('width NUMERIC(10,2)'));
  assert.ok(initSqlSource.includes('framed BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(validateMiddlewareSource.includes('height: nullableNumberSchema'));
  assert.ok(validateMiddlewareSource.includes('width: nullableNumberSchema'));
  assert.ok(validateMiddlewareSource.includes('framed: z.boolean().optional().nullable()'));
  assert.ok(collectiblesRoutesSource.includes('height: row.height === null'));
  assert.ok(collectiblesRoutesSource.includes('framed: row.framed === true'));
  assert.ok(collectiblesRoutesSource.includes("'height', 'width'"));
  assert.ok(collectiblesRoutesSource.includes("'framed'"));
  assert.ok(artViewSource.includes('<span className="label">H</span>'));
  assert.ok(artViewSource.includes('<span className="label">W</span>'));
  assert.ok(artViewSource.includes('Framed'));
  assert.ok(openApiSource.includes('"height"'));
  assert.ok(openApiSource.includes('"width"'));
  assert.ok(openApiSource.includes('"framed"'));
}));

results.push(run('Art dimension unit metadata is wired through native Art contracts', () => {
  assert.ok(migrationsSource.includes('version: 81'));
  assert.ok(migrationsSource.includes('Add Art dimension unit metadata'));
  assert.ok(initSqlSource.includes('dimension_unit VARCHAR(10)'));
  assert.ok(initSqlSource.includes("dimension_unit IN ('in', 'cm')"));
  assert.ok(validateMiddlewareSource.includes("const artDimensionUnitValues = ['in', 'cm']"));
  assert.ok(validateMiddlewareSource.includes('dimension_unit: z.preprocess'));
  assert.ok(collectiblesRoutesSource.includes('dimension_unit: row.dimension_unit || null'));
  assert.ok(collectiblesRoutesSource.includes('dimension_unit: payload.dimension_unit || null'));
  assert.ok(collectiblesRoutesSource.includes("'height', 'width', 'dimension_unit', 'framed'"));
  assert.ok(artViewSource.includes('ART_DIMENSION_UNIT_OPTIONS'));
  assert.ok(artViewSource.includes('<span className="label">Unit</span>'));
  assert.ok(artViewSource.includes('formatDimensionValue(item.height, item.dimension_unit)'));
  assert.ok(openApiSource.includes('"dimension_unit"'));
  assert.ok(/"enum":\s*\[\s*"in",\s*"cm",\s*null\s*\]/.test(openApiSource));
}));

results.push(run('library loans view exposes management-focused counts and due-soon emphasis', () => {
  assert.ok(libraryLoansViewSource.includes('Currently out'));
  assert.ok(libraryLoansViewSource.includes('Due soon'));
  assert.ok(libraryLoansViewSource.includes("['active', 'overdue', 'returned', 'all']"));
  assert.ok(libraryLoansViewSource.includes("pagination.total || 0"));
  assert.ok(libraryLoansViewSource.includes('totals.dueSoon'));
  assert.ok(libraryLoansViewSource.includes('Send Reminder'));
  assert.ok(libraryLoansViewSource.includes('Show History'));
  assert.ok(libraryLoansViewSource.includes("apiCall('get', `/media/${mediaId}/loans`)"));
  assert.ok(libraryLoansViewSource.includes('Loan history'));
  assert.ok(libraryLoansViewSource.includes('Tracking active and returned loan records for this title'));
  assert.ok(libraryLoansViewSource.includes('historyLoan.reminder_events'));
  assert.ok(libraryLoansViewSource.includes('ReminderHistorySummary'));
  assert.ok(libraryLoansViewSource.includes('LoanHistorySection'));
  assert.ok(libraryLoansViewSource.includes('title="Current"'));
  assert.ok(libraryLoansViewSource.includes('title="Returned"'));
  assert.ok(libraryLoansViewSource.includes('formatLoanHistoryRange'));
  assert.ok(libraryLoansViewSource.includes('sortLoanHistoryEntries'));
  assert.ok(libraryLoansViewSource.includes('current ·'));
  assert.ok(libraryLoansViewSource.includes('reminder_sent_today'));
  assert.ok(libraryLoansViewSource.includes('CollectionPaginationFooter'));
  assert.ok(libraryLoansViewSource.includes('showPageSize={false}'));
  assert.ok(libraryViewSource.includes('Add borrower email to send reminders.'));
  assert.ok(libraryViewSource.includes('Reminder history'));
  assert.ok(libraryViewSource.includes('formatReminderEventLabel'));
  assert.ok(libraryViewSource.includes('ReminderHistorySummary'));
  assert.ok(libraryViewSource.includes('activeLoan.reminder_events'));
  assert.ok(libraryViewSource.includes('loan.reminder_events'));
  assert.ok(loanRemindersServiceSource.includes('reminder_eligible'));
  assert.ok(loanRemindersServiceSource.includes('media.loan.reminder.send'));
  assert.ok(loanRemindersServiceSource.includes('startAutomaticLoanReminderScheduler'));
  assert.ok(loanRemindersServiceSource.includes('runAutomaticLoanReminderSweep'));
  assert.ok(loanRemindersServiceSource.includes('due_soon_reminder_last_sent_at'));
  assert.ok(loanRemindersServiceSource.includes('overdue_reminder_last_sent_at'));
  assert.ok(loanRemindersServiceSource.includes('media_loan_reminders'));
  assert.ok(loanRemindersServiceSource.includes('delivery_window_key'));
  assert.ok(loanRemindersServiceSource.includes('trigger_source'));
  assert.ok(serverSource.includes('startAutomaticLoanReminderScheduler()'));
  assert.ok(serverSource.includes('autoLoanReminders='));
  assert.ok(openApiSource.includes('"summary"'));
  assert.ok(openApiSource.includes('"dueSoon"'));
  assert.ok(openApiSource.includes('"MediaLoanReminderEvent"'));
  assert.ok(openApiSource.includes('"reminder_events"'));
  assert.ok(openApiSource.includes('/api/media/loan-reminders/run-auto'));
  assert.ok(libraryLoanReminderWorkflowSmokeSource.includes('/api/media/loans/${loanId}/reminder'));
  assert.ok(automaticLoanRemindersSmokeSource.includes('/api/media/loan-reminders/run-auto'));
  assert.ok(automaticLoanRemindersSmokeSource.includes('Expected first automatic reminder run to send at least the two test reminders'));
  assert.ok(libraryLoanReminderWorkflowSmokeSource.includes('Expected one reminder history event'));
  assert.ok(automaticLoanRemindersSmokeSource.includes('Expected two reminder history events'));
  assert.ok(libraryLoanReminderWorkflowSmokeSource.includes('active loan history response to include reminder events'));
  assert.ok(automaticLoanRemindersSmokeSource.includes('active loan response to include reminder events'));
  assert.ok(libraryLoanReminderWorkflowSmokeSource.includes('smtp_override_enabled'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('loaned game cards open a loan-first drawer and keep the reminder action resilient'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes("page.goto('/dashboard?tab=library-games')"));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('Show Details'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('/api/media/${mediaId}/loans'));
  assert.ok(libraryMultiformatBrowserSpecSource.includes('/\\/api\\/media\\/loans\\/\\d+\\/reminder$/'));
}));

results.push(run('frontend import flow no longer mounts standalone Import Review view', () => {
  assert.ok(!dashboardContentSource.includes('ImportReviewView'));
  assert.ok(!frontendAppSource.includes('const importReviewEnabled'));
}));

results.push(run('library drawer source includes compact match evidence summaries with richer expanded validation details', () => {
  assert.ok(libraryViewSource.includes('Match evidence'));
  assert.ok(libraryViewSource.includes('function MergeEvidenceSection({'));
  assert.ok(libraryViewSource.includes("${Number(mergeSummary?.active_merge_count || 0)} ${Number(mergeSummary?.active_merge_count || 0) === 1 ? 'merge event' : 'merge events'}"));
  assert.ok(libraryViewSource.includes('supporting sources'));
  assert.ok(libraryViewSource.includes('Canonical: ${formatMergeSourceLabel(entry?.canonical)} · Matched: ${formatMergeSourceLabel(entry?.merged)}'));
  assert.ok(libraryViewSource.includes('Canonical record'));
  assert.ok(libraryViewSource.includes('Matched record'));
  assert.ok(libraryViewSource.includes('Compared fields'));
  assert.ok(libraryViewSource.includes('Matched on'));
  assert.ok(libraryViewSource.includes('This record'));
  assert.ok(libraryViewSource.includes('Matched record'));
  assert.ok(libraryViewSource.includes('{formatMergeValue(row.canonical_value)}'));
  assert.ok(libraryViewSource.includes('{formatMergeValue(row.merged_value)}'));
  assert.ok(libraryViewSource.includes('Record #{entry.technical_details.canonical_id}'));
  assert.ok(libraryViewSource.includes('Record #{entry.technical_details.duplicate_id}'));
  assert.ok(libraryViewSource.includes('Merged at:'));
  assert.ok(libraryViewSource.includes('Matched on:'));
  assert.ok(libraryViewSource.includes('Repair type: {formatMergeTechnicalLabel(entry?.repair_type)}'));
  assert.ok(libraryViewSource.includes("apiCall('get', `/media/${item.id}/merge-details`)"));
  assert.ok(libraryViewSource.includes('DisclosureList'));
  assert.ok(libraryViewSource.includes('Find possible duplicates'));
  assert.ok(!libraryViewSource.includes('const supportsMergeDetails = isBook || isComic;'));
}));

results.push(run('admin merge review view posts preview requests and renders operator-facing comparison details', () => {
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-preview"));
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-apply"));
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-revert"));
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-recommendations?${query.toString()}"));
  assert.ok(adminMergeReviewViewSource.includes('/media/discovery-candidates?'));
  assert.ok(adminMergeReviewViewSource.includes('/media/comics/duplicate-candidates?'));
  assert.ok(adminMergeReviewViewSource.includes('/media/collections/duplicates?'));
  assert.ok(adminMergeReviewViewSource.includes('/media/collections/duplicate-preview?'));
  assert.ok(adminMergeReviewViewSource.includes('SectionTabs'));
  assert.ok(adminMergeReviewViewSource.includes('SectionTabPanel'));
  assert.ok(adminMergeReviewViewSource.includes('Merge review sections'));
  assert.ok(!adminMergeReviewViewSource.includes("{ id: 'review', label: 'Review' }"));
  assert.ok(adminMergeReviewViewSource.includes('/media/collections/merge-apply'));
  assert.ok(adminMergeReviewViewSource.includes('/media/collections/merge-revert'));
  assert.ok(adminMergeReviewViewSource.includes('/media/collections/${left.id}/merge-details'));
  assert.ok(adminMergeReviewViewSource.includes('/media?search='));
  assert.ok(adminMergeReviewViewSource.includes('Review a same-type pairwise merge inside the current workspace and library scope'));
  assert.ok(adminMergeReviewViewSource.includes('Library section'));
  assert.ok(adminMergeReviewViewSource.includes('All sections'));
  assert.ok(adminMergeReviewViewSource.includes("query.set('media_type', sectionFilter)"));
  assert.ok(adminMergeReviewViewSource.includes('Discovery queue'));
  assert.ok(adminMergeReviewViewSource.includes('Likely duplicates surfaced from lighter signals'));
  assert.ok(adminMergeReviewViewSource.includes('normalized-movie-title matches'));
  assert.ok(adminMergeReviewViewSource.includes('Possible duplicates for:'));
  assert.ok(adminMergeReviewViewSource.includes('Clear focus'));
  assert.ok(adminMergeReviewViewSource.includes('Discovery candidate removed from the queue'));
  assert.ok(adminMergeReviewViewSource.includes('onReject={handleDiscoveryReject}'));
  assert.ok(adminMergeReviewViewSource.includes('Recommended pairs'));
  assert.ok(adminMergeReviewViewSource.includes('Suppressed pairs'));
  assert.ok(adminMergeReviewViewSource.includes('Restore to queue'));
  assert.ok(adminMergeReviewViewSource.includes('/media/merge-recommendations/history?'));
  assert.ok(adminMergeReviewViewSource.includes('/media/merge-recommendations/restore?'));
  assert.ok(adminMergeReviewViewSource.includes('Comic duplicate candidates'));
  assert.ok(adminMergeReviewViewSource.includes('Search comic duplicates'));
  assert.ok(adminMergeReviewViewSource.includes('Safe issue-level comic duplicates surfaced separately'));
  assert.ok(adminMergeReviewViewSource.includes('Suppressed comic clusters'));
  assert.ok(adminMergeReviewViewSource.includes('Pick the exact pair you want to review.'));
  assert.ok(adminMergeReviewViewSource.includes('Matched records'));
  assert.ok(adminMergeReviewViewSource.includes('Review pair'));
  assert.ok(adminMergeReviewViewSource.includes('Working through:'));
  assert.ok(adminMergeReviewViewSource.includes('Next pair ready for'));
  assert.ok(adminMergeReviewViewSource.includes('remaining pairs'));
  assert.ok(adminMergeReviewViewSource.includes('Skip pair'));
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-recommendations/defer"));
  assert.ok(adminMergeReviewViewSource.includes('Deferred this comic pair'));
  assert.ok(adminMergeReviewViewSource.includes('Duplicate collections'));
  assert.ok(adminMergeReviewViewSource.includes('Search duplicate collections'));
  assert.ok(adminMergeReviewViewSource.includes('Collection entities are reviewed separately from title merges so duplicate sets can be compared without mixing them into media merges.'));
  assert.ok(adminMergeReviewViewSource.includes('Review group'));
  assert.ok(adminMergeReviewViewSource.includes('Collection preview'));
  assert.ok(adminMergeReviewViewSource.includes('Preview a duplicate collection merge in the current scope before applying it.'));
  assert.ok(adminMergeReviewViewSource.includes('Merged items'));
  assert.ok(adminMergeReviewViewSource.includes('Collection merge applied'));
  assert.ok(adminMergeReviewViewSource.includes('Active collection merge events'));
  assert.ok(adminMergeReviewViewSource.includes('Collection merge reverted'));
  assert.ok(adminMergeReviewViewSource.includes('Review pair'));
  assert.ok(adminMergeReviewViewSource.includes('Reject match'));
  assert.ok(adminMergeReviewViewSource.includes('Confirm reject'));
  assert.ok(adminMergeReviewViewSource.includes('className="select h-8 text-xs"'));
  assert.ok(adminMergeReviewViewSource.includes('className="select h-9"'));
  assert.ok(adminMergeReviewViewSource.includes('Optional note'));
  assert.ok(adminMergeReviewViewSource.includes('different_title_identity'));
  assert.ok(adminMergeReviewViewSource.includes("/media/merge-recommendations/reject"));
  assert.ok(adminMergeReviewViewSource.includes('Exact pair review'));
  assert.ok(adminMergeReviewViewSource.includes('Pair review'));
  assert.ok(adminMergeReviewViewSource.includes('Manual exact pair'));
  assert.ok(adminMergeReviewViewSource.includes('Inline queue review'));
  assert.ok(adminMergeReviewViewSource.includes('From:'));
  assert.ok(adminMergeReviewViewSource.includes('Pair:'));
  assert.ok(adminMergeReviewViewSource.includes('Context:'));
  assert.ok(adminMergeReviewViewSource.includes('activeReviewContextSnapshot'));
  assert.ok(adminMergeReviewViewSource.includes('activeReviewLaneStateSnapshot'));
  assert.ok(adminMergeReviewViewSource.includes('captureReviewContextLabel'));
  assert.ok(adminMergeReviewViewSource.includes('captureReviewLaneState'));
  assert.ok(adminMergeReviewViewSource.includes('Restore filters'));
  assert.ok(adminMergeReviewViewSource.includes('restoreActiveReviewLaneState'));
  assert.ok(adminMergeReviewViewSource.includes('areReviewLaneSnapshotsEqual'));
  assert.ok(adminMergeReviewViewSource.includes('Return to row'));
  assert.ok(adminMergeReviewViewSource.includes('scrollIntoView'));
  assert.ok(adminMergeReviewViewSource.includes('merge-review-row-'));
  assert.ok(adminMergeReviewViewSource.includes('buildReviewRowClassName'));
  assert.ok(adminMergeReviewViewSource.includes('border-brand/40 bg-brand/10'));
  assert.ok(adminMergeReviewViewSource.includes('setHighlightedReviewSource'));
  assert.ok(adminMergeReviewViewSource.includes('setHighlightedReviewKey'));
  assert.ok(adminMergeReviewViewSource.includes("formatReviewContextDetail('Search', String(options.searchValue ?? discoverySearch).trim())"));
  assert.ok(adminMergeReviewViewSource.includes("formatReviewContextDetail('Cluster', options.groupLabel || activeComicGroupLabel)"));
  assert.ok(adminMergeReviewViewSource.includes('selectedSuppressedOutcomeLabel'));
  assert.ok(adminMergeReviewViewSource.includes("activeReviewSource === 'discovery' && !discoveryInlineReviewPresent"));
  assert.ok(adminMergeReviewViewSource.includes("activeReviewSource === 'recommended' && !recommendationInlineReviewPresent"));
  assert.ok(adminMergeReviewViewSource.includes("activeReviewSource === 'comics' && !comicInlineReviewPresent"));
  assert.ok(adminMergeReviewViewSource.includes("activeReviewSource === 'suppressed' && !suppressedInlineReviewPresent"));
  assert.ok(adminMergeReviewViewSource.includes('Find this record'));
  assert.ok(adminMergeReviewViewSource.includes('Find matched record'));
  assert.ok(adminMergeReviewViewSource.includes('Search inside the active workspace and library scope.'));
  assert.ok(adminMergeReviewViewSource.includes('Type at least two characters to search.'));
  assert.ok(adminMergeReviewViewSource.includes('Apply merge'));
  assert.ok(adminMergeReviewViewSource.includes('Active merge events'));
  assert.ok(adminMergeReviewViewSource.includes('Revert merge'));
  assert.ok(adminMergeReviewViewSource.includes('Confirm apply'));
  assert.ok(adminMergeReviewViewSource.includes('Merge applied'));
  assert.ok(adminMergeReviewViewSource.includes('Merge reverted'));
  assert.ok(adminMergeReviewViewSource.includes('Compared fields'));
  assert.ok(adminMergeReviewViewSource.includes('This record'));
  assert.ok(adminMergeReviewViewSource.includes('Matched record'));
  assert.ok(adminMergeReviewViewSource.includes('Result'));
  assert.ok(adminMergeReviewViewSource.includes('Dependent rewiring'));
  assert.ok(adminMergeReviewViewSource.includes('Merge history'));
  assert.ok(adminMergeReviewViewSource.includes('Swap'));
  assert.ok(adminMergeReviewViewSource.includes('Recommended canonical'));
}));

results.push(run('manual merge apply source records activity log evidence', () => {
  assert.ok(mediaRoutesSource.includes("await logActivity(req, 'media.merge_apply', 'media', canonicalMediaId"));
  assert.ok(mediaRoutesSource.includes("router.get('/merge-recommendations/history'"));
  assert.ok(mediaRoutesSource.includes("router.post('/merge-recommendations/restore'"));
  assert.ok(manualMergeApplySmokeSource.includes("action = 'media.merge_apply'"));
  assert.ok(manualMergeApplySmokeSource.includes('activityAction'));
}));

results.push(run('admin shell browser coverage includes manual merge review preview and cross-type guardrails', () => {
  assert.ok(adminShellBrowserSpecSource.includes('/dashboard?tab=admin-merges'));
  assert.ok(adminShellBrowserSpecSource.includes('Preview merge'));
  assert.ok(adminShellBrowserSpecSource.includes('Apply merge'));
  assert.ok(adminShellBrowserSpecSource.includes('Cross-type merges are not allowed'));
  assert.ok(adminShellBrowserSpecSource.includes('Compared fields'));
}));

results.push(run('admin users view stays platform-only without invitation management tab', () => {
  assert.ok(adminUsersViewSource.includes('Platform-level member administration.'));
  assert.ok(!adminUsersViewSource.includes("activeTab === 'invitations'"));
  assert.ok(!adminUsersViewSource.includes("/admin/invites"));
  assert.ok(adminUsersViewSource.includes('workspace memberships'));
  assert.ok(adminUsersViewSource.includes('Owned workspaces'));
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
  assert.ok(backendPackageSource.includes('"test:homelab-edition-boundary": "node scripts/homelab-edition-boundary-smoke.js"'));
  assert.ok(backendPackageSource.includes('"test:platform-edition-boundary": "node scripts/platform-edition-boundary-smoke.js"'));
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
  assert.ok(structuredLogSmokeSource.includes('async function searchOpenSearch'));
  assert.ok(structuredLogSmokeSource.includes('if (result.response.status === 404)'));
  assert.ok(structuredLogSmokeSource.includes("source: 'opensearch-index'"));
  assert.ok(structuredLogSmokeSource.includes("message.request_id === requestId"));
  assert.ok(structuredLogSmokeSource.includes('withStructuredLogSmokeEvent'));
}));

results.push(run('structured log smoke shared helper centralizes login and deterministic event toggling', () => {
  assert.ok(structuredLogSmokeSharedSource.includes('ADMIN_EMAIL and ADMIN_PASSWORD are required'));
  assert.ok(structuredLogSmokeSharedSource.includes('withStructuredLogSmokeEvent'));
  assert.ok(structuredLogSmokeSharedSource.includes('Waiting ${FEATURE_FLAG_SETTLE_MS}ms for feature-flag cache to settle...'));
  assert.ok(structuredLogSmokeSharedSource.includes("external_log_export_enabled"));
}));

results.push(run('loki and syslog structured log smoke sources cover their collector verification paths', () => {
  assert.ok(structuredLogLokiSmokeSource.includes('const LOKI_URL'));
  assert.ok(structuredLogLokiSmokeSource.includes("source: 'loki-query'"));
  assert.ok(structuredLogLokiSmokeSource.includes('withStructuredLogSmokeEvent'));
  assert.ok(structuredLogSyslogSmokeSource.includes('const SYSLOG_COLLECTOR_URL'));
  assert.ok(structuredLogSyslogSmokeSource.includes('fetchJson'));
  assert.ok(structuredLogSyslogSmokeSource.includes("source: 'syslog-tail'"));
  assert.ok(structuredLogSyslogSmokeSource.includes('withStructuredLogSmokeEvent'));
}));

results.push(run('observability endpoint control-plane source includes stored config resolution and read-only override handling', () => {
  assert.ok(migrationsSource.includes('Add observability endpoint control-plane fields'));
  assert.ok(migrationsSource.includes('Add observability endpoint validation fields'));
  assert.ok(migrationsSource.includes('Add observability endpoint label fields'));
  assert.ok(migrationsSource.includes('Add observability endpoint debug field'));
  assert.ok(migrationsSource.includes('log_export_backend'));
  assert.ok(migrationsSource.includes('log_export_host_label'));
  assert.ok(migrationsSource.includes('log_export_service'));
  assert.ok(migrationsSource.includes('log_export_debug'));
  assert.ok(migrationsSource.includes('log_export_last_validation_status'));
  assert.ok(logExportSource.includes('const LOG_EXPORT_SETTINGS_READ_ONLY'));
  assert.ok(logExportSource.includes('async function resolveExportConfig'));
  assert.ok(logExportSource.includes('async function validateStructuredLogDelivery'));
  assert.ok(logExportSource.includes('function readCachedExportConfig()'));
  assert.ok(logExportSource.includes('hostLabel'));
  assert.ok(logExportSource.includes('service'));
  assert.ok(logExportSource.includes('debugEnabled'));
  assert.ok(logExportSource.includes("source: 'env_override'"));
  assert.ok(logExportSource.includes("source: 'stored'"));
  assert.ok(logExportSource.includes("source: 'env_fallback'"));
  assert.ok(logExportSource.includes('UDP collectors do not acknowledge receipt'));
  assert.ok(integrationsRoutesSource.includes('Unsupported external log backend'));
  assert.ok(integrationsRoutesSource.includes('External log port must be an integer between 1 and 65535'));
  assert.ok(integrationsRoutesSource.includes("/admin/settings/integrations/test-logs"));
  assert.ok(integrationsRoutesSource.includes('logExportControl'));
  assert.ok(integrationsRoutesSource.includes('log_export_host_label'));
  assert.ok(integrationsRoutesSource.includes('log_export_service'));
  assert.ok(integrationsRoutesSource.includes('log_export_last_validation_status'));
  assert.ok(observabilityRuntimeSource.includes('configSource'));
  assert.ok(observabilityRuntimeSource.includes('storedBackend'));
  assert.ok(observabilityRuntimeSource.includes('storedHostLabel'));
  assert.ok(observabilityRuntimeSource.includes('storedService'));
  assert.ok(observabilityRuntimeSource.includes('storedDebugEnabled'));
  assert.ok(observabilityRuntimeSource.includes('envBackend'));
  assert.ok(observabilityRuntimeSource.includes('envHostLabel'));
  assert.ok(observabilityRuntimeSource.includes('envService'));
  assert.ok(observabilityRuntimeSource.includes('envDebugEnabled'));
  assert.ok(dockerComposeSource.includes('LOG_EXPORT_SETTINGS_READ_ONLY'));
}));

results.push(run('feature flags source includes external log export flag', () => {
  const featureFlagsSource = require('fs').readFileSync(require.resolve('../services/featureFlags'), 'utf8');
  assert.ok(featureFlagsSource.includes('external_log_export_enabled'));
}));

Promise.all(results)
  .then((resolved) => {
    if (resolved.some((ok) => !ok)) {
      process.exit(1);
      return;
    }
    console.log(`All unit tests passed (${resolved.length})`);
  })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
