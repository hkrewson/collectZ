'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { parseCsvText } = require('../services/csv');
const { normalizeBarcodeMatches } = require('../services/barcode');
const {
  buildCaptureOcrCandidates
} = require('../services/captureOcr');
const {
  extractOcrSpaceText,
  buildOcrProviderConfig
} = require('../services/captureImageOcr');
const {
  buildPlexPmsModernizationContract,
  normalizePlexItem,
  normalizePlexVariant,
  parsePlexMediaProviders,
  normalizePlexMediaProvider,
  parsePlexNowPlayingSessions,
  normalizePlexNowPlayingSession,
  buildPlexWebhookAndRatingsContract,
  buildPlexWatchStateSyncContract,
  buildPlexWatchedStateWritebackContract,
  normalizePlexWebhookEvent,
  buildPlexRatingWritebackRequest,
  buildPlexWatchedStateWritebackRequest,
  parsePlexWatchStateEntries,
  normalizePlexWatchedStateEntry,
  parsePlexRatingEntries,
  normalizePlexRatingEntry,
  resolvePlexSectionsRootPath,
  fetchPlexSectionsWithResolution,
  isPlexCompilationArtist,
  shouldIncludePlexEntry
} = require('../services/plex');
const { wrapTmdbRequestError } = require('../services/tmdb');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIsbn, normalizeIdentifierSet } = require('../services/importIdentifiers');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { normalizeOpdsEntry } = require('../services/cwa');
const {
  buildKavitaSeriesWebUrl,
  buildKavitaReaderWebUrl,
  buildKavitaCoverImageUrl,
  buildKavitaCoverProxyPath,
  buildKavitaChapterCoverProxyPath,
  buildKavitaSeriesCoverImagePath,
  buildKavitaSeriesProviderItemId,
  buildKavitaChapterProviderItemId,
  parseKavitaComicIssueLikeSeriesTitle,
  normalizeKavitaBaseUrl,
  normalizeKavitaLibraryType,
  isKavitaComicLibraryType,
  normalizeKavitaChapterIssueRows
} = require('../services/kavita');
const {
  buildKavitaMetadataWritebackProbe,
  buildKavitaMetadataWritebackPreview,
  buildKavitaSeriesMetadataWritebackPayload,
  buildKavitaChapterMetadataWritebackPayload
} = require('../services/kavitaWritebackContract');
const {
  buildKavitaProgressWritePayload,
  buildKavitaResetProgressPayload,
  buildKavitaResetProgressProbePayload,
  buildKavitaChapterReadStatePayload
} = require('../services/kavitaProgressContract');
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
const { buildCoreInstanceContract } = require('../services/coreInstance');
const {
  buildMediaHealthReview,
  buildMissingIdentifierReviewClues,
  buildSparseMetadataReviewClues
} = require('../services/reviewClues');
const {
  parseDatabaseUrl,
  formatBytes,
  redactPortableValue,
  normalizePortabilityScope,
  buildPortabilityCsvFiles,
  getBackupFreshnessReadback,
  buildRestoreRehearsalReadback
} = require('../services/portability');
const {
  SUPPORT_ACCESS_APPROVAL_TTL_DAYS,
  getSupportAccessExpiryTimestamp,
  getEffectiveSupportAccessStatus,
  isSupportAccessApprovalActive
} = require('../services/supportAccess');
const { extractScopeHints, resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { sanitizeAuditDetails, sanitizeLogField: sanitizeAuditLogField } = require('../services/audit');
const { sanitizeLogField: sanitizeRequestLogField, sanitizeRequestUrl } = require('../middleware/errors');
const { buildGelfEvent, inferLevel, inferOutcome, truncateJsonValue, readExportConfig, promoteDetailFields, omitNilFields, formatSyslogMessage } = require('../services/logExport');
const { requestIdMiddleware } = require('../middleware/requestId');
const {
  simpleSearchSchema,
  titleAuthorSearchSchema,
  titleArtistSearchSchema,
  upcLookupSchema,
  mediaUpdateSchema
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
const { ICS_FETCH_USER_AGENT, fetchIcsText, parseIcsEvents, parseIcsCatalogSessions, linkPersonalPlansToCatalogSessions } = require('../services/schedIcsSync');
const {
  parseHttpUrl,
  normalizeTrustedConnectorHttpUrl,
  isPrivateAddress,
  assertPublicHttpUrl
} = require('../services/outboundUrlPolicy');
const {
  extractArticleCandidatesFromIndex,
  extractArticleMetadata,
  providerKeyForUrl
} = require('../services/exclusiveSources');
const {
  buildLoanReminderPhase,
  wasLoanReminderSentToday,
  getLoanReminderTrackingField,
  isAutomaticReminderEligible,
  buildLoanReminderDeliveryWindowKey
} = require('../services/loanReminders');
const metricsModule = require('../services/metrics');
const { csrfProtection, shouldEnforceCsrf } = require('../middleware/csrf');
const observabilityRuntimeSource = fs.readFileSync(require.resolve('../services/observabilityRuntime'), 'utf8');
const releasePreflightLocalSource = fs.readFileSync(require.resolve('../scripts/release-preflight-local'), 'utf8');
const localReleaseGateSource = fs.readFileSync(require.resolve('../../scripts/local-release-gate'), 'utf8');
const localRuntimeSmokeSource = fs.readFileSync(require.resolve('../../scripts/local-runtime-smoke'), 'utf8');
const localGitHooksInstallerSource = fs.readFileSync(require.resolve('../../scripts/install-local-git-hooks'), 'utf8');
const ciComposeWriterSource = fs.readFileSync(require.resolve('../../scripts/write-ci-compose-overrides'), 'utf8');
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
const dashboardRoutesSource = fs.readFileSync(require.resolve('../routes/dashboard'), 'utf8');
const wishlistRoutesSource = fs.readFileSync(require.resolve('../routes/wishlist'), 'utf8');
const appleItunesServiceSource = fs.readFileSync(require.resolve('../services/appleItunes'), 'utf8');
const {
  fetchAppleSearch,
  normalizeAppleItunesResult,
  normalizeMediaList,
  scoreTitleMatch,
  dedupeCandidates
} = require('../services/appleItunes');
const captureItemsRoutesSource = fs.readFileSync(require.resolve('../routes/captureItems'), 'utf8');
const captureImageOcrServiceSource = fs.readFileSync(require.resolve('../services/captureImageOcr'), 'utf8');
const mediaRoutesSource = fs.readFileSync(require.resolve('../routes/media'), 'utf8');
const reviewCluesServiceSource = fs.readFileSync(require.resolve('../services/reviewClues'), 'utf8');
const openApiSource = fs.readFileSync(require.resolve('../openapi/openapi.yaml'), 'utf8');
const logExportSource = fs.readFileSync(require.resolve('../services/logExport'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
const coreRoutesSource = fs.readFileSync(require.resolve('../routes/core'), 'utf8');
const migrationsSource = fs.readFileSync(require.resolve('../db/migrations'), 'utf8');
const initSqlSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'init.sql'), 'utf8');
const libraryServiceSource = fs.readFileSync(require.resolve('../services/libraries'), 'utf8');
const personalAccessTokenSource = fs.readFileSync(require.resolve('../services/personalAccessTokens'), 'utf8');
const serviceAccountKeySource = fs.readFileSync(require.resolve('../services/serviceAccountKeys'), 'utf8');
const validateSource = fs.readFileSync(require.resolve('../middleware/validate'), 'utf8');
const librariesRoutesSource = fs.readFileSync(require.resolve('../routes/libraries'), 'utf8');
const spacesRoutesSource = fs.readFileSync(require.resolve('../routes/spaces'), 'utf8');
const adminRoutesSource = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
const eventsRoutesSource = fs.readFileSync(require.resolve('../routes/events'), 'utf8');
const collectiblesRoutesSource = fs.readFileSync(require.resolve('../routes/collectibles'), 'utf8');
const collectibleTraitsRoutesSource = fs.readFileSync(require.resolve('../routes/collectibleTraits'), 'utf8');
const integrationsRoutesSource = fs.readFileSync(require.resolve('../routes/integrations'), 'utf8');
const spaceIntegrationsRoutesSource = fs.readFileSync(require.resolve('../routes/spaceIntegrations'), 'utf8');
const integrationsServiceSource = fs.readFileSync(require.resolve('../services/integrations'), 'utf8');
const integrationResponseSource = fs.readFileSync(require.resolve('../services/integrationResponse'), 'utf8');
const portabilityServiceSource = fs.readFileSync(require.resolve('../services/portability'), 'utf8');
const supportRoutesSource = fs.readFileSync(require.resolve('../routes/support'), 'utf8');
const signaturesServiceSource = fs.readFileSync(require.resolve('../services/signatures'), 'utf8');
const eventSocialPlanningSmokeSource = fs.readFileSync(require.resolve('../scripts/event-social-planning-smoke'), 'utf8');
const eventPersonalIcsSyncSmokeSource = fs.readFileSync(require.resolve('../scripts/event-personal-ics-sync-smoke'), 'utf8');
const eventCatalogIcsImportSmokeSource = fs.readFileSync(require.resolve('../scripts/event-catalog-ics-import-smoke'), 'utf8');
const kavitaConnectionSmokeSource = fs.readFileSync(require.resolve('../scripts/kavita-connection-smoke'), 'utf8');
const kavitaImportSyncSmokeSource = fs.readFileSync(require.resolve('../scripts/kavita-import-sync-smoke'), 'utf8');
const kavitaMetadataWritebackProbeSource = fs.readFileSync(require.resolve('../scripts/kavita-metadata-writeback-probe'), 'utf8');
const kavitaProgressContractProbeSource = fs.readFileSync(require.resolve('../scripts/kavita-progress-contract-probe'), 'utf8');
const kavitaSetupDocSource = fs.readFileSync(require.resolve('../../docs/wiki/41-Kavita-Integration-Setup.md'), 'utf8');
const kavitaReaderProgressDocSource = fs.readFileSync(require.resolve('../../docs/wiki/42-Kavita-Reader-Progress-Contract.md'), 'utf8');
const kavitaChapterFanoutDocSource = fs.readFileSync(require.resolve('../../docs/wiki/43-Kavita-Chapter-Issue-Fanout-Contract.md'), 'utf8');
const kavitaWorkspaceAdminDocSource = fs.readFileSync(require.resolve('../../docs/wiki/44-Kavita-Workspace-Owned-Administration-Contract.md'), 'utf8');
const kavitaMetadataWritebackDocSource = fs.readFileSync(require.resolve('../../docs/wiki/45-Kavita-Metadata-Writeback-Contract.md'), 'utf8');
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
function loadFrontendEsmModule(relativePath, exportNames = []) {
  const source = readFrontendSource(relativePath)
    .replace(/\bexport const /g, 'const ')
    .replace(/\bexport function /g, 'function ');
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${source}\nmodule.exports = { ${exportNames.join(', ')} };`,
    sandbox,
    { filename: `${relativePath}.js` }
  );
  return sandbox.module.exports;
}
const frontendAppSource = readFrontendSource('App');
const sidebarNavSource = readFrontendSource(path.join('components', 'SidebarNav'));
const dashboardShellSource = readFrontendSource(path.join('components', 'app', 'DashboardShell'));
const dashboardContentSource = readFrontendSource(path.join('components', 'app', 'DashboardContent'));
const adminSettingsViewSource = readFrontendSource(path.join('components', 'AdminSettingsView'));
const dashboardRoutingSource = readFrontendSource(path.join('components', 'app', 'dashboardRouting'));
const productEditionFrontendSource = readFrontendSource(path.join('components', 'app', 'productEdition'));
const frontendEnvSource = readFrontendSource(path.join('components', 'app', 'frontendEnv'));
const useApiClientSource = readFrontendSource(path.join('components', 'app', 'hooks', 'useApiClient'));
const useMediaApiSource = readFrontendSource(path.join('components', 'app', 'hooks', 'useMediaApi'));
const helpViewSource = readFrontendSource(path.join('components', 'HelpView'));
const activityFeedViewSource = readFrontendSource(path.join('components', 'ActivityFeedView'));
const dashboardCommandCenterViewSource = readFrontendSource(path.join('components', 'DashboardCommandCenterView'));
const syncJobDetailDrawerSource = readFrontendSource(path.join('components', 'SyncJobDetailDrawer'));
const wishlistViewSource = readFrontendSource(path.join('components', 'WishlistView'));
const importViewSource = readFrontendSource(path.join('components', 'ImportView'));
const captureInboxViewSource = readFrontendSource(path.join('components', 'CaptureInboxView'));
const adminIntegrationsViewSource = readFrontendSource(path.join('components', 'AdminIntegrationsView'));
const spaceManagerViewSource = readFrontendSource(path.join('components', 'SpaceManagerView'));
const libraryLoansViewSource = readFrontendSource(path.join('components', 'LibraryLoansView'));
const adminMergeReviewViewSource = readFrontendSource(path.join('components', 'AdminMergeReviewView'));
const libraryViewSource = readFrontendSource(path.join('components', 'LibraryView'));
const appPrimitivesSource = readFrontendSource(path.join('components', 'app', 'AppPrimitives'));
const drawerMetadataSource = readFrontendSource(path.join('components', 'app', 'drawerMetadata'));
const drawerMetadataModule = loadFrontendEsmModule(path.join('components', 'app', 'drawerMetadata'), [
  'DRAWER_METADATA_IDS',
  'DRAWER_METADATA_REGISTRY',
  'buildDrawerMetadata',
  'buildDrawerMetadataItems',
  'buildObjectDrawerMetadataRecords',
  'getDrawerMetadataRegistryEntry'
]);
const useSessionBootstrapSource = readFrontendSource(path.join('components', 'app', 'hooks', 'useSessionBootstrap'));
const nowPlayingViewSource = readFrontendSource(path.join('components', 'NowPlayingView'));
const eventsViewSource = readFrontendSource(path.join('components', 'EventsView'));
const artViewSource = readFrontendSource(path.join('components', 'ArtView'));
const collectiblesViewSource = readFrontendSource(path.join('components', 'CollectiblesView'));
const collectibleCardSource = readFrontendSource(path.join('components', 'collectibles', 'CollectibleCard'));
const collectibleRowSource = readFrontendSource(path.join('components', 'collectibles', 'CollectibleRow'));
const signatureManagerSource = readFrontendSource(path.join('components', 'app', 'SignatureManager'));
const backendPackageJson = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
const frontendPackageJson = JSON.parse(fs.readFileSync(require.resolve('../../frontend/package.json'), 'utf8'));
const frontendViteConfigSource = fs.readFileSync(require.resolve('../../frontend/vite.config.js'), 'utf8');
const frontendViteIndexHtmlSource = fs.readFileSync(require.resolve('../../frontend/index.html'), 'utf8');
const frontendDockerfileSource = fs.readFileSync(require.resolve('../../frontend/Dockerfile'), 'utf8');
const rootPackageJson = JSON.parse(fs.readFileSync(require.resolve('../../package.json'), 'utf8'));
const playwrightConfigSource = fs.readFileSync(require.resolve('../../playwright.config'), 'utf8');
const playwrightAdminSetupSource = fs.readFileSync(require.resolve('../../tests/playwright/setup/admin.setup'), 'utf8');
const helpCenterBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/help-center.browser.spec'), 'utf8');
const integrationsBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/integrations.browser.spec'), 'utf8');
const importBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/import.browser.spec'), 'utf8');
const importCsvBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/import-csv.browser.spec'), 'utf8');
const adminShellBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/admin-shell.browser.spec'), 'utf8');
const libraryMultiFormatBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/library-multiformat.browser.spec'), 'utf8');
const libraryLifecycleBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/library-lifecycle.browser.spec'), 'utf8');
const boundaryBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/boundary.browser.spec'), 'utf8');
const eventsCollectiblesBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/events-collectibles.browser.spec'), 'utf8');
const homelabHelpBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/homelab-help.browser.spec'), 'utf8');
const homelabSharedBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/homelab-shared.browser.spec'), 'utf8');
const homelabEditionBoundarySmokeSource = fs.readFileSync(require.resolve('../scripts/homelab-edition-boundary-smoke'), 'utf8');
const platformEditionBoundarySmokeSource = fs.readFileSync(require.resolve('../scripts/platform-edition-boundary-smoke'), 'utf8');
const dockerPublishWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/docker-publish.yml'), 'utf8');
const codeqlWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/codeql.yml'), 'utf8');
const codeqlConfigSource = fs.readFileSync(require.resolve('../../.github/codeql/codeql-config.yml'), 'utf8');
const codeqlMaintainedSourceSuite = fs.readFileSync(require.resolve('../../.github/codeql/collectz-maintained-source.qls'), 'utf8');
const codeqlModelPackSource = fs.readFileSync(require.resolve('../../.github/codeql/collectz-js-models/codeql-pack.yml'), 'utf8');
const codeqlRequestForgeryModelSource = fs.readFileSync(require.resolve('../../.github/codeql/collectz-js-models/models/request-forgery.model.yml'), 'utf8');
const stablePromotionWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/promote-stable.yml'), 'utf8');
const browserCapturesWorkflowSource = fs.readFileSync(require.resolve('../../.github/workflows/browser-captures.yml'), 'utf8');
const nowPlayingViewerBrowserSpecSource = fs.readFileSync(require.resolve('../../tests/playwright/specs/now-playing-viewer.browser.spec.js'), 'utf8');
const dockerComposeSource = fs.readFileSync(require.resolve('../../docker-compose.yml'), 'utf8');
const ciBuildComposePath = path.resolve(__dirname, '..', '..', '.ci', 'docker-compose.build.yml');
const ciBuildComposeSource = fs.existsSync(ciBuildComposePath)
  ? fs.readFileSync(ciBuildComposePath, 'utf8')
  : '';
const ciComposeOverrideGeneratorSource = fs.readFileSync(require.resolve('../../scripts/write-ci-compose-overrides'), 'utf8');
const releaseRoadmapSource = fs.readFileSync(require.resolve('../../docs/wiki/07-Release-Roadmap.md'), 'utf8');
const backlogSource = fs.readFileSync(require.resolve('../../docs/wiki/08-Backlog.md'), 'utf8');
const plexPmsModernizationDocSource = fs.readFileSync(require.resolve('../../docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md'), 'utf8');
const plexTrueSyncWorkflowPlanSource = fs.readFileSync(require.resolve('../../docs/wiki/52-Plex-True-Sync-Workflow-Plan.md'), 'utf8');
const plexServiceSource = fs.readFileSync(require.resolve('../services/plex'), 'utf8');
const outboundUrlPolicySource = fs.readFileSync(require.resolve('../services/outboundUrlPolicy'), 'utf8');
const kavitaServiceSource = fs.readFileSync(require.resolve('../services/kavita'), 'utf8');
const plexProviderDiscoverySmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-discovery-smoke'), 'utf8');
const plexProviderReadbackSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-readback-smoke'), 'utf8');
const plexProviderImportParitySmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-import-parity-smoke'), 'utf8');
const plexProviderItemListingDiscoverySmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-item-listing-discovery-smoke'), 'utf8');
const plexRealProviderItemRowParityProofSource = fs.readFileSync(require.resolve('../scripts/plex-real-provider-item-row-parity-proof'), 'utf8');
const plexProviderAdvertisedImportPathContractSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-advertised-import-path-contract-smoke'), 'utf8');
const plexProviderSectionsRootRuntimeSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-provider-sections-root-runtime-smoke'), 'utf8');
const plexNowPlayingProviderProofSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-now-playing-provider-proof-smoke'), 'utf8');
const plexNowPlayingReadbackSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-now-playing-readback-smoke'), 'utf8');
const plexRealNowPlayingRuntimeProofSource = fs.readFileSync(require.resolve('../scripts/plex-real-now-playing-runtime-proof'), 'utf8');
const plexNowPlayingViewerSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-now-playing-viewer-smoke'), 'utf8');
const plexWebhookRatingsContractSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-webhook-ratings-contract-smoke'), 'utf8');
const plexWebhookReceiverAdminSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-webhook-receiver-admin-smoke'), 'utf8');
const plexWatchStateSyncCadenceSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-watch-state-sync-cadence-smoke'), 'utf8');
const plexWatchStateApplySmokeSource = fs.readFileSync(require.resolve('../scripts/plex-watch-state-apply-smoke'), 'utf8');
const plexWatchStateRefreshSchedulerSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-watch-state-refresh-scheduler-smoke'), 'utf8');
const plexRatingApplySmokeSource = fs.readFileSync(require.resolve('../scripts/plex-rating-apply-smoke'), 'utf8');
const plexRatingWritebackSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-rating-writeback-smoke'), 'utf8');
const plexFullLibraryReconciliationSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-full-library-reconciliation-smoke'), 'utf8');
const plexReconciliationSyncSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-reconciliation-sync-smoke'), 'utf8');
const plexWatchedStateWritebackContractSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-watched-state-writeback-contract-smoke'), 'utf8');
const plexWatchedStateWritebackSmokeSource = fs.readFileSync(require.resolve('../scripts/plex-watched-state-writeback-smoke'), 'utf8');
const ciCdDeployDocSource = fs.readFileSync(require.resolve('../../docs/wiki/10-CI-CD-and-Registry-Deploy.md'), 'utf8');
const securityPolicyPath = path.resolve(__dirname, '..', '..', 'SECURITY.md');
const securityPolicySource = fs.existsSync(securityPolicyPath)
  ? fs.readFileSync(securityPolicyPath, 'utf8')
  : '';
const collectiblesNamingDecisionSource = fs.readFileSync(require.resolve('../../docs/wiki/39-Collectibles-Naming-Decision.md'), 'utf8');
const eventSocialPlanningFoundationSource = fs.readFileSync(require.resolve('../../docs/wiki/40-Event-Social-Planning-Foundation.md'), 'utf8');
const personalSchedIcsSyncSource = fs.readFileSync(require.resolve('../../docs/wiki/41-Personal-Sched-ICS-Sync.md'), 'utf8');
const eventSocialCompanionContractSource = fs.readFileSync(require.resolve('../../docs/wiki/42-Event-Social-Platform-Companion-Contract.md'), 'utf8');
const platformCompanionIcsVisibilitySource = fs.readFileSync(require.resolve('../../docs/wiki/43-Platform-Companion-ICS-Sync-Visibility.md'), 'utf8');
const platformCompanionOfflinePacketSource = fs.readFileSync(require.resolve('../../docs/wiki/44-Platform-Companion-Offline-Event-Packet.md'), 'utf8');
const eventScheduleCatalogFoundationSource = fs.readFileSync(require.resolve('../../docs/wiki/45-Event-Schedule-Catalog-Foundation.md'), 'utf8');
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
const collectibleTraitsSource = fs.readFileSync(require.resolve('../services/collectibleTraits'), 'utf8');
const collectibleTraitRecordsSource = fs.readFileSync(require.resolve('../services/collectibleTraitRecords'), 'utf8');
const { buildCollectibleTraits, formatNumberedValue } = require('../services/collectibleTraits');
const { normalizeTraitPayload } = require('../services/collectibleTraitRecords');

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

results.push(run('exclusiveSources parses SDCC Blog index cards without copying body content', () => {
  const html = `
    <article>
      <h2><a href="https://sdccblog.com/2026/06/martin-hsu-san-diego-comic-con-2026-exclusives-update-june-16/">Martin Hsu San Diego Comic-Con 2026 Exclusives [UPDATE June 16]</a></h2>
      <p>Martin Hsu will be at Booth #4530 with several new exclusives.</p>
    </article>
    <article>
      <h2><a href="/2026/06/jada-toys-san-diego-comic-con-2026-exclusives/">Jada Toys San Diego Comic-Con 2026 Exclusives</a></h2>
      <p>A second article.</p>
    </article>
  `;
  const candidates = extractArticleCandidatesFromIndex(html);
  assert.strictEqual(candidates.length, 2);
  assert.strictEqual(candidates[0].vendor, 'Martin Hsu');
  assert.strictEqual(candidates[0].booth, '#4530');
  assert.strictEqual(candidates[0].source_updated_label, 'June 16');
  assert.strictEqual(candidates[1].source_url, 'https://sdccblog.com/2026/06/jada-toys-san-diego-comic-con-2026-exclusives/');
  assert.strictEqual(providerKeyForUrl(candidates[1].source_url), 'sdccblog.com/2026/06/jada-toys-san-diego-comic-con-2026-exclusives');
  const article = extractArticleMetadata(
    '<html><head><meta property="og:title" content="Alex Ross San Diego Comic-Con 2026 Exclusives [Update June 16]" /></head><body>Visit Booth #2415.</body></html>',
    'https://sdccblog.com/2026/06/alex-ross-san-diego-comic-con-2026-exclusives/'
  );
  assert.strictEqual(article.vendor, 'Alex Ross');
  assert.strictEqual(article.booth, '#2415');
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

results.push(run('barcode.normalizeBarcodeMatches fans out distinct provider offer title variants', () => {
  const matches = normalizeBarcodeMatches({
    items: [
      {
        title: 'Crystal Star, The New Condition!',
        ean: '0076783005990',
        upc: '076783005990',
        model: 'BTB2147351610',
        offers: [
          { title: 'Before the Storm', merchant: 'Bookseller A' },
          { title: 'Crystal Star, The New Condition!', merchant: 'Bookseller B' },
          { title: 'Before the Storm #1 Black Fleet Crisis', merchant: 'Bookseller C' }
        ]
      }
    ]
  });

  assert.deepStrictEqual(matches.map((match) => match.title), [
    'Crystal Star, The New Condition!',
    'Before the Storm',
    'Before the Storm #1 Black Fleet Crisis'
  ]);
  assert.strictEqual(matches[0].match_type, 'provider_candidate');
  assert.strictEqual(matches[1].match_type, 'provider_title_variant');
  assert.strictEqual(matches[1].titleVariantSource, 'offer');
  assert.strictEqual(matches[1].offerIndex, 0);
  assert.ok(matches[0].alternateTitles.includes('Before the Storm'));
  assert.ok(matches[1].alternateTitles.includes('Crystal Star, The New Condition!'));
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

results.push(run('importIdentifiers.normalizeIsbn rejects checksum-valid non-ISBN EAN values', () => {
  assert.strictEqual(normalizeIsbn('0076783005990'), '');
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

results.push(run('media bulk delete uses one scoped endpoint instead of per-row delete requests', () => {
  assert.ok(validateMiddlewareSource.includes('const mediaBulkDeleteSchema = z.object({'));
  assert.ok(validateMiddlewareSource.includes("max(500, 'A maximum of 500 media ids can be deleted at once')"));
  assert.ok(mediaRoutesSource.includes("router.post('/bulk-delete'"));
  assert.ok(mediaRoutesSource.includes('WHERE id = ANY($1::int[])'));
  assert.ok(mediaRoutesSource.includes("'media.bulk_delete'"));
  assert.ok(openApiSource.includes('"/api/media/bulk-delete"'));
  assert.ok(openApiSource.includes('"MediaBulkDeleteRequest"'));
  assert.ok(openApiSource.includes('"MediaBulkDeleteResponse"'));
  assert.ok(useMediaApiSource.includes("apiCall('post', '/media/bulk-delete'"));
  assert.ok(!useMediaApiSource.includes("Promise.allSettled(\n      targetIds.map(async (id) => {\n        await apiCall('delete', `/media/${id}`);"));
  assert.ok(backendPackageJson.scripts['test:media-bulk-delete-smoke']);
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
  assert.ok(libraryMultiFormatBrowserSpecSource.includes('media drawer collapses only long overviews'));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("getByRole('button', { name: 'Show more', exact: true })"));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("toHaveAttribute('aria-expanded', 'false')"));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes("toHaveAttribute('aria-expanded', 'true')"));
  assert.ok(importBrowserSpecSource.includes("getByRole('tab', { name: 'Barcode', exact: true })).toHaveCount(0)"));
  assert.ok(importCsvBrowserSpecSource.includes("owned_formats).toEqual(['dvd', 'bluray', 'digital'])"));
}));

results.push(run('playwright library lifecycle regressions cover archive and transfer fallback in browser-visible shell state', () => {
  assert.ok(libraryLifecycleBrowserSpecSource.includes('archiving the active library falls back the browser shell onto a surviving accessible library'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes('transferring the active library away from the previous owner falls back the browser shell onto a surviving accessible library'));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("postWithCsrf(requestContext, `/api/libraries/${archiveTarget.id}/archive`"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("postWithCsrf(ownerContext, `/api/libraries/${transferTarget.id}/transfer`"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("getByRole('tablist', { name: 'Import sources' })"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("Bring titles into “${libraryName}” from files or connected services."));
  assert.ok(!importViewSource.includes('Bring titles into'));
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

  const lowercaseParsed = parseReleaseMarkdown(`# v9.9.10

## Summary
Lowercase release summary.

## What changed
### Release
- Kept CI release-note checks aligned with the Help release feed.
`);
  assert.strictEqual(lowercaseParsed.details[0].heading, 'Release');
  assert.strictEqual(lowercaseParsed.details[0].bullets[0], 'Kept CI release-note checks aligned with the Help release feed.');
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
    studio: 'Universal Pictures',
    parentIndex: '1',
    guid: 'plex://movie/abc?guid=tmdb://841',
    thumb: 'https://image.example/poster.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Dune');
  assert.strictEqual(out.media_type, 'movie');
  assert.strictEqual(out.tmdb_id, 841);
  assert.strictEqual(out.runtime, 136);
  assert.strictEqual(out.poster_path, 'https://image.example/poster.jpg');
  assert.strictEqual(out.network, null);
  assert.strictEqual(out.season_number, null);
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
    leafCount: '26',
    thumb: 'https://image.example/wall.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'The Wall');
  assert.strictEqual(out.media_type, 'audio');
  assert.strictEqual(out.tmdb_media_type, null);
  assert.strictEqual(out.type_details.artist, 'Pink Floyd');
  assert.strictEqual(out.type_details.album, 'The Wall');
  assert.strictEqual(out.type_details.track_count, 26);
  assert.strictEqual(out.type_details.compilation, null);
  assert.strictEqual(out.type_details.track_artists, null);
}));

results.push(run('plex.normalizePlexItem marks Various Artists albums as compilations', () => {
  assert.strictEqual(isPlexCompilationArtist('Various Artists'), true);
  assert.strictEqual(isPlexCompilationArtist('VA'), true);
  assert.strictEqual(isPlexCompilationArtist('Pink Floyd'), false);
  const input = {
    type: 'album',
    title: 'Movie Songs',
    parentTitle: 'Various Artists',
    originalTitle: 'Aimee Mann',
    leafCount: '18'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Movie Songs');
  assert.strictEqual(out.media_type, 'audio');
  assert.strictEqual(out.type_details.artist, 'Various Artists');
  assert.strictEqual(out.type_details.album, 'Movie Songs');
  assert.strictEqual(out.type_details.track_count, 18);
  assert.strictEqual(out.type_details.compilation, true);
  assert.strictEqual(out.type_details.track_artists, 'Aimee Mann');
}));

results.push(run('plex audio section import skips artist rows and keeps albums', () => {
  assert.strictEqual(shouldIncludePlexEntry('artist', 'artist'), false);
  assert.strictEqual(shouldIncludePlexEntry('artist', 'album'), true);
  assert.strictEqual(shouldIncludePlexEntry('artist', 'track'), false);
  assert.ok(plexServiceSource.includes('fetchPlexChildDirectoryEntries(config, artist)'));
  assert.ok(plexServiceSource.includes("String(entry.type || '').trim().toLowerCase() === 'album'"));
  assert.ok(plexServiceSource.includes("parentTitle: entry.parentTitle || parentArtist || null"));
}));

results.push(run('plex audio import persists album details and Library renders them', () => {
  assert.ok(mediaRoutesSource.includes('type_details = CASE'));
  assert.ok(mediaRoutesSource.includes('COALESCE(type_details,'));
  assert.ok(mediaRoutesSource.includes('media.type_details ? JSON.stringify(media.type_details) : null'));
  assert.ok(mediaRoutesSource.includes('type_details, library_id, space_id, added_by, import_source'));
  assert.ok(libraryViewSource.includes('const audioDetailRows = isAudio'));
  assert.ok(libraryViewSource.includes("['Album', typeDetails.album || item.title]"));
  assert.ok(libraryViewSource.includes("['Artist', typeDetails.artist]"));
  assert.ok(libraryViewSource.includes("['Tracks', typeDetails.track_count]"));
  assert.ok(libraryViewSource.includes("['Compilation', typeDetails.compilation === true || typeDetails.compilation === 'true' ? 'Yes' : null]"));
  assert.ok(libraryViewSource.includes("['Track artists', typeDetails.track_artists]"));
  assert.ok(libraryViewSource.includes('Album details'));
}));

results.push(run('plex audio import repairs album titles only for strong Plex identity matches', () => {
  assert.ok(mediaRoutesSource.includes('function shouldRepairPlexAudioTitle(currentRow = {}, incomingMedia = {})'));
  assert.ok(mediaRoutesSource.includes("existingMatchedBy === 'plex_guid' || existingMatchedBy === 'plex_item_key'"));
  assert.ok(mediaRoutesSource.includes('title = CASE WHEN $21::boolean THEN $22 ELSE title END'));
  assert.ok(mediaRoutesSource.includes('if (canRepairAudioTitle) audioTitlesRepaired += 1;'));
  assert.ok(mediaRoutesSource.includes('audioTitlesRepaired: result.audioTitlesRepaired'));
  assert.ok(!mediaRoutesSource.includes("existingMatchedBy === 'title_year' && shouldRepairPlexAudioTitle"));
}));

results.push(run('workspace activity can scope import logs by sync job and explicit scope details', () => {
  assert.ok(mediaRoutesSource.includes('function scopedActivityDetails(scopeContext, details = {})'));
  assert.ok(mediaRoutesSource.includes("scopedActivityDetails(effectiveScopeContext, {"));
  assert.ok(spacesRoutesSource.includes("FROM sync_jobs sj"));
  assert.ok(spacesRoutesSource.includes("sj.id::text = COALESCE(al.details->>'jobId', '')"));
  assert.ok(dashboardRoutesSource.includes("COALESCE(sj.scope->>'spaceId', sj.scope->>'space_id', '')"));
  assert.ok(dashboardRoutesSource.includes("COALESCE(sj.scope->>'libraryId', sj.scope->>'library_id', '')"));
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

results.push(run('plex PMS modernization contract keeps provider discovery separate from documented import paths', () => {
  const contract = buildPlexPmsModernizationContract();
  assert.strictEqual(contract.currentMode, 'documented-library-provider-paths');
  assert.strictEqual(contract.nextMode, 'provider-advertised-library-paths');
  assert.strictEqual(contract.providerDiscoveryPath, '/media/providers');
  assert.ok(contract.documentedImportPaths.includes('/library/sections/all'));
  assert.ok(contract.documentedImportPaths.includes('/library/metadata/:ids/allLeaves'));
  assert.ok(contract.legacyImportPaths.includes('/library/sections/:sectionId/all'));
  assert.ok(contract.legacyImportPaths.includes('/library/metadata/:ratingKey/allLeaves'));
  assert.ok(contract.migrationRules.some((rule) => rule.includes('Treat /media/providers as capability discovery')));
  assert.ok(contract.migrationRules.some((rule) => rule.includes('Keep existing Plex import')));
  assert.ok(contract.migrationRules.some((rule) => rule.includes('Prefer JSON')));
  assert.ok(contract.candidateProofSlices.includes('Now Playing Viewer provider proof'));
}));

results.push(run('plex media provider parser normalizes JSON and XML provider discovery payloads', () => {
  const jsonProviders = parsePlexMediaProviders({
    MediaContainer: {
      MediaProvider: [
        {
          key: 'com.plexapp.plugins.library',
          title: 'Library',
          type: 'library',
          protocol: 'plex',
          Feature: [{ key: 'browse' }, { key: 'timeline' }]
        }
      ]
    }
  });
  assert.strictEqual(jsonProviders.length, 1);
  const normalizedJson = normalizePlexMediaProvider(jsonProviders[0]);
  assert.strictEqual(normalizedJson.key, 'com.plexapp.plugins.library');
  assert.strictEqual(normalizedJson.title, 'Library');
  assert.deepStrictEqual(normalizedJson.featureKeys, ['browse', 'timeline']);

  const xmlProviders = parsePlexMediaProviders('<MediaContainer><MediaProvider key="epg" title="Guide" type="epg" protocol="plex" /></MediaContainer>');
  assert.strictEqual(xmlProviders.length, 1);
  const normalizedXml = normalizePlexMediaProvider(xmlProviders[0]);
  assert.strictEqual(normalizedXml.key, 'epg');
  assert.strictEqual(normalizedXml.title, 'Guide');
  assert.strictEqual(normalizedXml.type, 'epg');
}));

results.push(run('plex now-playing parser normalizes JSON and XML session payloads safely', () => {
  const jsonSessions = parsePlexNowPlayingSessions({
    MediaContainer: {
      Metadata: [{
        ratingKey: '123',
        sessionKey: 'abc',
        type: 'episode',
        title: 'Pilot',
        grandparentTitle: 'Example Show',
        key: '/library/metadata/123',
        thumb: '/library/metadata/123/thumb/1700000000',
        art: 'https://plex.example.invalid/library/metadata/123/art/1700000000?X-Plex-Token=must-not-surface',
        playQueueItemID: '42',
        duration: 1000,
        viewOffset: 250,
        User: { title: 'Viewer', token: 'must-not-surface' },
        Player: { title: 'Living Room', state: 'playing', address: '192.168.1.10' },
        Media: [{ Part: [{ file: '/private/example.mkv' }] }]
      }]
    }
  });
  assert.strictEqual(jsonSessions.length, 1);
  const normalizedJson = normalizePlexNowPlayingSession(jsonSessions[0]);
  assert.strictEqual(normalizedJson.title, 'Pilot');
  assert.strictEqual(normalizedJson.type, 'episode');
  assert.strictEqual(normalizedJson.grandparentTitle, 'Example Show');
  assert.strictEqual(normalizedJson.progressPercent, 25);
  assert.strictEqual(normalizedJson.metadataKey, '/library/metadata/123');
  assert.strictEqual(normalizedJson.thumbKey, '/library/metadata/123/thumb/1700000000');
  assert.strictEqual(normalizedJson.artKey, null);
  assert.strictEqual(normalizedJson.hasQueueItem, true);
  assert.deepStrictEqual(normalizedJson.user, { title: 'Viewer', username: null, id: null });
  assert.deepStrictEqual(normalizedJson.player, { title: 'Living Room', product: null, state: 'playing', platform: null });
  assert.ok(!JSON.stringify(normalizedJson).includes('/private/example.mkv'));
  assert.ok(!JSON.stringify(normalizedJson).includes('192.168.1.10'));
  assert.ok(!JSON.stringify(normalizedJson).includes('must-not-surface'));

  const xmlSessions = parsePlexNowPlayingSessions('<MediaContainer><Video ratingKey="456" sessionKey="def" type="movie" title="Example Movie" duration="2000" viewOffset="500"><User title="Viewer" /><Player title="Web" state="paused" /></Video></MediaContainer>');
  assert.strictEqual(xmlSessions.length, 1);
  const normalizedXml = normalizePlexNowPlayingSession(xmlSessions[0]);
  assert.strictEqual(normalizedXml.ratingKey, '456');
  assert.strictEqual(normalizedXml.type, 'movie');
  assert.strictEqual(normalizedXml.progressPercent, 25);
  assert.strictEqual(normalizedXml.player.state, 'paused');
}));

results.push(run('plex webhook and ratings contract normalizes event hints and writeback shape safely', () => {
  const contract = buildPlexWebhookAndRatingsContract();
  assert.ok(contract.inboundEvents.includes('library.new'));
  assert.ok(contract.inboundEvents.includes('media.scrobble'));
  assert.ok(contract.inboundEvents.includes('media.rate'));
  assert.strictEqual(contract.ratingWriteback.path, '/:/rate');
  assert.strictEqual(contract.watchedStateWriteback.status, 'future_explicit_opt_in');

  const normalized = normalizePlexWebhookEvent({
    event: 'media.rate',
    Metadata: {
      ratingKey: '789',
      title: 'Rated Example',
      userRating: 9,
      thumb: 'https://plex.example.invalid/thumb?X-Plex-Token=must-not-surface',
      Media: [{ Part: [{ file: '/mnt/plex-media/Rated Example.mkv' }] }]
    },
    Server: { title: 'Home Plex', uuid: 'server-uuid-secret' }
  });
  assert.strictEqual(normalized.supported, true);
  assert.strictEqual(normalized.action, 'refresh_rating');
  assert.strictEqual(normalized.ratingKey, '789');
  assert.strictEqual(normalized.metadata.userRating, 9);
  assert.strictEqual(normalized.metadataReadbackPath, '/library/metadata/789');
  assert.ok(!JSON.stringify(normalized).includes('must-not-surface'));
  assert.ok(!JSON.stringify(normalized).includes('/mnt/plex-media'));
  assert.ok(!JSON.stringify(normalized).includes('server-uuid-secret'));

  const scrobble = normalizePlexWebhookEvent({
    payload: JSON.stringify({
      event: 'media.scrobble',
      Metadata: { ratingKey: '456', title: 'Watched Example' }
    })
  });
  assert.strictEqual(scrobble.action, 'refresh_watched_state');

  const writeback = buildPlexRatingWritebackRequest({ ratingKey: '789', rating: 9, ratedAt: '2026-05-08T03:30:00.000Z' });
  assert.deepStrictEqual(writeback, {
    method: 'PUT',
    path: '/:/rate',
    params: {
      identifier: 'com.plexapp.plugins.library',
      key: '789',
      rating: 9,
      ratedAt: 1778211000
    }
  });
}));

results.push(run('plex rating readback normalizes user ratings without treating provider rating as user rating', () => {
  const entry = normalizePlexRatingEntry({
    ratingKey: '321',
    type: 'movie',
    title: 'Rated Example',
    userRating: '8.5',
    rating: '6.2'
  });
  assert.strictEqual(entry.ratingKey, '321');
  assert.strictEqual(entry.userRating, 8.5);
  const noUserRating = normalizePlexRatingEntry({
    ratingKey: '322',
    type: 'movie',
    title: 'Provider Rated Only',
    rating: '9.1'
  });
  assert.strictEqual(noUserRating.userRating, null);
  const xmlEntries = parsePlexRatingEntries('<MediaContainer><Video ratingKey="323" type="movie" title="XML Rated" userRating="7" rating="5.5" /></MediaContainer>');
  assert.strictEqual(xmlEntries.length, 1);
  assert.strictEqual(xmlEntries[0].userRating, 7);
}));

results.push(run('plex watch-state sync contract normalizes read-only watched progress safely', () => {
  const contract = buildPlexWatchStateSyncContract();
  assert.strictEqual(contract.status, 'read_only_contract');
  assert.strictEqual(contract.cadence.defaultIntervalMinutes, 60);
  assert.strictEqual(contract.cadence.minimumIntervalMinutes, 15);
  assert.ok(contract.readPaths.includes('/library/metadata/:ratingKey'));
  assert.ok(contract.readPaths.includes('/library/metadata/:ratingKey/allLeaves'));
  assert.strictEqual(contract.applyBehavior.collectzMutation, 'future_explicit_opt_in');
  assert.strictEqual(contract.applyBehavior.plexWriteback, 'future_explicit_opt_in');

  const jsonEntries = parsePlexWatchStateEntries({
    MediaContainer: {
      Metadata: [
        {
          ratingKey: '1001',
          type: 'movie',
          title: 'Watched Movie',
          viewCount: 1,
          lastViewedAt: 1778250000,
          duration: 7200000,
          viewOffset: 0,
          Media: [{ Part: [{ file: '/mnt/plex-media/Watched Movie.mkv' }] }]
        },
        {
          ratingKey: '1002',
          type: 'movie',
          title: 'Paused Movie',
          viewCount: 0,
          duration: 7200000,
          viewOffset: 1800000,
          thumb: 'https://plex.example.invalid/thumb?X-Plex-Token=must-not-surface'
        }
      ]
    }
  });
  assert.strictEqual(jsonEntries.length, 2);
  assert.strictEqual(jsonEntries[0].watchState, 'completed');
  assert.strictEqual(jsonEntries[1].watchState, 'in_progress');
  assert.strictEqual(jsonEntries[1].progressPercent, 25);
  assert.ok(!JSON.stringify(jsonEntries).includes('/mnt/plex-media'));
  assert.ok(!JSON.stringify(jsonEntries).includes('must-not-surface'));

  const xmlEntries = parsePlexWatchStateEntries('<MediaContainer><Video ratingKey="1003" type="episode" title="Unwatched Episode" viewCount="0" duration="1800000" viewOffset="0" parentIndex="1" index="2" /></MediaContainer>');
  assert.strictEqual(xmlEntries.length, 1);
  assert.strictEqual(xmlEntries[0].watchState, 'unwatched');
  assert.strictEqual(xmlEntries[0].seasonNumber, 1);
  assert.strictEqual(xmlEntries[0].episodeNumber, 2);
  assert.strictEqual(normalizePlexWatchedStateEntry({ title: 'Missing Rating Key' }), null);
}));

results.push(run('plex watched-state writeback contract builds PUT scrobble and unscrobble requests safely', () => {
  const contract = buildPlexWatchedStateWritebackContract();
  assert.strictEqual(contract.status, 'contract_proof_only');
  assert.strictEqual(contract.method, 'PUT');
  assert.strictEqual(contract.identifier, 'com.plexapp.plugins.library');
  assert.strictEqual(contract.actions.scrobble.path, '/:/scrobble');
  assert.strictEqual(contract.actions.unscrobble.path, '/:/unscrobble');

  const scrobble = buildPlexWatchedStateWritebackRequest({ ratingKey: '5001', action: 'scrobble' });
  assert.deepStrictEqual(scrobble, {
    method: 'PUT',
    path: '/:/scrobble',
    action: 'scrobble',
    watched: true,
    params: {
      identifier: 'com.plexapp.plugins.library',
      key: '5001'
    }
  });

  const unscrobble = buildPlexWatchedStateWritebackRequest({ ratingKey: '5001', watched: false });
  assert.strictEqual(unscrobble.method, 'PUT');
  assert.strictEqual(unscrobble.path, '/:/unscrobble');
  assert.strictEqual(unscrobble.action, 'unscrobble');
  assert.strictEqual(unscrobble.watched, false);
}));

results.push(run('plex PMS modernization foundation is promoted and documented without replacing legacy imports', () => {
  assert.ok(releaseRoadmapSource.includes('3.4.111 — Plex PMS API Modernization Foundation'));
  assert.ok(!backlogSource.includes('### Backlog Item: Plex PMS API Modernization Foundation'));
  assert.ok(plexPmsModernizationDocSource.includes('/media/providers'));
  assert.ok(plexPmsModernizationDocSource.includes('/library/sections/:sectionId/all'));
  assert.ok(plexPmsModernizationDocSource.includes('Keep existing Plex import'));
  assert.ok(plexPmsModernizationDocSource.includes('Now Playing Viewer provider proof'));
}));

results.push(run('plex webhook and ratings sync contract smoke stays scoped and secret-free', () => {
  assert.ok(backendPackageJson.scripts['test:plex-webhook-ratings-contract-smoke']);
  assert.ok(plexWebhookRatingsContractSmokeSource.includes('normalizePlexWebhookEvent'));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes('buildPlexRatingWritebackRequest'));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes("event: 'library.new'"));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes("event: 'media.scrobble'"));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes("event: 'media.rate'"));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes('/:/rate'));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes("artifacts', 'plex-webhooks'"));
  assert.ok(plexWebhookRatingsContractSmokeSource.includes('plex-webhook-ratings-contract-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.122 — Plex Webhook and Ratings Sync Contract'));
}));

results.push(run('plex watch-state sync cadence smoke stays read-only and secret-free', () => {
  assert.ok(backendPackageJson.scripts['test:plex-watch-state-sync-cadence-smoke']);
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes('buildPlexWatchStateSyncContract'));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes('fetchPlexWatchStateSnapshot'));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes("watchState === 'completed'"));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes("watchState === 'in_progress'"));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes("watchState === 'unwatched'"));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes('/library/metadata/2001/allLeaves'));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes("'plex-watch-state'"));
  assert.ok(plexWatchStateSyncCadenceSmokeSource.includes('plex-watch-state-sync-cadence-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.128 — Plex Watch-State Sync Cadence Contract'));
}));

results.push(run('plex watched-state apply smoke updates existing rows without Plex writeback', () => {
  assert.ok(backendPackageJson.scripts['test:plex-watch-state-apply-smoke']);
  assert.ok(mediaRoutesSource.includes("router.post('/apply-plex-watch-state'"));
  assert.ok(mediaRoutesSource.includes('fetchPlexWatchStateSnapshot'));
  assert.ok(mediaRoutesSource.includes('applyPlexWatchStateEntries'));
  assert.ok(mediaRoutesSource.includes("'plex_watch_state'"));
  assert.ok(mediaRoutesSource.includes("'media.plex.watch_state.apply'"));
  assert.ok(openApiSource.includes('/api/media/apply-plex-watch-state'));
  assert.ok(plexWatchStateApplySmokeSource.includes('/api/media/apply-plex-watch-state'));
  assert.ok(plexWatchStateApplySmokeSource.includes('mediaCountBefore'));
  assert.ok(plexWatchStateApplySmokeSource.includes('mediaCountAfter'));
  assert.ok(plexWatchStateApplySmokeSource.includes('No new media rows were created during watched-state apply'));
  assert.ok(plexWatchStateApplySmokeSource.includes('/:/scrobble'));
  assert.ok(plexWatchStateApplySmokeSource.includes('assertSecretFree'));
  assert.ok(plexWatchStateApplySmokeSource.includes('plex-watch-state-apply-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.129 — Plex Watched-State Apply Implementation'));
}));

results.push(run('plex watched-state refresh scheduler reuses apply path without Plex writeback', () => {
  assert.ok(backendPackageJson.scripts['test:plex-watch-state-refresh-scheduler-smoke']);
  assert.ok(mediaRoutesSource.includes('getPlexWatchStateRefreshRuntimeConfig'));
  assert.ok(mediaRoutesSource.includes('PLEX_WATCH_STATE_REFRESH_ENABLED'));
  assert.ok(mediaRoutesSource.includes('collectPlexWatchStateRefreshTargets'));
  assert.ok(mediaRoutesSource.includes('runPlexWatchStateRefreshOnce'));
  assert.ok(mediaRoutesSource.includes('fetchPlexRatingSnapshot(config'));
  assert.ok(mediaRoutesSource.includes('applyPlexRatingEntries'));
  assert.ok(mediaRoutesSource.includes('ratingReadbackKeys'));
  assert.ok(mediaRoutesSource.includes('lastRatingReadEntries'));
  assert.ok(mediaRoutesSource.includes('ratingsUpdated'));
  assert.ok(mediaRoutesSource.includes('startPlexWatchStateRefreshScheduler'));
  assert.ok(mediaRoutesSource.includes('getEffectivePlexWatchStateRefreshRuntimeConfig'));
  assert.ok(mediaRoutesSource.includes('loadAdminIntegrationConfig'));
  assert.ok(mediaRoutesSource.includes('normalizePlexReadbackRefreshSettings'));
  assert.ok(mediaRoutesSource.includes("router.get('/plex-watch-state/refresh-scheduler'"));
  assert.ok(mediaRoutesSource.includes("router.post('/plex-watch-state/refresh-scheduler/run'"));
  assert.ok(mediaRoutesSource.includes("'media.plex.watch_state.refresh'"));
  assert.ok(serverSource.includes('startPlexWatchStateRefreshScheduler'));
  assert.ok(serverSource.includes('await mediaRouter.startPlexWatchStateRefreshScheduler'));
  assert.ok(serverSource.includes('plexWatchRefresh='));
  assert.ok(integrationsServiceSource.includes('normalizePlexReadbackRefreshSettings'));
  assert.ok(integrationsRoutesSource.includes('plexReadbackRefreshSettings'));
  assert.ok(migrationsSource.includes('version: 114'));
  assert.ok(initSqlSource.includes('plex_readback_refresh_enabled BOOLEAN DEFAULT false'));
  assert.ok(initSqlSource.includes("(114, 'Add persisted Plex readback refresh settings')"));
  assert.ok(openApiSource.includes('/api/media/plex-watch-state/refresh-scheduler'));
  assert.ok(openApiSource.includes('/api/media/plex-watch-state/refresh-scheduler/run'));
  assert.ok(!dockerComposeSource.includes('PLEX_WATCH_STATE_REFRESH_ENABLED'));
  assert.ok(mediaRoutesSource.includes("process.env.PLEX_WATCH_STATE_REFRESH_ENABLED ?? 'false'"));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('/api/media/plex-watch-state/refresh-scheduler'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('/api/media/plex-watch-state/refresh-scheduler/run'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('schedulerDefaultEnabled'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('No new media rows were created during watched-state refresh'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('/:/scrobble'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWatchStateRefreshSchedulerSmokeSource.includes('plex-watch-state-refresh-scheduler-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.130 — Plex Watched-State Scheduled Refresh'));
}));

results.push(run('plex watched-state writeback contract smoke proves PUT scrobble and unscrobble only against fake PMS', () => {
  assert.ok(backendPackageJson.scripts['test:plex-watched-state-writeback-contract-smoke']);
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('buildPlexWatchedStateWritebackContract'));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('sendPlexWatchedStateWriteback'));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('/:/scrobble'));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('/:/unscrobble'));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes("method === 'PUT'"));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWatchedStateWritebackContractSmokeSource.includes('plex-watched-state-writeback-contract-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.132 — Plex Watched-State Writeback Contract'));
}));

results.push(run('plex watched-state writeback implementation stays explicit and episode-aware for TV', () => {
  assert.ok(backendPackageJson.scripts['test:plex-watched-state-writeback-smoke']);
  assert.ok(plexServiceSource.includes('sendPlexWatchedStateWriteback'));
  assert.ok(mediaRoutesSource.includes("router.post('/write-plex-watch-state'"));
  assert.ok(mediaRoutesSource.includes('writePlexWatchStateForMedia'));
  assert.ok(mediaRoutesSource.includes("'media.plex.watch_state.writeback'"));
  assert.ok(mediaRoutesSource.includes("'plex_watch_writeback_last_action'"));
  assert.ok(mediaRoutesSource.includes('episodeWriteback'));
  assert.ok(mediaRoutesSource.includes('fetchPlexWatchStateSnapshot(config'));
  assert.ok(mediaRoutesSource.includes('plex_watch_writeback_episode_count'));
  assert.ok(openApiSource.includes('/api/media/write-plex-watch-state'));
  assert.ok(openApiSource.includes('"seasonNumber"'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('/api/media/write-plex-watch-state'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('/:/scrobble'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('/:/unscrobble'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('/library/metadata/7200/allLeaves'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('TV season writeback resolved Plex episode leaves before scrobbling episode keys'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes("method === 'PUT'"));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('No new media rows were created during watched-state writeback'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWatchedStateWritebackSmokeSource.includes('plex-watched-state-writeback-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.133 — Plex Watched-State Writeback Implementation'));
  assert.ok(releaseRoadmapSource.includes('3.4.142 — Plex Episode-Aware TV Sync and Writeback'));
}));

results.push(run('plex rating apply smoke updates existing user rating without Plex writeback', () => {
  assert.ok(backendPackageJson.scripts['test:plex-rating-apply-smoke']);
  assert.ok(plexServiceSource.includes('fetchPlexRatingSnapshot'));
  assert.ok(plexServiceSource.includes('normalizePlexRatingEntry'));
  assert.ok(mediaRoutesSource.includes("router.post('/apply-plex-ratings'"));
  assert.ok(mediaRoutesSource.includes('applyPlexRatingEntries'));
  assert.ok(mediaRoutesSource.includes("'media.plex.rating.apply'"));
  assert.ok(mediaRoutesSource.includes("'plex_user_rating'"));
  assert.ok(openApiSource.includes('/api/media/apply-plex-ratings'));
  assert.ok(plexRatingApplySmokeSource.includes('/api/media/apply-plex-ratings'));
  assert.ok(plexRatingApplySmokeSource.includes('user_rating'));
  assert.ok(plexRatingApplySmokeSource.includes('No new media rows were created during rating apply'));
  assert.ok(plexRatingApplySmokeSource.includes('/:/rate'));
  assert.ok(plexRatingApplySmokeSource.includes('assertSecretFree'));
  assert.ok(plexRatingApplySmokeSource.includes('plex-rating-apply-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.131 — Plex Rating Readback Apply Implementation'));
}));

results.push(run('plex rating writeback implementation stays explicit and single-row scoped', () => {
  assert.ok(backendPackageJson.scripts['test:plex-rating-writeback-smoke']);
  assert.ok(plexServiceSource.includes('sendPlexRatingWriteback'));
  assert.ok(plexServiceSource.includes('buildPlexRatingWritebackRequest'));
  assert.ok(mediaRoutesSource.includes("router.post('/write-plex-rating'"));
  assert.ok(mediaRoutesSource.includes('writePlexRatingForMedia'));
  assert.ok(mediaRoutesSource.includes("'media.plex.rating.writeback'"));
  assert.ok(mediaRoutesSource.includes("'plex_rating_writeback_rating'"));
  assert.ok(openApiSource.includes('/api/media/write-plex-rating'));
  assert.ok(plexRatingWritebackSmokeSource.includes('/api/media/write-plex-rating'));
  assert.ok(plexRatingWritebackSmokeSource.includes('/:/rate'));
  assert.ok(plexRatingWritebackSmokeSource.includes("Number(url.searchParams.get('rating')) === 7"));
  assert.ok(plexRatingWritebackSmokeSource.includes("method === 'PUT'"));
  assert.ok(plexRatingWritebackSmokeSource.includes('No new media rows were created during rating writeback'));
  assert.ok(plexRatingWritebackSmokeSource.includes('assertSecretFree'));
  assert.ok(plexRatingWritebackSmokeSource.includes('plex-rating-writeback-smoke.json'));
  assert.ok(releaseRoadmapSource.includes('3.4.134 — Plex Rating Writeback to Plex'));
}));

results.push(run('media user ratings are stored on a 0-10 provider scale while UI keeps five stars', () => {
  assert.ok(validateMiddlewareSource.includes('user_rating: nullableNumberSchema(z.number().min(0).max(10))'));
  assert.ok(migrationsSource.includes('version: 99'));
  assert.ok(migrationsSource.includes("description: 'Normalize user ratings to 0-10 provider scale'"));
  assert.ok(migrationsSource.includes('SET user_rating = ROUND((user_rating * 2)::numeric, 1)'));
  assert.ok(initSqlSource.includes('user_rating DECIMAL(3,1) CHECK'));
  assert.ok(initSqlSource.includes("(99, 'Normalize user ratings to 0-10 provider scale')"));
  assert.ok(libraryViewSource.includes('function userRatingToStars'));
  assert.ok(libraryViewSource.includes('function starsToUserRating'));
  assert.ok(libraryViewSource.includes('rating / 2'));
  assert.ok(libraryViewSource.includes('* 2).toFixed(1)'));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes('rating: 8'));
}));

results.push(run('plex writeback controls are admin-only and scoped to Plex-linked detail rows', () => {
  assert.ok(libraryViewSource.includes('function PlexWritebackControls'));
  assert.ok(libraryViewSource.includes('data-testid="plex-writeback-controls"'));
  assert.ok(libraryViewSource.includes('data-testid="plex-rating-writeback-button"'));
  assert.ok(libraryViewSource.includes('data-testid="plex-watch-scrobble-button"'));
  assert.ok(libraryViewSource.includes('data-testid="plex-watch-unscrobble-button"'));
  assert.ok(libraryViewSource.includes("apiCall('post', '/media/write-plex-rating'"));
  assert.ok(libraryViewSource.includes("apiCall('post', '/media/write-plex-watch-state'"));
  assert.ok(libraryViewSource.includes('canWriteRating'));
  assert.ok(libraryViewSource.includes('canWriteWatchState'));
  assert.ok(libraryViewSource.includes('const showPlexWritebackControls = canWritePlexRating || canWritePlexWatchState;'));
  assert.ok(libraryViewSource.includes('plex-season-watch-scrobble-button'));
  assert.ok(libraryViewSource.includes('seasonNumber'));
  assert.ok(libraryViewSource.includes('canWritePlex={canWritePlex}'));
  assert.ok(dashboardContentSource.includes('plexWritebackSettings'));
  assert.ok(dashboardContentSource.includes("canWritePlex={user?.role === 'admin' ? plexWritebackSettings : false}"));
  assert.ok(integrationsRoutesSource.includes('plexWritebackSettings'));
  assert.ok(integrationsServiceSource.includes('normalizePlexWritebackSettings'));
  assert.ok(migrationsSource.includes('version: 113'));
  assert.ok(initSqlSource.includes('plex_rating_writeback_enabled BOOLEAN DEFAULT false'));
  assert.ok(initSqlSource.includes('plex_watch_state_writeback_enabled BOOLEAN DEFAULT false'));
  assert.ok(mediaRoutesSource.includes('Plex rating writeback is disabled in integration settings'));
  assert.ok(mediaRoutesSource.includes('Plex watched-state writeback is disabled in integration settings'));
  assert.ok(adminIntegrationsViewSource.includes('Allow rating writeback to Plex'));
  assert.ok(adminIntegrationsViewSource.includes('Allow watched-state writeback to Plex'));
  assert.ok(mediaRoutesSource.includes('AS plex_linked'));
  assert.ok(mediaRoutesSource.includes('plex_linked: Boolean(row.plex_linked)'));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes('admin sees explicit Plex writeback controls on Plex-linked media detail'));
  assert.ok(libraryMultiFormatBrowserSpecSource.includes('plex-rating-writeback-button'));
  assert.ok(releaseRoadmapSource.includes('3.4.135 — Plex Writeback UI Controls'));
}));

results.push(run('plex full-library reconciliation preview stays read-only and classifies match buckets', () => {
  assert.ok(backendPackageJson.scripts['test:plex-full-library-reconciliation-smoke']);
  assert.ok(backendPackageJson.scripts['test:plex-reconciliation-preview-job-smoke']);
  assert.ok(backendPackageJson.scripts['test:plex-reconciliation-sync-smoke']);
  assert.ok(mediaRoutesSource.includes("router.post('/plex-reconciliation-preview'"));
  assert.ok(mediaRoutesSource.includes("router.post('/plex-reconciliation-preview/run'"));
  assert.ok(mediaRoutesSource.includes("router.post('/plex-reconciliation-sync/run'"));
  assert.ok(mediaRoutesSource.includes("router.get('/plex-reconciliation-conflicts'"));
  assert.ok(mediaRoutesSource.includes("router.post('/plex-reconciliation-conflicts/:id/resolve'"));
  assert.ok(mediaRoutesSource.includes('persistPlexReconciliationConflictReviews'));
  assert.ok(mediaRoutesSource.includes('buildPlexFullLibraryReconciliationPreview'));
  assert.ok(mediaRoutesSource.includes('runPlexReconciliationPreviewJob'));
  assert.ok(mediaRoutesSource.includes('runPlexReconciliationSyncJob'));
  assert.ok(mediaRoutesSource.includes('getPlexReconciliationSyncRuntimeConfig'));
  assert.ok(mediaRoutesSource.includes('getEffectivePlexReconciliationSyncRuntimeConfig'));
  assert.ok(mediaRoutesSource.includes('hasPlexReconciliationSyncEnvOverride'));
  assert.ok(mediaRoutesSource.includes('startPlexReconciliationSyncScheduler'));
  assert.ok(mediaRoutesSource.includes('runPlexReconciliationSyncSchedulerOnce'));
  assert.ok(mediaRoutesSource.includes('parsePlexReconciliationLimit'));
  assert.ok(mediaRoutesSource.includes('normalizePlexReconciliationSyncSettings'));
  assert.ok(mediaRoutesSource.includes('PLEX_RECONCILIATION_SYNC_ENABLED'));
  assert.ok(mediaRoutesSource.includes("router.get('/plex-reconciliation-sync/scheduler'"));
  assert.ok(mediaRoutesSource.includes("router.post('/plex-reconciliation-sync/scheduler/run'"));
  assert.ok(mediaRoutesSource.includes('buildPlexReconciliationSyncPlan'));
  assert.ok(mediaRoutesSource.includes("processingMode: 'full_library_reconciliation_sync'"));
  assert.ok(mediaRoutesSource.includes("processingMode: 'scheduled_full_library_reconciliation_sync'"));
  assert.ok(mediaRoutesSource.includes("jobType: 'plex_reconciliation_preview'"));
  assert.ok(mediaRoutesSource.includes("jobType: 'plex_reconciliation_sync'"));
  assert.ok(mediaRoutesSource.includes('full_library_reconciliation_preview'));
  assert.ok(serverSource.includes('startPlexReconciliationSyncScheduler'));
  assert.ok(serverSource.includes('plexReconciliationSync='));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-preview'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-preview/run'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-sync/run'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-conflicts'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-conflicts/{id}/resolve'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-sync/scheduler'));
  assert.ok(openApiSource.includes('/api/media/plex-reconciliation-sync/scheduler/run'));
  assert.ok(!dockerComposeSource.includes('PLEX_RECONCILIATION_SYNC_ENABLED'));
  assert.ok(mediaRoutesSource.includes("process.env.PLEX_RECONCILIATION_SYNC_ENABLED ?? 'false'"));
  assert.ok(integrationsServiceSource.includes('DEFAULT_PLEX_RECONCILIATION_SYNC_SETTINGS'));
  assert.ok(integrationsServiceSource.includes('plexReconciliationSyncSettings'));
  assert.ok(integrationsRoutesSource.includes('plex_reconciliation_sync_enabled'));
  assert.ok(integrationsRoutesSource.includes('plexReconciliationSyncSettings'));
  assert.ok(integrationResponseSource.includes('plexReconciliationSyncSettings'));
  assert.ok(migrationsSource.includes('version: 111'));
  assert.ok(migrationsSource.includes('plex_reconciliation_sync_interval_minutes'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('/api/media/plex-reconciliation-preview'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('/api/media/plex-reconciliation-preview/run'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('/api/media/sync-jobs/${jobId}/result'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('plex_reconciliation_preview'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('alreadyLinked'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('wouldUpdate'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('wouldCreate'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('conflict'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('Queued reconciliation preview job stored the same read-only bucket summary in sync job history'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('No collectZ media rows were created or updated by the preview'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('assertSecretFree'));
  assert.ok(plexFullLibraryReconciliationSmokeSource.includes('plex-full-library-reconciliation-smoke.json'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('/api/media/plex-reconciliation-sync/run'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('plex_reconciliation_sync'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('fullScanExceededOldCap'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Expected full scan beyond the old 1000-row cap'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Expected one auto-created row'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Expected one strong-ID update'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Expected one conflict for review'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('/api/media/plex-reconciliation-conflicts?status=open'));
  assert.ok(plexReconciliationSyncSmokeSource.includes("action: 'create_separate'"));
  assert.ok(plexReconciliationSyncSmokeSource.includes("action: 'attach_existing'"));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Attach-existing conflict resolution rejects strong identifier conflicts'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Attach-existing conflict resolution can attach Plex identity metadata to a safe existing row'));
  assert.ok(mediaRoutesSource.includes('validatePlexAttachExistingTarget'));
  assert.ok(mediaRoutesSource.includes('attachPlexIdentityToExistingMedia'));
  assert.ok(mediaRoutesSource.includes('targetMediaId is required for attach_existing conflict resolution'));
  assert.ok(mediaRoutesSource.includes('Cannot attach Plex identity because TMDB identifiers conflict'));
  assert.ok(openApiSource.includes('attach_existing'));
  assert.ok(openApiSource.includes('targetMediaId'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('Conflict review can create a separate local Plex-linked title without Plex writeback'));
  assert.ok(plexReconciliationSyncSmokeSource.includes('plex-reconciliation-sync-smoke.json'));
  assert.ok(adminIntegrationsViewSource.includes('Plex library sync'));
  assert.ok(!adminIntegrationsViewSource.includes('Plex operating model'));
  assert.ok(adminIntegrationsViewSource.includes('PLEX_PANELS'));
  assert.ok(adminIntegrationsViewSource.includes("{ id: 'setup', label: 'Setup' }"));
  assert.ok(adminIntegrationsViewSource.includes("{ id: 'sync', label: 'Sync' }"));
  assert.ok(adminIntegrationsViewSource.includes("{ id: 'webhook', label: 'Webhook' }"));
  assert.ok(adminIntegrationsViewSource.includes("{ id: 'advanced', label: 'Advanced' }"));
  assert.ok(adminIntegrationsViewSource.includes('Plex settings sections'));
  assert.ok(adminIntegrationsViewSource.includes('Run scheduled Plex library sync'));
  assert.ok(adminIntegrationsViewSource.includes('plexReconciliationSyncSettings'));
  assert.ok(adminIntegrationsViewSource.includes('plexReconciliationSyncIntervalMinutes'));
  assert.ok(adminIntegrationsViewSource.includes('PlainSettingsSection'));
  assert.ok(adminIntegrationsViewSource.includes('runPlexReconciliationSyncJob'));
  assert.ok(adminIntegrationsViewSource.includes('refreshPlexReconciliationScheduler'));
  assert.ok(adminIntegrationsViewSource.includes('Plex readback refresh'));
  assert.ok(adminIntegrationsViewSource.includes('runPlexReadbackRefresh'));
  assert.ok(adminIntegrationsViewSource.includes('plexReadbackRefreshScheduler'));
  assert.ok(adminIntegrationsViewSource.includes('Run scheduled readback refresh'));
  assert.ok(adminIntegrationsViewSource.includes('plexReadbackRefreshSettings'));
  assert.ok(adminIntegrationsViewSource.includes('plexReadbackRefreshIntervalMinutes'));
  assert.ok(adminIntegrationsViewSource.includes('Refresh readback'));
  assert.ok(adminIntegrationsViewSource.includes('Manual and scheduled sync create safe missing rows'));
  assert.ok(adminIntegrationsViewSource.includes('Scan Limit'));
  assert.ok(adminIntegrationsViewSource.includes('Sync Plex Library'));
  assert.ok(adminIntegrationsViewSource.includes('Initial import'));
  assert.ok(adminIntegrationsViewSource.includes('plexImportPlan'));
  assert.ok(adminIntegrationsViewSource.includes('Start import'));
  assert.ok(adminIntegrationsViewSource.includes('Select at least one Plex library before importing'));
  assert.ok(adminIntegrationsViewSource.includes('Sync issues'));
  assert.ok(adminIntegrationsViewSource.includes('PlexConflictReviewQueue'));
  assert.ok(adminIntegrationsViewSource.includes('PLEX_CONFLICT_STATUS_FILTERS'));
  assert.ok(adminIntegrationsViewSource.includes('plexConflictStatusFilter'));
  assert.ok(adminIntegrationsViewSource.includes('plexConflictMatchFilter'));
  assert.ok(adminIntegrationsViewSource.includes('plexConflictReviewMatchFilters'));
  assert.ok(adminIntegrationsViewSource.includes('matchedBy=${match}'));
  assert.ok(adminIntegrationsViewSource.includes('Filter Plex conflicts by match reason'));
  assert.ok(adminIntegrationsViewSource.includes('Resolution:'));
  assert.ok(adminIntegrationsViewSource.includes('Attach to existing'));
  assert.ok(adminIntegrationsViewSource.includes('Create separate title'));
  assert.ok(adminIntegrationsViewSource.includes('resolvePlexConflictReview'));
  assert.ok(adminIntegrationsViewSource.includes('runPlexReconciliationPreview'));
  assert.ok(adminIntegrationsViewSource.includes('runPlexReconciliationPreviewJob'));
  assert.ok(adminIntegrationsViewSource.includes('PlexReconciliationReadback'));
  assert.ok(adminIntegrationsViewSource.includes('Plex writeback stays manual.'));
  assert.ok(plexTrueSyncWorkflowPlanSource.includes('Plex True Sync Workflow Plan'));
  assert.ok(plexTrueSyncWorkflowPlanSource.includes('Setup'));
  assert.ok(plexTrueSyncWorkflowPlanSource.includes('Sync'));
  assert.ok(plexTrueSyncWorkflowPlanSource.includes('Webhook'));
  assert.ok(plexTrueSyncWorkflowPlanSource.includes('Advanced'));
  assert.ok(backlogSource.includes('Plex True Sync Workflow'));
  assert.ok(backlogSource.includes('first UI slice promoted as `3.20.0`'));
  assert.ok(plexPmsModernizationDocSource.includes('Starting with `3.20.0`, the admin Plex surface stops carrying a separate operating-model explainer'));
  assert.ok(integrationsBrowserSpecSource.includes('Plex reconciliation sync surface displays durable conflict review actions'));
  assert.ok(integrationsBrowserSpecSource.includes('/api/media/plex-reconciliation-conflicts?status=open'));
  assert.ok(integrationsBrowserSpecSource.includes('/api/media/plex-reconciliation-conflicts/77/resolve'));
  assert.ok(integrationsBrowserSpecSource.includes('Attach to existing'));
  assert.ok(integrationsBrowserSpecSource.includes('/api/media/plex-reconciliation-preview'));
  assert.ok(integrationsBrowserSpecSource.includes('/api/media/plex-reconciliation-sync/run'));
  assert.ok(integrationsBrowserSpecSource.includes('toHaveCount(0)'));
  assert.ok(releaseRoadmapSource.includes('3.4.137 — Plex Scheduled Reconciliation Preview Job'));
  assert.ok(releaseRoadmapSource.includes('3.4.139 — Plex Temporary Reconciliation Review UI'));
  assert.ok(releaseRoadmapSource.includes('3.4.140 — Plex Reconciliation Auto-Sync and Conflict Review'));
  assert.ok(releaseRoadmapSource.includes('3.4.141 — Plex Reconciliation Full-Scan and Scheduler Automation'));
  assert.ok(releaseRoadmapSource.includes('3.4.143 — Plex Reconciliation Conflict Review and Resolution'));
  assert.ok(releaseRoadmapSource.includes('3.4.144 — Plex Attach-Existing Conflict Resolution Contract'));
  assert.ok(mediaRoutesSource.includes('matchFilters'));
  assert.ok(mediaRoutesSource.includes("COALESCE(matched_by, 'unknown')"));
  assert.ok(mediaRoutesSource.includes('normalizedMatchedBy'));
}));

results.push(run('plex webhook receiver administration contract is token-scoped and queues library-new import hints only', () => {
  assert.ok(backendPackageJson.scripts['test:plex-webhook-receiver-admin-smoke']);
  assert.ok(backendPackageJson.scripts['test:plex-webhook-import-hint-processing-smoke']);
  assert.ok(backendPackageJson.scripts['test:plex-webhook-import-auto-processor-smoke']);
  assert.ok(integrationsRoutesSource.includes("sharedRouter.post('/plex/webhooks/:token'"));
  assert.ok(integrationsRoutesSource.includes("plex-webhook-receiver-token'"));
  assert.ok(integrationsRoutesSource.includes("plex-webhook-receiver-validate'"));
  assert.ok(integrationsRoutesSource.includes('hashPlexWebhookReceiverToken'));
  assert.ok(integrationsRoutesSource.includes('validatePlexWebhookReceiverSetup'));
  assert.ok(integrationsRoutesSource.includes('shapePlexWebhookReceiverStatus'));
  assert.ok(integrationsRoutesSource.includes('buildPlexWebhookReceiverTokenFingerprint'));
  assert.ok(integrationsRoutesSource.includes('receiverUrlMasked'));
  assert.ok(integrationsRoutesSource.includes('plex_webhook_receiver_last_validation_status'));
  assert.ok(integrationsRoutesSource.includes('enqueuePlexWebhookImportHint'));
  assert.ok(integrationsRoutesSource.includes("'plex_webhook_import_hint'"));
  assert.ok(integrationsRoutesSource.includes("'queued_import_hint'"));
  assert.ok(integrationsRoutesSource.includes("'pending_future_slice'"));
  assert.ok(mediaRoutesSource.includes("router.post('/process-plex-webhook-import-hints'"));
  assert.ok(mediaRoutesSource.includes("router.get('/plex-webhook-import-hints/auto-processor'"));
  assert.ok(mediaRoutesSource.includes('startPlexWebhookImportHintAutoProcessor'));
  assert.ok(mediaRoutesSource.includes('runPlexWebhookImportHintAutoProcessorOnce'));
  assert.ok(mediaRoutesSource.includes('PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_INTERVAL_SECONDS'));
  assert.ok(mediaRoutesSource.includes('claimQueuedPlexWebhookImportHint'));
  assert.ok(mediaRoutesSource.includes('fetchPlexMetadataItem'));
  assert.ok(mediaRoutesSource.includes("processingMode: 'single_rating_key_import'"));
  assert.ok(serverSource.includes("job_type <> 'plex_webhook_import_hint'"));
  assert.ok(serverSource.includes('startPlexWebhookImportHintAutoProcessor'));
  assert.ok(integrationsServiceSource.includes('plexWebhookReceiverTokenHash'));
  assert.ok(integrationsServiceSource.includes('plexWebhookReceiverLastValidationStatus'));
  assert.ok(migrationsSource.includes('version: 98'));
  assert.ok(migrationsSource.includes('version: 112'));
  assert.ok(migrationsSource.includes('plex_webhook_receiver_token_hash'));
  assert.ok(migrationsSource.includes('plex_webhook_receiver_last_validation_status'));
  assert.ok(initSqlSource.includes('plex_webhook_receiver_token_hash TEXT'));
  assert.ok(initSqlSource.includes('plex_webhook_receiver_last_validation_status VARCHAR(20)'));
  assert.ok(openApiSource.includes('/api/plex/webhooks/{token}'));
  assert.ok(openApiSource.includes('/api/admin/settings/integrations/plex-webhook-receiver-token'));
  assert.ok(openApiSource.includes('/api/media/process-plex-webhook-import-hints'));
  assert.ok(openApiSource.includes('/api/media/plex-webhook-import-hints/auto-processor'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('/api/plex/webhooks/czpw_invalid_receiver_token'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes("event: 'library.new'"));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('import_enqueue_hint'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('watchedStateStayedReadOnly'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('duplicateWebhookReusedExistingJob'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('waitForProcessedWebhookJob'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('/api/media/plex-webhook-import-hints/auto-processor'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('singleRatingKeyImportProcessed'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('receiverPathMasked'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('tokenFingerprint'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('startFakePmsServer'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('assertSecretFree'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes("'plex-webhooks'"));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('plex-webhook-receiver-admin-smoke.json'));
  assert.ok(plexWebhookReceiverAdminSmokeSource.includes('revokeRejectedPreviousToken'));
  assert.ok(adminIntegrationsViewSource.includes('generatePlexWebhookReceiverToken'));
  assert.ok(adminIntegrationsViewSource.includes('revokePlexWebhookReceiverToken'));
  assert.ok(adminIntegrationsViewSource.includes('validatePlexWebhookReceiver'));
  assert.ok(adminIntegrationsViewSource.includes('plex-webhook-receiver-validate'));
  assert.ok(adminIntegrationsViewSource.includes('Webhook receiver'));
  assert.ok(adminIntegrationsViewSource.includes('Check setup'));
  assert.ok(adminIntegrationsViewSource.includes('receiverUrlMasked'));
  assert.ok(adminIntegrationsViewSource.includes('Token fingerprint'));
  assert.strictEqual(sanitizeRequestUrl('/api/plex/webhooks/czpw_secret-token_123'), '/api/plex/webhooks/[REDACTED]');
  assert.strictEqual(sanitizeRequestUrl('/api/plex/webhooks/not-a-receiver-token'), '/api/plex/webhooks/not-a-receiver-token');
  assert.strictEqual(sanitizeRequestUrl('/api/thing?token=czpw_secret-token_123'), '/api/thing?token=[REDACTED]');
  assert.ok(releaseRoadmapSource.includes('3.4.123 — Plex Webhook Receiver Administration Contract'));
  assert.ok(releaseRoadmapSource.includes('3.4.124 — Plex Webhook Receiver Processing and Import Enqueue Contract'));
}));

results.push(run('plex provider discovery runtime proof keeps fake PMS smoke scoped and secret-free', () => {
  assert.ok(backendPackageJson.scripts['test:plex-provider-discovery-smoke']);
  assert.ok(plexProviderDiscoverySmokeSource.includes("fetchPlexMediaProviders"));
  assert.ok(plexProviderDiscoverySmokeSource.includes("url.pathname !== '/media/providers'"));
  assert.ok(plexProviderDiscoverySmokeSource.includes("token and provider URL fields were not surfaced"));
  assert.ok(plexProviderDiscoverySmokeSource.includes("existing Plex import paths were not called"));
  assert.ok(plexProviderDiscoverySmokeSource.includes("artifacts', 'plex-provider-discovery', 'plex-provider-discovery-smoke.json"));
  assert.ok(releaseRoadmapSource.includes('3.4.112 — Plex Provider Discovery Runtime Proof'));
}));

results.push(run('plex provider import parity proof keeps current import path read-only and documented', () => {
  assert.ok(backendPackageJson.scripts['test:plex-provider-import-parity-smoke']);
  assert.ok(plexProviderImportParitySmokeSource.includes('fetchPlexMediaProviders'));
  assert.ok(plexProviderImportParitySmokeSource.includes('fetchPlexLibraryItems'));
  assert.ok(plexProviderImportParitySmokeSource.includes('fetchPlexShowSeasons'));
  assert.ok(plexProviderImportParitySmokeSource.includes('provider_import_parity_contract'));
  assert.ok(plexProviderImportParitySmokeSource.includes('legacy_import_remains_current_until_provider_api_item_listing_reaches_field_parity'));
  assert.ok(plexProviderImportParitySmokeSource.includes('Provider discovery identifies PMS capabilities but does not enumerate importable library items.'));
  assert.ok(plexProviderImportParitySmokeSource.includes('provider discovery alone is not field-equivalent to the current import path'));
  assert.ok(plexProviderImportParitySmokeSource.includes("artifacts', 'plex-provider-import-parity', 'plex-provider-import-parity-smoke.json"));
  assert.ok(plexProviderImportParitySmokeSource.includes('assertSecretFree'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Provider/API Import Parity Contract. Promoted as `3.4.145`.'));
  assert.ok(releaseRoadmapSource.includes('3.4.145 — Plex Provider/API Import Parity Contract'));
}));

results.push(run('plex provider item listing discovery extracts advertised candidates without changing imports', () => {
  assert.ok(backendPackageJson.scripts['test:plex-provider-item-listing-discovery-smoke']);
  assert.ok(plexServiceSource.includes('extractPlexProviderItemListingCandidates'));
  assert.ok(plexServiceSource.includes('fetchPlexProviderItemRows'));
  assert.ok(plexServiceSource.includes('featureDirectories'));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes('provider_item_listing_discovery_contract'));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes('provider_advertised_item_listing_candidates_found_but_import_behavior_remains_legacy_until_real_server_field_parity_is_proven'));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes('/library/sections/1/all'));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes('unsafe absolute provider URLs and token-bearing keys are ignored'));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes("artifacts', 'plex-provider-item-listing-discovery', 'plex-provider-item-listing-discovery-smoke.json"));
  assert.ok(plexProviderItemListingDiscoverySmokeSource.includes('assertSecretFree'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Provider Item-Listing API Discovery. Promoted as `3.4.146`.'));
  assert.ok(releaseRoadmapSource.includes('3.4.146 — Plex Provider Item-Listing API Discovery'));
}));

results.push(run('plex real PMS provider item-row parity proof stays read-only and sanitized', () => {
  assert.ok(backendPackageJson.scripts['test:plex-real-provider-item-row-parity-proof']);
  assert.ok(plexRealProviderItemRowParityProofSource.includes('fetchPlexProviderItemRows'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes('provider_item_row_parity_proof'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes('real_provider_candidate_rows_returned_but_import_behavior_remains_legacy_until_full_field_parity_and_repeat_sync_safety_are_proven'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes('Compare real provider item rows against legacy import rows for the same libraries.'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes('fieldCoverage'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes('assertSecretFree'));
  assert.ok(plexRealProviderItemRowParityProofSource.includes("artifacts', 'plex-provider-item-row-parity', 'plex-real-provider-item-row-parity-proof.json"));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Real PMS Provider Item-Row Parity Proof. Promoted as `3.4.147`.'));
  assert.ok(releaseRoadmapSource.includes('3.4.147 — Plex Real PMS Provider Item-Row Parity Proof'));
}));

results.push(run('plex provider-advertised import path contract uses documented library provider paths', () => {
  const contract = buildPlexPmsModernizationContract();
  assert.strictEqual(contract.currentMode, 'documented-library-provider-paths');
  assert.strictEqual(contract.nextMode, 'provider-advertised-library-paths');
  assert.strictEqual(contract.libraryProviderIdentifier, 'com.plexapp.plugins.library');
  assert.ok(contract.documentedImportPaths.includes('/library/sections/all'));
  assert.ok(contract.documentedImportPaths.includes('/library/metadata/:ids/allLeaves'));
  assert.ok(plexServiceSource.includes('buildPlexProviderAdvertisedImportPathContract'));
  assert.ok(plexServiceSource.includes("providerAdvertisedSectionRootPath: '/library/sections/all'"));
  assert.ok(plexServiceSource.includes("sectionsRootPath = sectionsRootAdvertised"));
  assert.ok(backendPackageJson.scripts['test:plex-provider-advertised-import-path-contract-smoke']);
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('provider_advertised_import_path_contract'));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('/library/sections/all'));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('/library/sections/:sectionId/all'));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('/library/metadata/:ids/allLeaves'));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('media_providers_is_capability_discovery'));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes("artifacts', 'plex-provider-advertised-import-path-contract', 'plex-provider-advertised-import-path-contract-smoke.json"));
  assert.ok(plexProviderAdvertisedImportPathContractSmokeSource.includes('assertSecretFree'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Provider-Advertised Path Import Migration Contract. Promoted as `3.4.149`.'));
  assert.ok(releaseRoadmapSource.includes('3.4.149 — Plex Provider-Advertised Path Import Migration Contract'));
}));

results.push(run('plex provider-advertised sections root runtime migration keeps fallback behavior', () => {
  assert.strictEqual(typeof resolvePlexSectionsRootPath, 'function');
  assert.strictEqual(typeof fetchPlexSectionsWithResolution, 'function');
  assert.ok(plexServiceSource.includes('resolvePlexSectionsRootPath'));
  assert.ok(plexServiceSource.includes('fetchPlexSectionsWithResolution'));
  assert.ok(plexServiceSource.includes("'provider_advertised'"));
  assert.ok(plexServiceSource.includes("'provider_advertised_root_failed_fallback'"));
  assert.ok(plexServiceSource.includes("requestPlexSectionsAtPath(config, '/library/sections')"));
  assert.ok(backendPackageJson.scripts['test:plex-provider-sections-root-runtime-smoke']);
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes('provider_sections_root_runtime_migration'));
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes('/library/sections/all'));
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes('provider_advertised_root_unavailable_fallback'));
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes('provider_root_not_advertised_fallback'));
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes("artifacts', 'plex-provider-sections-root-runtime', 'plex-provider-sections-root-runtime-smoke.json"));
  assert.ok(plexProviderSectionsRootRuntimeSmokeSource.includes('assertSecretFree'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Provider-Advertised Sections Root Runtime Migration. Promoted as `3.4.150`.'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex Sync Operating Model Cleanup. Promoted as `3.4.151`.'));
  assert.ok(plexPmsModernizationDocSource.includes('Plex settings/readback workflow distinguishes setup'));
  assert.ok(releaseRoadmapSource.includes('3.4.150 — Plex Provider-Advertised Sections Root Runtime Migration'));
  assert.ok(releaseRoadmapSource.includes('3.4.151 — Plex Sync Operating Model Cleanup'));
}));

results.push(run('plex real-server provider discovery readback is wired as sanitized admin and workspace probes', () => {
  assert.ok(backendPackageJson.scripts['test:plex-provider-readback-smoke']);
  assert.ok(integrationsRoutesSource.includes("fetchPlexSections, fetchPlexMediaProviders"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.post('/admin/settings/integrations/test-plex-providers'"));
  assert.ok(integrationsRoutesSource.includes("path: '/media/providers'"));
  assert.ok(integrationsRoutesSource.includes('providerCount: providers.length'));
  assert.ok(spaceIntegrationsRoutesSource.includes("router.post('/spaces/:spaceId/integrations/test-plex-providers'"));
  assert.ok(spaceIntegrationsRoutesSource.includes("fetchPlexSections, fetchPlexMediaProviders"));
  assert.ok(adminIntegrationsViewSource.includes("testPlexProviders"));
  assert.ok(adminIntegrationsViewSource.includes("Probe Providers"));
  assert.ok(adminIntegrationsViewSource.includes("Detected Plex providers"));
  assert.ok(openApiSource.includes('/api/admin/settings/integrations/test-plex-providers'));
  assert.ok(openApiSource.includes('/api/spaces/{id}/integrations/test-plex-providers'));
  assert.ok(plexProviderReadbackSmokeSource.includes('/api/admin/settings/integrations/test-plex-providers'));
  assert.ok(plexProviderReadbackSmokeSource.includes('restorePlexSettings'));
  assert.ok(plexProviderReadbackSmokeSource.includes('Response must not contain raw Plex token'));
  assert.ok(releaseRoadmapSource.includes('3.4.113 — Plex Real-Server Provider Discovery Readback'));
}));

results.push(run('plex now-playing provider proof keeps sessions read-only and secret-free', () => {
  const contract = buildPlexPmsModernizationContract();
  assert.strictEqual(contract.nowPlayingPath, '/status/sessions');
  assert.ok(backendPackageJson.scripts['test:plex-now-playing-provider-proof-smoke']);
  assert.ok(plexNowPlayingProviderProofSmokeSource.includes('fetchPlexNowPlayingSessions'));
  assert.ok(plexNowPlayingProviderProofSmokeSource.includes("url.pathname !== '/status/sessions'"));
  assert.ok(plexNowPlayingProviderProofSmokeSource.includes('token, player IP, machine identifier, and media file paths were not surfaced'));
  assert.ok(plexNowPlayingProviderProofSmokeSource.includes('existing Plex import paths were not called'));
  assert.ok(plexNowPlayingProviderProofSmokeSource.includes("artifacts', 'plex-now-playing', 'plex-now-playing-provider-proof-smoke.json"));
  assert.ok(releaseRoadmapSource.includes('3.4.114 — Plex Now Playing Provider Proof'));
}));

results.push(run('plex now-playing readback endpoint is wired as sanitized admin and workspace probes', () => {
  assert.ok(backendPackageJson.scripts['test:plex-now-playing-readback-smoke']);
  assert.ok(integrationsRoutesSource.includes("fetchPlexMediaProviders, fetchPlexNowPlayingSessions"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.post('/admin/settings/integrations/test-plex-now-playing'"));
  assert.ok(integrationsRoutesSource.includes("path: '/status/sessions'"));
  assert.ok(integrationsRoutesSource.includes('sessionCount: sessions.length'));
  assert.ok(spaceIntegrationsRoutesSource.includes("router.post('/spaces/:spaceId/integrations/test-plex-now-playing'"));
  assert.ok(spaceIntegrationsRoutesSource.includes("fetchPlexMediaProviders, fetchPlexNowPlayingSessions"));
  assert.ok(openApiSource.includes('/api/admin/settings/integrations/test-plex-now-playing'));
  assert.ok(openApiSource.includes('/api/spaces/{id}/integrations/test-plex-now-playing'));
  assert.ok(plexNowPlayingReadbackSmokeSource.includes('/api/admin/settings/integrations/test-plex-now-playing'));
  assert.ok(plexNowPlayingReadbackSmokeSource.includes('restorePlexSettings'));
  assert.ok(plexNowPlayingReadbackSmokeSource.includes('Response must not contain raw Plex token'));
  assert.ok(plexNowPlayingReadbackSmokeSource.includes('Response must not contain media file paths'));
  assert.ok(releaseRoadmapSource.includes('3.4.115 — Plex Now Playing Readback Endpoint'));
}));

results.push(run('plex now-playing UI readback is wired as a read-only integrations diagnostic', () => {
  assert.ok(adminIntegrationsViewSource.includes('testPlexNowPlaying'));
  assert.ok(adminIntegrationsViewSource.includes('test-plex-now-playing'));
  assert.ok(adminIntegrationsViewSource.includes('Active Plex sessions'));
  assert.ok(adminIntegrationsViewSource.includes('No active Plex sessions.'));
  assert.ok(adminIntegrationsViewSource.includes('plexNowPlayingSessions'));
  assert.ok(adminIntegrationsViewSource.includes('plexNowPlayingChecked'));
  assert.ok(adminIntegrationsViewSource.includes('Active Sessions'));
  assert.ok(!adminIntegrationsViewSource.includes('runPlexNowPlaying'));
  assert.ok(releaseRoadmapSource.includes('3.4.116 — Plex Now Playing UI Readback'));
}));

results.push(run('plex real PMS now-playing runtime proof captures viewer field coverage without secrets', () => {
  assert.ok(backendPackageJson.scripts['test:plex-real-now-playing-runtime-proof']);
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes('fetchPlexNowPlayingSessions'));
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes("artifacts', 'plex-now-playing', 'plex-real-now-playing-runtime-proof.json"));
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes('sessionsWithThumbKey'));
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes('canUsePlexRelativePosterKey'));
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes('assertSecretFree'));
  assert.ok(plexRealNowPlayingRuntimeProofSource.includes('existing Plex import paths were not called'));
  assert.ok(releaseRoadmapSource.includes('3.4.117 — Plex Real PMS Now Playing Runtime Proof'));
}));

results.push(run('plex now-playing viewer is wired through a standalone authenticated display route', () => {
  assert.ok(backendPackageJson.scripts['test:plex-now-playing-viewer-smoke']);
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/plex/now-playing-viewer'"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/plex/now-playing-image'"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/plex/now-playing-display'"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/plex/now-playing-display-image'"));
  assert.ok(integrationsRoutesSource.includes("plex-now-playing-display-token'"));
  assert.ok(integrationsRoutesSource.includes("plex-now-playing-display-preferences'"));
  assert.ok(integrationsRoutesSource.includes('hashNowPlayingDisplayToken'));
  assert.ok(integrationsRoutesSource.includes('normalizeNowPlayingDisplayPreferences'));
  assert.ok(integrationsRoutesSource.includes('filterNowPlayingSessionsForPreferences'));
  assert.ok(integrationsRoutesSource.includes('fetchPlexImageAsset'));
  assert.ok(integrationsRoutesSource.includes('posterImagePath'));
  assert.ok(openApiSource.includes('/api/plex/now-playing-viewer'));
  assert.ok(openApiSource.includes('/api/plex/now-playing-image'));
  assert.ok(openApiSource.includes('/api/plex/now-playing-display'));
  assert.ok(openApiSource.includes('/api/plex/now-playing-display-image'));
  assert.ok(openApiSource.includes('/api/admin/settings/integrations/plex-now-playing-display-token'));
  assert.ok(openApiSource.includes('/api/admin/settings/integrations/plex-now-playing-display-preferences'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('/api/plex/now-playing-viewer'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('/api/plex/now-playing-image'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('/api/plex/now-playing-display'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('/api/plex/now-playing-display-image'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('/api/admin/settings/integrations/plex-now-playing-display-preferences'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('displayToken'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('Viewer response must not contain raw Plex token'));
  assert.ok(frontendAppSource.includes("route === 'now-playing'"));
  assert.ok(frontendAppSource.includes('nowPlayingDisplayToken'));
  assert.ok(appPrimitivesSource.includes("if (p === '/now-playing') return 'now-playing';"));
  assert.ok(useSessionBootstrapSource.includes("route !== 'dashboard' && route !== 'now-playing'"));
  assert.ok(useSessionBootstrapSource.includes('hasNowPlayingDisplayToken'));
  assert.ok(nowPlayingViewSource.includes('/plex/now-playing-viewer'));
  assert.ok(nowPlayingViewSource.includes('/plex/now-playing-display'));
  assert.ok(nowPlayingViewSource.includes('displayToken'));
  assert.ok(nowPlayingViewSource.includes('displayPreferences'));
  assert.ok(nowPlayingViewSource.includes('showPoster'));
  assert.ok(nowPlayingViewSource.includes('showBackdrop'));
  assert.ok(nowPlayingViewSource.includes('posterOnlyMode'));
  assert.ok(nowPlayingViewSource.includes('showSessionList'));
  assert.ok(nowPlayingViewSource.includes('Other active sessions'));
  assert.ok(nowPlayingViewSource.includes('poster_only'));
  assert.ok(nowPlayingViewSource.includes('posterImagePath'));
  assert.ok(nowPlayingViewSource.includes('Updates every 15 seconds'));
  assert.ok(adminIntegrationsViewSource.includes('generatePlexDisplayToken'));
  assert.ok(adminIntegrationsViewSource.includes('revokePlexDisplayToken'));
  assert.ok(adminIntegrationsViewSource.includes('savePlexDisplayPreferences'));
  assert.ok(adminIntegrationsViewSource.includes('DEFAULT_PLEX_DISPLAY_PREFERENCES'));
  assert.ok(adminIntegrationsViewSource.includes('layoutMode'));
  assert.ok(adminIntegrationsViewSource.includes('Other sessions'));
  assert.ok(adminIntegrationsViewSource.includes('Vertical poster only'));
  assert.ok(openApiSource.includes('showSessionList'));
  assert.ok(plexNowPlayingViewerSmokeSource.includes('showSessionList'));
  assert.ok(nowPlayingViewerBrowserSpecSource.includes("page.goto('/now-playing')"));
  assert.ok(nowPlayingViewerBrowserSpecSource.includes('/now-playing?token='));
  assert.ok(nowPlayingViewerBrowserSpecSource.includes('Viewer Safe Payload'));
  assert.ok(nowPlayingViewerBrowserSpecSource.includes('Second Active Session'));
  assert.ok(releaseRoadmapSource.includes('3.4.118 — Plex Now Playing Viewer'));
  assert.ok(releaseRoadmapSource.includes('3.4.120 — Plex Now Playing Display Preferences'));
}));

results.push(run('media route source includes tmdb trace-match endpoint', () => {
  assert.ok(mediaRoutesSource.includes("router.post('/tmdb/trace-match'"));
  assert.ok(mediaRoutesSource.includes('scoreTmdbMatchCandidate'));
}));

results.push(run('admin space control-plane routes are blocked at the Core boundary', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/spaces'"));
  assert.ok(serverSource.includes('API route not found: ${req.method} ${req.originalUrl}'));
  assert.ok(!openApiSource.includes('"/api/admin/spaces"'));
  assert.ok(!openApiSource.includes('AdminSpaceCreateWithOnboardingRequest'));
}));

results.push(run('admin user control-plane routes are blocked at the Core boundary', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/users'"));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/users must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/users/:id/summary must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/users/:id/role must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/users/:id/password-reset must be owned by cairn'));
}));

results.push(run('admin route source keeps remaining core administration endpoints', () => {
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/loan-reminder-operations'"));
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/activity'"));
  assert.ok(adminRoutesSource.includes("commonRouter.get('/feature-flags'"));
}));

results.push(run('platform settings diagnostics are blocked at the Core boundary', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/settings/email-delivery'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-pricecharting'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-ebay'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-logs'"));
  assert.ok(!serverSource.includes('platformIntegrationsRouter'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/settings/email-delivery must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform PriceCharting diagnostic must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform eBay diagnostic must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform log export diagnostic must be owned by cairn'));
}));

results.push(run('platform activity diagnostics are blocked at the Core boundary', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/activity'"));
  assert.ok(serverSource.includes("app.use('/api/admin/loan-reminder-operations'"));
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/activity'"));
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/loan-reminder-operations'"));
  assert.ok(!adminRoutesSource.includes("action = 'media.loan.reminder.auto_run'"));
  assert.ok(!adminRoutesSource.includes("action = 'media.loan.reminder.auto_fail'"));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/activity must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/loan-reminder-operations must be owned by cairn'));
  assert.ok(!dashboardContentSource.includes('AdminActivityView'));
  assert.ok(!dashboardContentSource.includes("case 'admin-activity'"));
  assert.ok(!dashboardRoutingSource.includes("'admin-activity'"));
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
  assert.ok(authRoutesSource.includes("const inviteTokenForLookup = String(inviteToken || '').trim();"));
  assert.ok(authRoutesSource.includes("WHERE $2 <> ''"));
  assert.ok(authRoutesSource.includes('if (!homelabEdition && inviteTokenForLookup && !claimedInvite) {'));
  assert.ok(authRoutesSource.includes('} else if (!homelabEdition && !claimedInvite && existingUserCount > 0 && !selfRegistrationEnabled) {'));
  assert.ok(authRoutesSource.includes('if (registrationFailure) {'));
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

results.push(run('frontend app source keeps support-session APIs out of the Core UI shell', () => {
  assert.ok(!dashboardShellSource.includes('SupportSessionBanner'));
  assert.ok(!frontendAppSource.includes('/auth/support-session/start'));
  assert.ok(!frontendAppSource.includes('/auth/support-session'));
  assert.ok(!frontendAppSource.includes('request_id: requestId || undefined'));
  assert.ok(!frontendAppSource.includes('supportSession'));
  assert.ok(!dashboardContentSource.includes('onStartSupportSession'));
  assert.ok(!dashboardContentSource.includes('onEndSupportSession'));
  assert.ok(!dashboardShellSource.includes('supportSession'));
  assert.ok(!productEditionFrontendSource.includes('supportSessionActive'));
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

results.push(run('support route source is limited to the Core release feed after cairn extraction', () => {
  assert.ok(supportRoutesSource.includes("sharedRouter.get('/releases'"));
  assert.ok(supportRoutesSource.includes('loadReleaseNotesFeed'));
  assert.ok(supportRoutesSource.includes('supportSharedRouter'));
  assert.ok(!supportRoutesSource.includes('supportPlatformRouter'));
  assert.ok(!supportRoutesSource.includes('platformRouter'));
  assert.ok(!supportRoutesSource.includes("'/requests'"));
  assert.ok(!supportRoutesSource.includes("'/staff/summary'"));
  assert.ok(!supportRoutesSource.includes('support.request.access.updated'));
  assert.ok(!supportRoutesSource.includes('normalizeSupportQueueFilter'));
}));

results.push(run('frontend source keeps Core help center while platform support queue UI stays out of Core', () => {
  assert.ok(dashboardContentSource.includes("case 'help'"));
  assert.ok(!dashboardContentSource.includes("case 'support-inbox'"));
  assert.ok(frontendAppSource.includes('getSafeDashboardTab'));
  assert.ok(frontendAppSource.includes('isSupportHelpEnabled'));
  assert.ok(frontendAppSource.includes('SUPPORT_STAFF_ROLE'));
  assert.ok(frontendAppSource.includes("const supportStaffInEdition = supportHelpEnabled && ['admin', SUPPORT_STAFF_ROLE].includes"));
  assert.ok(!frontendAppSource.includes('supportSessionActiveInEdition'));
  assert.ok(!frontendAppSource.includes('supportSessionActive:'));
  assert.ok(frontendAppSource.includes('showCollectibles: featureFlags.collectibles_enabled !== false'));
  assert.ok(frontendAppSource.includes('showEvents: featureFlags.events_enabled !== false'));
  assert.ok(dashboardContentSource.includes('<HelpView'));
  assert.ok(helpViewSource.includes('/support/releases'));
  assert.ok(helpViewSource.includes('Guidance'));
  assert.ok(helpViewSource.includes('Recent Releases'));
  assert.ok(!productEditionFrontendSource.includes('Help Admin'));
  assert.ok(!helpViewSource.includes('/support/requests'));
  assert.ok(!helpViewSource.includes('Support Metrics'));
  assert.ok(!helpViewSource.includes('Approve Support Access'));
  assert.ok(!helpViewSource.includes('Start Approved Support Session'));
  assert.ok(!helpViewSource.includes('TimelineItem'));
  assert.ok(!helpViewSource.includes('Reply to Support'));
  assert.ok(dashboardShellSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(dashboardShellSource.includes("const supportStaffInEdition = supportHelpEnabled && ['admin', SUPPORT_STAFF_ROLE].includes"));
  assert.ok(!dashboardShellSource.includes('supportSessionActiveInEdition'));
  assert.ok(!dashboardShellSource.includes('supportBadgeCount'));
  assert.ok(sidebarNavSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(sidebarNavSource.includes('const bridgeSupportEnabled = false;'));
  assert.ok(sidebarNavSource.includes('const isSupportStaff = supportHelpEnabled && (isAdmin || isSupportAdmin);'));
  assert.ok(sidebarNavSource.includes('const canUseLibraryShell = !isSupportAdmin || !bridgeSupportEnabled;'));
  assert.ok(!frontendAppSource.includes('useSupportSummary'));
  assert.ok(!frontendAppSource.includes('usePlatformAnalytics'));
  assert.ok(!adminSettingsViewSource.includes('EmailDeliveryCard'));
  assert.ok(!adminSettingsViewSource.includes('AnalyticsTrackingCard'));
  assert.ok(!adminSettingsViewSource.includes('emailDeliveryEndpoint'));
  assert.ok(!adminSettingsViewSource.includes('analyticsEndpoint'));
  assert.ok(!adminSettingsViewSource.includes('collectz:platform-analytics-updated'));
  assert.ok(!adminSettingsViewSource.includes('Rybbit'));
  assert.ok(!adminSettingsViewSource.includes('Platform SMTP'));
}));

results.push(run('edition boundary source includes backend-owned homelab shell and help surface rules', () => {
  assert.ok(productEditionConfigSource.includes('process.env.APP_EDITION'));
  assert.ok(productEditionConfigSource.includes("'platform'"));
  assert.ok(productEditionConfigSource.includes("'homelab'"));
  assert.ok(productEditionConfigSource.includes('resolvePersistedActiveSpaceId'));
  assert.ok(authRoutesSource.includes('product_edition: getProductEdition()'));
  assert.ok(authRoutesSource.includes('edition_contract: buildEditionContract(getProductEdition())'));
  assert.ok(authRoutesSource.includes('edition_contract: buildEditionContract(productEdition)'));
  assert.ok(authRoutesSource.includes('runtime_mode: getPublicRuntimeMode('));
  assert.ok(authRoutesSource.includes('runtime_contract: buildRuntimeContract('));
  assert.ok(openApiSource.includes('"runtime_mode"'));
  assert.ok(openApiSource.includes('"RuntimeContract"'));
  assert.ok(openApiSource.includes('"runtime_contract"'));
  assert.ok(!openApiSource.includes('"product_edition"'));
  assert.ok(!openApiSource.includes('"EditionContract"'));
  assert.ok(!openApiSource.includes('"edition_contract"'));
  assert.ok(productEditionFrontendSource.includes('getHelpTabDefinitions'));
  assert.ok(productEditionFrontendSource.includes('getHelpSurfaceTitle'));
  assert.ok(productEditionFrontendSource.includes('getAllowedDashboardTabs'));
  assert.ok(!productEditionFrontendSource.includes('supportSessionActive'));
  assert.ok(productEditionFrontendSource.includes("if (!options?.platformBridgeEnabled) return getLocalRuntimeAllowedTabs(options);"));
  assert.ok(productEditionFrontendSource.includes('return DEFAULT_PLATFORM_TAB;'));
  assert.ok(helpViewSource.includes('<h1 className="section-title">Help</h1>'));
  assert.ok(!helpViewSource.includes('supportRequestsEnabled'));
  assert.ok(!helpViewSource.includes('effectiveHelpProductEdition'));
  assert.ok(!helpViewSource.includes('A lightweight home for self-serve guidance and recent release notes for homelab users.'));
  assert.ok(frontendAppSource.includes('getSafeDashboardTab'));
  assert.ok(!frontendAppSource.includes('supportSessionActiveInEdition'));
  assert.ok(!dashboardContentSource.includes('const supportHelpEnabled = isSupportHelpEnabled(productEdition);'));
  assert.ok(!dashboardContentSource.includes('const bridgeSupportEnabled = false;'));
  assert.ok(!dashboardContentSource.includes("...(bridgeSupportEnabled ? ['support-inbox'] : []),"));
  assert.ok(sidebarNavSource.includes('getAllowedDashboardTabs'));
  assert.ok(!sidebarNavSource.includes('showPlatformGroup'));
  assert.ok(productEditionConfigSource.includes("return PRODUCT_EDITIONS.has(normalized) ? normalized : 'homelab';"));
  assert.ok(!dockerComposeSource.includes('APP_EDITION'));
  assert.ok(!dockerComposeSource.includes('Generated by scripts/generate-public-compose.js'));
  assert.ok(dockerComposeSource.includes('image: ghcr.io/hkrewson/collectz-backend:latest'));
  assert.ok(dockerComposeSource.includes('image: ghcr.io/hkrewson/collectz-frontend:latest'));
  assert.ok(!dockerComposeSource.includes('IMAGE_REGISTRY'));
  assert.ok(!dockerComposeSource.includes('IMAGE_NAMESPACE'));
  assert.ok(!dockerComposeSource.includes('IMAGE_TAG'));
  assert.ok(dockerComposeSource.includes('${FRONTEND_PORT:-3000}:3000'));
  assert.ok(serverSource.includes('const HOMELAB_EDITION = isHomelabEdition();'));
  assert.ok(serverSource.includes("app.use('/api/auth', authPlatformRouter);"));
  assert.ok(serverSource.includes("app.use('/api/support', supportSharedRouter);"));
  assert.ok(serverSource.includes("app.use('/api/admin', adminCommonRouter);"));
  assert.ok(serverSource.includes("app.use('/api', sharedIntegrationsRouter);"));
  assert.ok(!serverSource.includes("app.use('/api/docs', docsRouter);"));
  assert.ok(!serverSource.includes("app.use('/api/metrics', metricsRouter);"));
  assert.ok(platformEditionBoundarySmokeSource.includes("user.request('/api/support/requests', { expectStatus: 404 })"));
  assert.ok(platformEditionBoundarySmokeSource.includes("admin.request('/api/support/staff/summary', { expectStatus: 404 })"));
  assert.ok(!serverSource.includes("app.use('/api', platformIntegrationsRouter);"));
  assert.ok(serverSource.includes("app.use('/api', spaceIntegrationsRouter);"));
  assert.ok(serverSource.includes("app.use('/api', spacesRouter);"));
  assert.ok(!serverSource.includes("app.use('/api/admin', adminPlatformRouter);"));
  assert.ok(serverSource.includes("const coreRouter = require('./routes/core');"));
  assert.ok(serverSource.includes("app.use('/api', coreRouter);"));
  assert.ok(coreRoutesSource.includes("router.get('/core/instance'"));
  assert.ok(openApiSource.includes('"/api/core/instance"'));
  assert.ok(openApiSource.includes('"CoreInstanceContract"'));
  assert.ok(openApiSource.includes('"auth_authority"'));
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
  assert.ok(spacesRoutesSource.includes('req.user.scopeSpaceId = spaceId;'));
  assert.ok(authRoutesSource.includes("platformRouter.post('/support-session/start'"));
  assert.ok(authRoutesSource.includes("platformRouter.delete('/support-session'"));
  assert.ok(adminRoutesSource.includes('adminCommonRouter'));
  assert.ok(!adminRoutesSource.includes('adminPlatformRouter'));
  assert.ok(!adminRoutesSource.includes('platformRouter'));
  assert.ok(adminRoutesSource.includes('HOMELAB_ALLOWED_FEATURE_FLAGS'));
  assert.ok(adminRoutesSource.includes("commonRouter.get('/settings/portability'"));
  assert.ok(adminRoutesSource.includes("commonRouter.post('/settings/portability/export'"));
  assert.ok(adminRoutesSource.includes('buildPortabilityStatus'));
  assert.ok(adminRoutesSource.includes('buildPortabilityJsonExport'));
  assert.ok(adminRoutesSource.includes('buildPortabilityCsvFileExport'));
  assert.ok(adminRoutesSource.includes("format === 'csv'"));
  assert.ok(spaceIntegrationsRoutesSource.includes("router.get('/spaces/:spaceId/portability'"));
  assert.ok(spaceIntegrationsRoutesSource.includes("router.post('/spaces/:spaceId/portability/export'"));
  assert.ok(spaceIntegrationsRoutesSource.includes("scope: 'workspace'"));
  assert.ok(adminRoutesSource.includes("Unknown feature flag: ${key}"));
  assert.ok(integrationsRoutesSource.includes("const { resolveScopeContext } = require('../db/scopeContext');"));
  assert.ok(integrationsRoutesSource.includes('const scopeContext = resolveScopeContext(req);'));
  assert.ok(integrationsRoutesSource.includes('loadGeneralSettings(scopeContext?.spaceId || null)'));
  assert.ok(mediaRoutesSource.includes('const scopeContext = resolveScopeContext(req);'));
  assert.ok(mediaRoutesSource.includes('loadScopedIntegrationConfig(scopeContext?.spaceId || null)'));
  assert.ok(mediaRoutesSource.includes('loadScopedIntegrationConfig(effectiveScopeContext.spaceId || null)'));
  assert.ok(supportRoutesSource.includes('supportSharedRouter'));
  assert.ok(!supportRoutesSource.includes('supportPlatformRouter'));
  assert.ok(homelabHelpBrowserSpecSource.includes('product_edition'));
  assert.ok(homelabHelpBrowserSpecSource.includes("name: 'Help Admin', exact: true })).toHaveCount(0)"));
  assert.ok(homelabHelpBrowserSpecSource.includes('/platform/workspaces'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/platform/users'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/platform/activity'));
  assert.ok(homelabHelpBrowserSpecSource.includes('/dashboard?tab=space-manage'));
  assert.ok(homelabHelpBrowserSpecSource.includes("toHaveURL(/\\/help$/)"));
  assert.ok(homelabHelpBrowserSpecSource.includes("not.toHaveURL(/\\/platform\\/workspaces$/)"));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=library-import'));
  assert.ok(homelabSharedBrowserSpecSource.includes("name: 'CSV'"));
  assert.ok(homelabSharedBrowserSpecSource.includes("name: 'Download Template'"));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/profile'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-settings'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=barcode'));
  assert.ok(homelabSharedBrowserSpecSource.includes('/api/admin/settings/general'));
  assert.ok(openApiSource.includes('/api/admin/settings/portability'));
  assert.ok(openApiSource.includes('/api/admin/settings/portability/export'));
  assert.ok(openApiSource.includes('/api/spaces/{id}/portability'));
  assert.ok(openApiSource.includes('/api/spaces/{id}/portability/export'));
  assert.ok(openApiSource.includes('collectz.portability.csv.v1'));
  assert.ok(openApiSource.includes('text/csv'));
  assert.ok(openApiSource.includes('PortabilityStatusResponse'));
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
  assert.ok(homelabEditionBoundarySmokeSource.includes('const persistedAdminScope = await getPersistedUserScope(adminUserId);'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('/api/spaces/${adminSpaceId}/integrations'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('must stay mounted for workspace-owned provider settings'));
  assert.ok(homelabEditionBoundarySmokeSource.includes('must not expose platform valuation providers'));
  assert.ok(
    serverSource.indexOf("app.use('/api', spaceIntegrationsRouter);") > serverSource.indexOf("app.use('/api/admin', adminCommonRouter);")
      && serverSource.indexOf("app.use('/api', spaceIntegrationsRouter);") < serverSource.indexOf("app.use('/api/admin/settings/email-delivery'"),
    'Workspace integration routes must stay mounted before platform-owned route blockers'
  );
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
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/spaces must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/spaces/create-with-onboarding must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('multi_workspace_platform'));
  assert.ok(platformEditionBoundarySmokeSource.includes('workspace_memberships'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/spaces/1/invites'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/spaces/${defaultSpaceId}/integrations'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/email-delivery'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform /api/admin/settings/email-delivery must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/media/feature-flags'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-pricecharting'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-ebay'));
  assert.ok(platformEditionBoundarySmokeSource.includes('/api/admin/settings/integrations/test-logs'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform PriceCharting diagnostic must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform eBay diagnostic must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('Platform log export diagnostic must be owned by cairn'));
  assert.ok(platformEditionBoundarySmokeSource.includes('self_registration_enabled'));
  assert.ok(platformEditionBoundarySmokeSource.includes('metrics_enabled'));
  assert.ok(platformEditionBoundarySmokeSource.includes('external_log_export_enabled'));
  assert.ok(!serverSource.includes("app.use('/api/support', supportPlatformRouter);"));
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
  assert.ok(rootPackageJson.scripts['audit:public-source-boundary']);
  assert.ok(!rootPackageJson.scripts['compose:generate']);
  assert.ok(!rootPackageJson.scripts['validate:public-export']);
  assert.ok(!rootPackageJson.scripts['public:export']);
  assert.ok(rootPackageJson.scripts['stack:up:homelab'].includes('docker compose --env-file .env up -d'));
  assert.ok(rootPackageJson.scripts['stack:up:platform'].includes('docker-compose.localhost.yml'));
  assert.ok(rootPackageJson.scripts['stack:ps:homelab']);
  assert.ok(rootPackageJson.scripts['stack:ps:platform']);
  assert.ok(rootPackageJson.scripts['test:edition-boundaries:local']);
}));

results.push(run('core instance contract exposes only public runtime metadata for cairn discovery', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.APP_VERSION = '9.9.9-test';
    process.env.APP_EDITION = 'platform';
    process.env.CORE_INSTANCE_ID = 'core-1';
    process.env.CORE_INSTANCE_SLUG = 'main-core';
    process.env.CORE_INSTANCE_NAME = 'Main Core';
    process.env.CORE_PUBLIC_BASE_URL = 'https://core.example';
    const contract = buildCoreInstanceContract({ now: new Date('2026-01-02T03:04:05.000Z') });

    assert.strictEqual(contract.status, 'ok');
    assert.strictEqual(contract.service, 'collectz-core');
    assert.strictEqual(contract.instance.id, 'core-1');
    assert.strictEqual(contract.instance.slug, 'main-core');
    assert.strictEqual(contract.instance.name, 'Main Core');
    assert.strictEqual(contract.instance.public_base_url, 'https://core.example');
    assert.strictEqual(contract.instance.login_path, '/login');
    assert.strictEqual(contract.instance.login_url, 'https://core.example/login');
    assert.strictEqual(contract.version, '9.9.9-test');
    assert.strictEqual(contract.runtime_mode, 'platform');
    assert.strictEqual(contract.runtime_contract.shell, 'platform');
    assert.strictEqual(contract.auth_authority, 'core');
    assert.deepStrictEqual(contract.capabilities, {
      local_accounts: true,
      workspace_memberships: true,
      support_session_bridge: true,
      platform_control_plane: false
    });
    assert.strictEqual(contract.generated_at, '2026-01-02T03:04:05.000Z');
    assert.ok(!JSON.stringify(contract).includes('DATABASE_URL'));
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
}));

results.push(run('release channel automation documents latest stable and manual promotion boundaries', () => {
  assert.ok(dockerPublishWorkflowSource.includes('type=raw,value=${{ needs.prepare.outputs.major_minor }}'));
  assert.ok(dockerPublishWorkflowSource.includes('type=raw,value=latest,enable={{is_default_branch}}'));
  assert.ok(stablePromotionWorkflowSource.includes('name: Promote Stable Images'));
  assert.ok(stablePromotionWorkflowSource.includes('workflow_dispatch'));
  assert.ok(stablePromotionWorkflowSource.includes('docker buildx imagetools inspect "ghcr.io/${OWNER_LC}/collectz-backend:${VERSION}"'));
  assert.ok(stablePromotionWorkflowSource.includes('docker buildx imagetools create'));
  assert.ok(stablePromotionWorkflowSource.includes('collectz-backend:stable'));
  assert.ok(stablePromotionWorkflowSource.includes('collectz-frontend:stable'));
  assert.ok(stablePromotionWorkflowSource.includes('stable-${MAJOR_MINOR}'));
  assert.ok(stablePromotionWorkflowSource.includes('Release workflow verified for ${tag}.'));
  if (securityPolicySource) {
    assert.ok(securityPolicySource.includes('| Latest | Yes |'));
    assert.ok(securityPolicySource.includes('| Stable | Yes |'));
    assert.ok(securityPolicySource.includes('at least seven days'));
  }
  assert.ok(ciCdDeployDocSource.includes('Release Cadence and Stable Promotion'));
  assert.ok(ciCdDeployDocSource.includes('Stable promotion retags existing image digests; it does not rebuild images.'));
}));

results.push(run('repo includes 2.9.4 Playwright browser regression foundation harness', () => {
  assert.ok(rootPackageJson.scripts['test:browser']);
  assert.ok(rootPackageJson.scripts['test:browser:core']);
  assert.ok(rootPackageJson.scripts['test:browser:core-regression']);
  assert.ok(rootPackageJson.scripts['test:browser:event-planner']);
  assert.ok(rootPackageJson.scripts['test:browser:platform']);
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
  assert.ok(!dockerComposeSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN'));
  assert.ok(!dockerComposeSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN'));
  assert.ok(ciComposeOverrideGeneratorSource.includes('DEBUG: \\${DEBUG:-0}'));
  assert.ok(ciComposeOverrideGeneratorSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN: \\${PLAYWRIGHT_E2E_BYPASS_TOKEN:-}'));
  assert.ok(playwrightAdminSetupSource.includes("updateFeatureFlag(requestContext, 'events_enabled', true)"));
  assert.ok(dockerPublishWorkflowSource.includes('browser-regression:'));
  assert.ok(dockerPublishWorkflowSource.includes('name: core-browser-regression'));
  assert.ok(dockerPublishWorkflowSource.includes('npx playwright install --with-deps chromium'));
  assert.ok(dockerPublishWorkflowSource.includes('npm run test:browser:core'));
  assert.ok(dockerPublishWorkflowSource.includes('playwright-browser-regression'));
  assert.ok(dockerPublishWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(!dockerPublishWorkflowSource.includes('collectz-playwright-ci'));
  assert.ok(dockerPublishWorkflowSource.includes('runtime-smoke:'));
  assert.ok(dockerPublishWorkflowSource.includes('name: core-runtime-smoke'));
  assert.ok(dockerPublishWorkflowSource.includes('- name: Core runtime'));
  assert.ok(dockerPublishWorkflowSource.includes('backend node scripts/homelab-edition-boundary-smoke.js'));
  assert.ok(!dockerPublishWorkflowSource.includes('npm run test:control-plane-runtime-smoke'));
  assert.ok(dockerPublishWorkflowSource.includes('- Core runtime smoke: PASS'));
  assert.ok(browserCapturesWorkflowSource.includes('workflow_dispatch:'));
  assert.ok(browserCapturesWorkflowSource.includes('npm run test:browser:capture'));
  assert.ok(browserCapturesWorkflowSource.includes('playwright-browser-captures'));
  assert.ok(browserCapturesWorkflowSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN="$(openssl rand -hex 16)"'));
  assert.ok(helpCenterBrowserSpecSource.includes('Help'));
  assert.ok(helpCenterBrowserSpecSource.includes('Guidance'));
  assert.ok(helpCenterBrowserSpecSource.includes('Releases'));
  assert.ok(helpCenterBrowserSpecSource.includes("name: 'Support', exact: true })).toHaveCount(0)"));
  assert.ok(rootPackageJson.scripts['test:browser:platform'].includes('help-center.browser.spec.js'));
  assert.ok(!rootPackageJson.scripts['test:browser:core-regression'].includes('space-manager.browser.spec.js'));
  assert.ok(!rootPackageJson.scripts['test:browser:platform'].includes('space-manager.browser.spec.js'));
  assert.ok(!rootPackageJson.scripts['test:browser:platform'].includes('help-admin-support.browser.spec.js'));
  assert.ok(!rootPackageJson.scripts['test:browser:platform'].includes('approved-support-session.browser.spec.js'));
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
  assert.ok(libraryLifecycleBrowserSpecSource.includes("getByRole('heading', { name: 'Import Media' })"));
  assert.ok(libraryLifecycleBrowserSpecSource.includes("toHaveCount(0)"));
  assert.ok(!fs.existsSync(path.resolve(__dirname, '..', '..', 'tests', 'playwright', 'specs', 'space-manager.browser.spec.js')));
  assert.ok(!fs.existsSync(path.resolve(__dirname, '..', '..', 'tests', 'playwright', 'helpers', 'admin.js')));
  assert.ok(!adminShellBrowserSpecSource.includes("getByRole('button', { name: 'Workspace', exact: true })).toHaveCount(0)"));
  assert.ok(boundaryBrowserSpecSource.includes('support_admin'));
  assert.ok(boundaryBrowserSpecSource.includes('/dashboard?tab=admin-integrations&integration=logs'));
  assert.ok(boundaryBrowserSpecSource.includes("toHaveURL(/\\/help$/)"));
  assert.ok(boundaryBrowserSpecSource.includes('/platform/workspaces'));
  assert.ok(eventsCollectiblesBrowserSpecSource.includes('/dashboard?tab=library-movies'));
  assert.ok(rootPackageJson.scripts['test:browser:event-planner'].includes('events-collectibles.browser.spec.js'));
  assert.ok(rootPackageJson.scripts['test:browser:core-regression'].includes('events-collectibles.browser.spec.js'));
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
  assert.ok(!integrationsRoutesSource.includes('const platformRouter = express.Router();'));
  assert.ok(integrationsRoutesSource.includes('async function buildSharedIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('async function buildPlatformIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('buildHomelabIntegrationPayload'));
  assert.ok(integrationsRoutesSource.includes('hasPlatformOnlyIntegrationUpdate'));
  assert.ok(integrationsRoutesSource.includes('valuationProviders'));
  assert.ok(integrationsRoutesSource.includes('pricecharting_enabled = EXCLUDED.pricecharting_enabled'));
  assert.ok(integrationsRoutesSource.includes('ebay_browse_enabled = EXCLUDED.ebay_browse_enabled'));
  assert.ok(integrationsRoutesSource.includes('log_export_backend = EXCLUDED.log_export_backend'));
  assert.ok(integrationsRoutesSource.includes('log_export_host = EXCLUDED.log_export_host'));
  assert.ok(integrationsRoutesSource.includes('kavita_base_url = EXCLUDED.kavita_base_url'));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.post('/admin/settings/integrations/test-kavita'"));
  assert.ok(integrationsRoutesSource.includes('Platform-only integration settings are not available in homelab edition'));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.get('/admin/settings/integrations'"));
  assert.ok(integrationsRoutesSource.includes("sharedRouter.put('/admin/settings/integrations'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-pricecharting'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-ebay'"));
  assert.ok(serverSource.includes("app.use('/api/admin/settings/integrations/test-logs'"));
  assert.ok(!integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-pricecharting'"));
  assert.ok(!integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-ebay'"));
  assert.ok(!integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-logs'"));
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
  assert.ok(mediaRoutesSource.includes('const directBookIsbn = normalizeIsbn(upc);'));
  assert.ok(mediaRoutesSource.includes("provider: 'books:isbn-direct'"));
  assert.ok(mediaRoutesSource.includes('matches: directBookMatches.length'));
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

results.push(run('repo includes Kavita connection smoke coverage for native API readback', () => {
  assert.ok(backendPackageJson.scripts['test:kavita-connection-smoke']);
  assert.ok(kavitaConnectionSmokeSource.includes('/api/admin/settings/integrations/test-kavita'));
  assert.ok(kavitaConnectionSmokeSource.includes('/api/Plugin/authenticate'));
  assert.ok(kavitaConnectionSmokeSource.includes('/api/Library/libraries'));
  assert.ok(kavitaConnectionSmokeSource.includes('/api/Series/all-v2'));
  assert.ok(kavitaConnectionSmokeSource.includes('Kavita API key must not be returned in settings response'));
}));

results.push(run('repo includes Kavita import sync smoke coverage for repeat sync and non-Kavita title reuse', () => {
  assert.ok(backendPackageJson.scripts['test:kavita-import-sync-smoke']);
  assert.ok(kavitaImportSyncSmokeSource.includes('/api/media/import-kavita?sync=1'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&chapterFanout=1'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected first Kavita import to create two new comic rows while reusing the existing non-Kavita book title'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected second Kavita import to avoid duplicate creation'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected default Kavita import to keep chapter fan-out disabled'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected first fan-out import to create two new issue rows while reusing the existing local issue'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita special chapter to import as an issue row'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected repeat fan-out import to avoid duplicate issue creation'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected fan-out to preserve existing non-Kavita comic issue metadata'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita book chapter to stay series-level only'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita special chapter issue marker'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita title reuse to preserve existing non-Kavita author metadata'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita library type 5 to classify as comic_book'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita numeric library type 5 to normalize as comic metadata'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita page metadata'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita comic reader launch URL metadata without secrets'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita issue-like series title to normalize away file-style suffixes'));
  assert.ok(kavitaImportSyncSmokeSource.includes("x-import-enrichment-mode': 'skip'"));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita chapter #1 provider issue id'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Kavita launch URL must not include API keys'));
  assert.ok(kavitaImportSyncSmokeSource.includes('Expected Kavita proxied cover content type'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/api/media/kavita-cover/8602'));
  assert.ok(kavitaImportSyncSmokeSource.includes("type_details->>'provider_item_id' = $2"));
}));

results.push(run('kavita launch URL helpers build secret-free native web routes', () => {
  assert.strictEqual(normalizeKavitaBaseUrl('http://192.168.1.50:5000/'), 'http://192.168.1.50:5000');
  assert.strictEqual(normalizeKavitaBaseUrl('https://kavita.example/root/'), 'https://kavita.example/root');
  assert.strictEqual(normalizeKavitaBaseUrl('https://kavita.example/root///'), 'https://kavita.example/root');
  assert.strictEqual(normalizeKavitaBaseUrl('file:///etc/passwd'), '');
  assert.strictEqual(normalizeKavitaBaseUrl('https://user:secret@kavita.example/root'), '');
  assert.strictEqual(normalizeTrustedConnectorHttpUrl('http://192.168.1.50:5000/root/'), 'http://192.168.1.50:5000/root');
  assert.strictEqual(buildKavitaSeriesProviderItemId(8602), 'kavita:series:8602');
  assert.strictEqual(buildKavitaChapterProviderItemId(9702), 'kavita:chapter:9702');
  assert.strictEqual(buildKavitaSeriesWebUrl('https://kavita.example/root/', 87, 8602), 'https://kavita.example/root/library/87/series/8602');
  assert.strictEqual(buildKavitaReaderWebUrl('https://kavita.example/root/', {
    libraryId: 87,
    seriesId: 8602,
    chapterId: 9702,
    format: 1,
    libraryType: 'comic'
  }), 'https://kavita.example/root/library/87/series/8602/manga/9702');
  assert.strictEqual(buildKavitaReaderWebUrl('https://kavita.example/root/', {
    libraryId: 86,
    seriesId: 8601,
    chapterId: 9701,
    format: 3,
    libraryType: 'book'
  }), 'https://kavita.example/root/library/86/series/8601/book/9701');
  assert.strictEqual(buildKavitaReaderWebUrl('https://kavita.example/root/', {
    libraryId: 86,
    seriesId: 8603,
    chapterId: 9703,
    format: 4,
    libraryType: 'book'
  }), 'https://kavita.example/root/library/86/series/8603/pdf/9703');
}));

results.push(run('kavita comic issue-like series titles normalize series and issue metadata', () => {
  assert.deepStrictEqual(parseKavitaComicIssueLikeSeriesTitle('Alpha Flight#130 - The Hollow Man! - Unknown'), {
    series: 'Alpha Flight',
    issueNumber: '130',
    issueTitle: 'The Hollow Man!',
    displayTitle: 'Alpha Flight #130 - The Hollow Man!'
  });
  assert.deepStrictEqual(parseKavitaComicIssueLikeSeriesTitle('Alpha Flight #129 - Ordeal!'), {
    series: 'Alpha Flight',
    issueNumber: '129',
    issueTitle: 'Ordeal!',
    displayTitle: 'Alpha Flight #129 - Ordeal!'
  });
  assert.strictEqual(parseKavitaComicIssueLikeSeriesTitle('HEAVY METAL MAGAZINE'), null);
}));

results.push(run('kavita numeric library type 5 is treated as comic for fan-out', () => {
  assert.strictEqual(normalizeKavitaLibraryType(5), 'comic');
  assert.strictEqual(normalizeKavitaLibraryType('5'), 'comic');
  assert.strictEqual(isKavitaComicLibraryType(5), true);
  assert.strictEqual(isKavitaComicLibraryType('5'), true);
}));

results.push(run('kavita chapter fan-out rows stay comic-only and keep provider identity separate', () => {
  const normalized = {
    title: 'Fanout Smoke Series',
    media_type: 'comic_book',
    year: 2023,
    release_date: '2023-01-01',
    format: 'Digital',
    overview: 'Smoke overview',
    poster_path: '/api/media/kavita-cover/8602',
    type_details: {
      series: 'Fanout Smoke Series',
      provider_name: 'kavita',
      provider_item_id: 'kavita:series:8602',
      provider_external_url: 'https://kavita.example/library/87/series/8602',
      kavita_library_id: 87,
      kavita_library_type: 'comic',
      kavita_series_id: 8602,
      kavita_series_name: 'Fanout Smoke Series',
      kavita_format: 1,
      kavita_series_url: 'https://kavita.example/library/87/series/8602'
    }
  };
  const fanout = normalizeKavitaChapterIssueRows(normalized, [
    {
      id: 9602,
      minNumber: 1,
      maxNumber: 1,
      chapters: [
        { id: 9702, volumeId: 9602, range: '1', sortOrder: 1, title: 'Fanout Smoke #1', releaseDate: '2023-03-04T00:00:00Z', pages: 24 },
        { id: 9799, volumeId: 9602, range: 'S', sortOrder: 99, title: 'Fanout Special', isSpecial: true },
        { id: 9800, volumeId: 9602, sortOrder: 100 }
      ]
    }
  ], { kavitaBaseUrl: 'https://kavita.example' });
  assert.strictEqual(fanout.rows.length, 3);
  assert.strictEqual(fanout.skippedSpecials, 0);
  const row = fanout.rows[0];
  assert.strictEqual(row.media_type, 'comic_book');
  assert.strictEqual(row.title, 'Fanout Smoke #1');
  assert.strictEqual(row.type_details.provider_item_id, 'kavita:chapter:9702');
  assert.strictEqual(row.type_details.provider_issue_id, 'kavita:chapter:9702');
  assert.strictEqual(row.type_details.kavita_parent_provider_item_id, 'kavita:series:8602');
  assert.strictEqual(row.type_details.kavita_chapter_fanout, 'true');
  assert.strictEqual(row.type_details.kavita_launch_url, 'https://kavita.example/library/87/series/8602/manga/9702');
  assert.strictEqual(row.poster_path, '/api/media/kavita-chapter-cover/9702');
  assert.strictEqual(row.type_details.kavita_cover_proxy_url, '/api/media/kavita-chapter-cover/9702');
  assert.strictEqual(row.type_details.kavita_cover_source, 'collectz_chapter_proxy');
  assert.strictEqual(row.type_details.kavita_cover_status, 'proxied_chapter_page_0');
  assert.strictEqual(fanout.rows[1].type_details.provider_item_id, 'kavita:chapter:9799');
  assert.strictEqual(fanout.rows[1].type_details.issue_number, 'S');
  assert.strictEqual(fanout.rows[1].type_details.kavita_chapter_special, 'true');
  assert.strictEqual(fanout.rows[2].title, 'Fanout Smoke Series #100');
  assert.strictEqual(fanout.rows[2].type_details.issue_number, '100');
  assert.strictEqual(fanout.rows[2].type_details.kavita_chapter_sort_order, '100');

  const bookFanout = normalizeKavitaChapterIssueRows({
    ...normalized,
    media_type: 'book',
    type_details: { ...normalized.type_details, kavita_library_type: 'book' }
  }, [{ id: 1, chapters: [{ id: 2, title: 'Book Chapter' }] }], { kavitaBaseUrl: 'https://kavita.example' });
  assert.deepStrictEqual(bookFanout.rows, []);
  assert.strictEqual(bookFanout.skippedBooks, 1);

  const issueLikeSeriesFanout = normalizeKavitaChapterIssueRows({
    ...normalized,
    type_details: { ...normalized.type_details, kavita_title_parse_status: 'issue_like_series' }
  }, [{ id: 1, chapters: [{ id: 2, title: 'Duplicate Issue Chapter' }] }], { kavitaBaseUrl: 'https://kavita.example' });
  assert.deepStrictEqual(issueLikeSeriesFanout.rows, []);
  assert.strictEqual(issueLikeSeriesFanout.skippedSparseMetadata, 1);
}));

results.push(run('kavita cover helpers preserve proxy base paths and reject cross-origin images', () => {
  assert.strictEqual(buildKavitaCoverProxyPath(8602), '/api/media/kavita-cover/8602');
  assert.strictEqual(buildKavitaChapterCoverProxyPath(9702), '/api/media/kavita-chapter-cover/9702');
  assert.strictEqual(buildKavitaSeriesCoverImagePath(8602), '/api/Image/series-cover?seriesId=8602');
  assert.strictEqual(buildKavitaCoverImageUrl('https://kavita.example/root/', '/api/image/series-cover?seriesId=8602'), 'https://kavita.example/root/api/image/series-cover?seriesId=8602');
  assert.strictEqual(buildKavitaCoverImageUrl('https://kavita.example/root/', buildKavitaSeriesCoverImagePath(8602)), 'https://kavita.example/root/api/Image/series-cover?seriesId=8602');
  assert.strictEqual(buildKavitaCoverImageUrl('https://kavita.example/root/', 'https://kavita.example/root/api/image/series-cover?seriesId=8602'), 'https://kavita.example/root/api/image/series-cover?seriesId=8602');
  assert.strictEqual(buildKavitaCoverImageUrl('https://kavita.example/root/', 'https://evil.example/root/api/image/series-cover?seriesId=8602'), '');
}));

results.push(run('kavita reader and progress contract documents opt-in writeback and page proxying', () => {
  assert.ok(kavitaSetupDocSource.includes('42-Kavita-Reader-Progress-Contract.md'));
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.102` implements the first opt-in progress writeback and page-proxy reader slice'));
  assert.ok(kavitaReaderProgressDocSource.includes('Do not iframe Kavita'));
  assert.ok(kavitaReaderProgressDocSource.includes('collectZ may proxy `/api/Reader/image` for a single authenticated chapter page'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/api/media/kavita-chapter-cover/9702'));
  assert.ok(kavitaReaderProgressDocSource.includes('Progress writeback requires an explicit user action'));
  assert.ok(kavitaReaderProgressDocSource.includes('`GET /api/Reader/get-progress`'));
  assert.ok(kavitaReaderProgressDocSource.includes('`POST /api/Reader/progress`'));
  assert.ok(kavitaReaderProgressDocSource.includes('`GET /api/Reader/image`'));
  assert.ok(kavitaReaderProgressDocSource.includes('`GET /api/Koreader/{apiKey}/syncs/progress/{ebookHash}`'));
  assert.ok(kavitaReaderProgressDocSource.includes('Kavita auth keys remain backend-only integration secrets'));
}));

results.push(run('kavita progress sync contract supports explicit progress writeback and reader proxy endpoints', () => {
  assert.ok(backendPackageJson.scripts['test:kavita-progress-contract-probe']);
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.100` defines the first progress-sync contract'));
  assert.ok(kavitaReaderProgressDocSource.includes('Read-only progress visibility is the first viable implementation shape'));
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.102` implements the first opt-in progress writeback'));
  assert.ok(kavitaReaderProgressDocSource.includes('Do not use KOReader sync endpoints as a shortcut'));
  assert.ok(kavitaReaderProgressDocSource.includes('Workspace-owned Kavita credentials remain backend-only'));
  assert.ok(kavitaProgressContractProbeSource.includes('createFakeKavitaProgressServer'));
  assert.ok(kavitaProgressContractProbeSource.includes('progressSyncImplementationEnabled'));
  assert.ok(kavitaProgressContractProbeSource.includes('secretReturned'));
  assert.ok(mediaRoutesSource.includes("router.get('/:id/kavita-progress'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/kavita-progress'"));
  assert.ok(mediaRoutesSource.includes("router.get('/:id/kavita-reader-info'"));
  assert.ok(mediaRoutesSource.includes("router.get('/:id/kavita-reader-page'"));
  assert.ok(mediaRoutesSource.includes('media.kavita.progress.read'));
  assert.ok(mediaRoutesSource.includes('media.kavita.progress.write'));
  assert.ok(mediaRoutesSource.includes('media.kavita.reader.page'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-progress'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-reader-info'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-reader-page'));
  assert.ok(libraryViewSource.includes('Kavita Reader'));
  assert.ok(libraryViewSource.includes('Read Progress'));
  assert.ok(libraryViewSource.includes('Save Progress'));
  assert.ok(libraryViewSource.includes('Page preview'));
  assert.ok(libraryViewSource.includes('kavitaProgressRows'));
  const payload = buildKavitaProgressWritePayload({
    libraryId: 87,
    seriesId: 8602,
    volumeId: 9602,
    chapterId: 9702,
    pageNum: 1,
    bookScrollId: 'scroll-1',
    lastModifiedUtc: '2026-05-06T01:00:00Z'
  });
  assert.strictEqual(payload.pageNum, 1);
  assert.strictEqual(payload.chapterId, 9702);
}));

results.push(run('kavita chapter mark-read implementation stays chapter-scoped', () => {
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.103` defines the mark read/unread contract'));
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.104` implements explicit chapter mark-read'));
  assert.ok(kavitaReaderProgressDocSource.includes('`POST /api/Reader/mark-read` and `POST /api/Reader/mark-unread` use `MarkReadDto`'));
  assert.ok(kavitaReaderProgressDocSource.includes('`POST /api/Reader/mark-chapter-read` uses `MarkChapterReadDto`'));
  assert.ok(kavitaReaderProgressDocSource.includes('does not expose a chapter-level mark-unread endpoint'));
  assert.ok(kavitaReaderProgressDocSource.includes('chapter mark-read is enabled only for explicit user action'));
  assert.ok(kavitaProgressContractProbeSource.includes('readStateImplementationEnabled'));
  assert.ok(kavitaProgressContractProbeSource.includes('READ_STATE_DISABLED_WRITE_ENDPOINTS'));
  assert.ok(kavitaProgressContractProbeSource.includes('/api/Reader/mark-chapter-read'));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/kavita-read-state'"));
  assert.ok(mediaRoutesSource.includes('media.kavita.read_state.mark_chapter_read'));
  assert.ok(!mediaRoutesSource.includes('/api/Reader/mark-read'));
  assert.ok(!mediaRoutesSource.includes('/api/Reader/mark-volume-read'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-read-state'));
  assert.ok(kavitaImportSyncSmokeSource.includes('bulkReadStateWrites.length === 0'));
  assert.ok(libraryViewSource.includes('Mark Read in Kavita'));
  const readStatePayload = buildKavitaChapterReadStatePayload({
    seriesId: 8602,
    chapterId: 9702,
    generateReadingSession: false
  });
  assert.deepStrictEqual(readStatePayload, {
    seriesId: 8602,
    chapterId: 9702,
    generateReadingSession: false
  });
}));

results.push(run('kavita chapter unread contract keeps reversal disabled and avoids bulk endpoints', () => {
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.105` defines the chapter unread/read-state reversal contract'));
  assert.ok(kavitaReaderProgressDocSource.includes('No chapter-level mark-unread endpoint is present'));
  assert.ok(kavitaReaderProgressDocSource.includes('`POST /api/Reader/progress` with `pageNum: 0` is a reset-progress candidate'));
  assert.ok(kavitaReaderProgressDocSource.includes('Future implementation copy should distinguish `Reset Kavita progress` from `Mark unread`'));
  assert.ok(kavitaProgressContractProbeSource.includes('unreadContract'));
  assert.ok(kavitaProgressContractProbeSource.includes('chapterUnreadEndpointAvailable'));
  assert.ok(kavitaProgressContractProbeSource.includes('/api/Reader/mark-volume-unread'));
  assert.ok(kavitaProgressContractProbeSource.includes('/api/Reader/mark-multiple-unread'));
  assert.ok(kavitaProgressContractProbeSource.includes('/api/Reader/mark-multiple-series-unread'));
  assert.ok(!mediaRoutesSource.includes('mark_chapter_unread'));
  assert.ok(!libraryViewSource.includes('Mark Unread in Kavita'));
  assert.ok(libraryViewSource.includes('Reset Progress'));
}));

results.push(run('kavita reset progress runtime uses page zero without claiming unread', () => {
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.106` proves the reset-progress probe shape'));
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.107` enables explicit reset-progress runtime behavior'));
  assert.ok(kavitaProgressContractProbeSource.includes('resetProgressProbe'));
  assert.ok(kavitaProgressContractProbeSource.includes('noBulkUnreadEndpointCalled'));
  assert.ok(kavitaProgressContractProbeSource.includes('buildKavitaResetProgressPayload'));
  assert.ok(kavitaProgressContractProbeSource.includes('buildKavitaResetProgressProbePayload'));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/kavita-reset-progress'"));
  assert.ok(mediaRoutesSource.includes('media.kavita.progress.reset'));
  assert.ok(mediaRoutesSource.includes('no chapter-level mark-unread endpoint'));
  assert.ok(libraryViewSource.includes('/kavita-reset-progress'));
  assert.ok(!libraryViewSource.includes('Mark Unread in Kavita'));
  const resetPayload = buildKavitaResetProgressProbePayload({
    libraryId: 87,
    seriesId: 8602,
    volumeId: 9602,
    chapterId: 9702,
    lastModifiedUtc: '2026-05-06T05:20:00Z'
  });
  assert.strictEqual(resetPayload.pageNum, 0);
  assert.strictEqual(resetPayload.bookScrollId, null);
  assert.deepStrictEqual(buildKavitaResetProgressPayload({
    libraryId: 87,
    seriesId: 8602,
    volumeId: 9602,
    chapterId: 9702,
    lastModifiedUtc: '2026-05-06T05:20:00Z'
  }), resetPayload);
}));

results.push(run('kavita embedded reader controls stay explicit and one-based in the drawer', () => {
  assert.ok(kavitaReaderProgressDocSource.includes('`3.4.108` polishes the existing Kavita chapter reader controls'));
  assert.ok(kavitaReaderProgressDocSource.includes('Page entry is user-facing and one-based'));
  assert.ok(kavitaReaderProgressDocSource.includes('No operation auto-saves progress when the user changes pages'));
  assert.ok(libraryViewSource.includes('Kavita Reader'));
  assert.ok(libraryViewSource.includes('Load Reader'));
  assert.ok(libraryViewSource.includes('Page preview'));
  assert.ok(libraryViewSource.includes('kavitaReaderImageStatus'));
  assert.ok(libraryViewSource.includes('kavitaReaderDisplayPage = kavitaReaderPage + 1'));
  assert.ok(libraryViewSource.includes('setKavitaReaderDisplayPage'));
  assert.ok(libraryViewSource.includes('This Kavita page could not be loaded.'));
  assert.ok(libraryViewSource.includes('Saved {kavitaProgressDisplayPage'));
  assert.ok(libraryViewSource.includes('onLoad={() => setKavitaReaderImageStatus'));
  assert.ok(libraryViewSource.includes('onError={() => setKavitaReaderImageStatus'));
  assert.ok(!libraryViewSource.includes('Mark Unread in Kavita'));
}));

results.push(run('kavita chapter fan-out contract keeps series and issue identities distinct', () => {
  assert.ok(kavitaSetupDocSource.includes('43-Kavita-Chapter-Issue-Fanout-Contract.md'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Series row: `provider_item_id = kavita:series:{seriesId}`'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Chapter/issue row: `provider_item_id = kavita:chapter:{chapterId}`'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Chapter fan-out is comic-only'));
  assert.ok(kavitaChapterFanoutDocSource.includes('`3.4.93` implements'));
  assert.ok(kavitaChapterFanoutDocSource.includes('observed numeric Kavita library types `1` and `5` normalize to `comic`'));
  assert.ok(mediaRoutesSource.includes('includeChapterFanout'));
  assert.ok(mediaRoutesSource.includes('provider_issue_id'));
  assert.ok(openApiSource.includes('"chapterFanout"'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Admin Kavita import defaults to importing comic chapters as issue rows'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Repeat fan-out sync reports no duplicate creation'));
  assert.ok(kavitaChapterFanoutDocSource.includes('Book libraries do not fan out into comic issue rows'));
  assert.ok(kavitaChapterFanoutDocSource.includes('No reader/progress endpoints are called as part of fan-out'));
}));

results.push(run('kavita workspace-owned administration contract keeps tenancy boundary explicit', () => {
  assert.ok(kavitaSetupDocSource.includes('44-Kavita-Workspace-Owned-Administration-Contract.md'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Kavita connection settings are workspace-owned'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Workspace admins can save, test, import from, and clear only the Kavita connection'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Platform admins can manage a workspace Kavita connection only while operating in that workspace context'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Homelab keeps the same effective single-workspace behavior'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Two workspaces may import from different Kavita servers that use the same Kavita series or chapter ids'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('Settings readback never returns raw API keys'));
  assert.ok(kavitaWorkspaceAdminDocSource.includes('3.4.95` implements the first workspace-owned administration path'));
}));

results.push(run('kavita workspace-owned administration implementation is wired through space integrations', () => {
  assert.ok(integrationsServiceSource.includes('loadWorkspaceKavitaIntegrationConfig'));
  assert.ok(integrationsServiceSource.includes("kavitaBaseUrl: normalizeKavitaBaseUrl(row?.kavita_base_url || '')"));
  assert.ok(spaceIntegrationsRoutesSource.includes("router.post('/spaces/:spaceId/integrations/test-kavita'"));
  assert.ok(spaceIntegrationsRoutesSource.includes('kavita_base_url, kavita_api_key_encrypted, kavita_timeout_ms'));
  assert.ok(spaceIntegrationsRoutesSource.includes('integrationScope'));
  assert.ok(spaceIntegrationsRoutesSource.includes('effective_source'));
  assert.ok(spaceIntegrationsRoutesSource.includes('workspace_configured'));
  assert.ok(spaceIntegrationsRoutesSource.includes('inherited_default'));
  assert.ok(spaceIntegrationsRoutesSource.includes('workspace_can_override'));
  assert.ok(mediaRoutesSource.includes("Kavita import requires workspace admin access"));
  assert.ok(mediaRoutesSource.includes("Kavita is not configured for the active workspace"));
  assert.ok(mediaRoutesSource.includes('loadWorkspaceKavitaIntegrationConfig(row.space_id || scopeContext?.spaceId || null)'));
  assert.ok(spaceManagerViewSource.includes("'kavita'"));
  assert.ok(adminIntegrationsViewSource.includes('IntegrationSourceBadge'));
  assert.ok(adminIntegrationsViewSource.includes('integrationScope?.sections?.[section]'));
  assert.ok(dashboardContentSource.includes("['audio', 'barcode', 'books', 'cwa', 'comics', 'games', 'kavita', 'plex', 'tmdb']"));
  assert.ok(dashboardContentSource.includes("['logs', 'metrics']"));
  assert.ok(spaceManagerViewSource.includes('title=""'));
  assert.ok(!spaceManagerViewSource.includes('title="Workspace Integrations"'));
  assert.ok(!spaceManagerViewSource.includes('Readable activity entries scoped to the active workspace'));
  assert.ok(!adminIntegrationsViewSource.includes('SECTION_DESCRIPTIONS'));
  assert.ok(!adminIntegrationsViewSource.includes('activeSectionSource.detail'));
  assert.ok(adminIntegrationsViewSource.includes("headerClassName={!header ? 'hidden' : ''}"));
  assert.ok(dashboardContentSource.includes('title="Integrations"'));
  assert.ok(dashboardShellSource.includes("'admin-integrations': 'Integrations'"));
  assert.ok(!dashboardShellSource.includes("'admin-integrations': 'Platform Runtime'"));
  assert.ok(openApiSource.includes('/api/spaces/{id}/integrations/test-kavita'));
  assert.ok(openApiSource.includes('"integrationScope"'));
  assert.ok(openApiSource.includes('"effective_source"'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/integrations/test-kavita'));
  assert.ok(kavitaImportSyncSmokeSource.includes('workspaceOwnedSettings: true'));
  assert.ok(kavitaImportSyncSmokeSource.includes('overlapping Kavita ids to create rows in the second workspace only'));
}));

results.push(run('kavita metadata writeback contract remains opt-in and preview-first', () => {
  assert.ok(backendPackageJson.scripts['test:kavita-metadata-writeback-probe']);
  assert.ok(kavitaSetupDocSource.includes('45-Kavita-Metadata-Writeback-Contract.md'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('`POST /api/Series/metadata`'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('`POST /api/Chapter/update`'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('Writeback is disabled by default'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('preview diff'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('workspace-owned Kavita connection'));
  assert.ok(kavitaMetadataWritebackDocSource.includes('Kavita credentials remain backend-only secrets'));
  assert.ok(kavitaMetadataWritebackProbeSource.includes('createFakeKavitaWritebackServer'));
  assert.ok(kavitaMetadataWritebackProbeSource.includes('writebackImplementationEnabled'));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/kavita-writeback-preview'"));
  assert.ok(mediaRoutesSource.includes("router.post('/:id/kavita-writeback-apply'"));
  assert.ok(mediaRoutesSource.includes('media.kavita.writeback.preview'));
  assert.ok(mediaRoutesSource.includes('media.kavita.writeback.apply'));
  assert.ok(libraryViewSource.includes('Preview Diff'));
  assert.ok(libraryViewSource.includes('Apply to Kavita'));
  assert.ok(libraryViewSource.includes('kavitaSelectedFields'));
  assert.ok(libraryViewSource.includes('Apply ${entry.field} to Kavita'));
  assert.ok(libraryViewSource.includes('selectedFields,'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-writeback-preview'));
  assert.ok(kavitaImportSyncSmokeSource.includes('/kavita-writeback-apply'));
  const probe = buildKavitaMetadataWritebackProbe();
  assert.strictEqual(probe.implementationEnabled, false);
  assert.strictEqual(probe.endpoints.seriesMetadata.endpoint, '/api/Series/metadata');
  assert.strictEqual(probe.endpoints.chapterMetadata.endpoint, '/api/Chapter/update');
  const seriesPayload = buildKavitaSeriesMetadataWritebackPayload({
    seriesId: 8602,
    metadata: {
      summary: 'Previewed summary',
      tags: ['collectz'],
      writersLocked: true,
      writers: [{ name: 'Locked Writer' }],
      apiKey: 'must-not-leak'
    },
    selectedFields: ['summary', 'tags', 'writers', 'apiKey']
  });
  assert.deepStrictEqual(seriesPayload.body, {
    seriesMetadata: {
      seriesId: 8602,
      summary: 'Previewed summary',
      tags: ['collectz']
    }
  });
  assert.deepStrictEqual(seriesPayload.skippedFields, [{ field: 'writers', reason: 'locked' }]);
  assert.ok(!JSON.stringify(seriesPayload).includes('must-not-leak'));
  const chapterPayload = buildKavitaChapterMetadataWritebackPayload({
    chapterId: 9702,
    metadata: {
      titleName: 'Issue 1',
      releaseDate: '2024-05-01',
      pages: 22
    },
    selectedFields: ['titleName', 'releaseDate', 'pages']
  });
  assert.deepStrictEqual(chapterPayload.body, {
    id: 9702,
    titleName: 'Issue 1',
    releaseDate: '2024-05-01'
  });
  const preview = buildKavitaMetadataWritebackPreview({
    target: 'series',
    targetId: 8602,
    currentMetadata: {
      seriesId: 8602,
      summary: 'Current',
      releaseYear: 2020,
      writers: ['Locked Writer'],
      writersLocked: true
    },
    proposedMetadata: {
      summary: 'Next',
      releaseYear: 2024,
      writers: ['New Writer']
    },
    selectedFields: ['summary', 'releaseYear', 'writers']
  });
  assert.strictEqual(preview.implementationEnabled, false);
  assert.strictEqual(preview.mutationEnabled, false);
  assert.deepStrictEqual(preview.changedFields, ['summary', 'releaseYear']);
  assert.deepStrictEqual(preview.skippedFields, [{ field: 'writers', reason: 'locked' }]);
  const applyPayload = buildKavitaSeriesMetadataWritebackPayload({
    seriesId: 8602,
    metadata: {
      releaseYear: 2024
    },
    selectedFields: ['releaseYear'],
    implementationEnabled: true
  });
  assert.strictEqual(applyPayload.implementationEnabled, true);
  assert.deepStrictEqual(applyPayload.body, {
    seriesMetadata: {
      seriesId: 8602,
      releaseYear: 2024
    }
  });
}));

results.push(run('AppPrimitives keeps authenticated collectZ API image paths same-origin', () => {
  assert.ok(appPrimitivesSource.includes("if (value.startsWith('/api/')) return encodedPath;"));
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

results.push(run('LibraryView renders Kavita launch actions without treating them as embedded readers', () => {
  assert.ok(libraryViewSource.includes('kavita_launch_url'));
  assert.ok(libraryViewSource.includes('kavitaLaunchLabel'));
  assert.ok(libraryViewSource.includes('Open in Kavita'));
}));

results.push(run('LibraryView renders compact lookup thumbnails for provider search matches', () => {
  assert.ok(libraryViewSource.includes('const resolveLookupThumbnailPath = (match) => ('));
  assert.ok(libraryViewSource.includes("aria-label=\"Search result thumbnail\""));
  assert.ok(libraryViewSource.includes('const thumbnailSrc = posterUrl(resolveLookupThumbnailPath(m));'));
  assert.ok(libraryViewSource.includes("className=\"relative mt-0.5 h-16 w-11 shrink-0 overflow-hidden rounded-[4px] border border-edge/70 bg-panel\""));
}));

results.push(run('LibraryView uses movie original-title input as a save fallback', () => {
  assert.ok(libraryViewSource.includes("const resolvePrimaryTitle = () => String(form.title || (isMovieOrTv ? form.original_title : '') || '').trim();"));
  assert.ok(libraryViewSource.includes('const primaryTitle = resolvePrimaryTitle();'));
  assert.ok(libraryViewSource.includes('title: primaryTitle,'));
  assert.ok(libraryViewSource.includes('original_title: isMovieOrTv && rawOriginalTitle && rawOriginalTitle !== primaryTitle ? rawOriginalTitle : null'));
}));

results.push(run('media update validation normalizes common slash dates for library edits', () => {
  const parsed = mediaUpdateSchema.safeParse({
    title: 'Soldier',
    media_type: 'movie',
    release_date: '01/01/1998',
    signed_on: '6/19/2026',
    year: 1998,
    runtime: 96,
    owned_formats: ['bluray'],
    tmdb_media_type: 'movie',
    type_details: { edition: 'Theatrical' }
  });
  assert.strictEqual(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.strictEqual(parsed.data.release_date, '1998-01-01');
  assert.strictEqual(parsed.data.signed_on, '2026-06-19');
}));

results.push(run('LibraryView save failures include backend field validation details', () => {
  assert.ok(libraryViewSource.includes("function formatApiError(error, fallback = 'Save failed')"));
  assert.ok(libraryViewSource.includes('return field ? `${data.error || fallback}: ${field} ${detail.message}`'));
  assert.ok(libraryViewSource.includes("notify(formatApiError(e2, 'Save failed'), 'error');"));
}));

results.push(run('shared posterUrl rejects unsafe image protocols while preserving trusted image paths', () => {
  assert.ok(appPrimitivesSource.includes("value.startsWith('http://') || value.startsWith('https://')"));
  assert.ok(appPrimitivesSource.includes("value.startsWith('blob:')"));
  assert.ok(appPrimitivesSource.includes("value.startsWith('/api/')"));
  assert.ok(appPrimitivesSource.includes("value.startsWith('/uploads/')"));
  assert.ok(appPrimitivesSource.includes("value.includes('/p/')"));
  assert.ok(!appPrimitivesSource.includes("if (path.startsWith('http')) return path;"));
  assert.ok(!appPrimitivesSource.includes('return path;'));
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

results.push(run('drawer optional metadata primitives render compact rows with adaptive condition labels', () => {
  assert.ok(appPrimitivesSource.includes('function DrawerMetadataList({ items = null, children, className = \'\' })'));
  assert.ok(appPrimitivesSource.includes('function buildDrawerMetadataRenderItems(records = [], nodesById = {})'));
  assert.ok(appPrimitivesSource.includes('export function DrawerOverview({'));
  assert.ok(appPrimitivesSource.includes('collapsedLines = 4'));
  assert.ok(appPrimitivesSource.includes('const measureOverflow = useCallback(() => {'));
  assert.ok(appPrimitivesSource.includes('element.scrollHeight > element.clientHeight + 1'));
  assert.ok(appPrimitivesSource.includes('if (expanded) return undefined;'));
  assert.ok(appPrimitivesSource.includes('new ResizeObserver(measureOverflow)'));
  assert.ok(appPrimitivesSource.includes('WebkitLineClamp: lineCount'));
  assert.ok(appPrimitivesSource.includes('aria-expanded={expanded}'));
  assert.ok(appPrimitivesSource.includes('aria-controls={contentId}'));
  assert.ok(appPrimitivesSource.includes("{expanded ? 'Show less' : 'Show more'}"));
  assert.ok(appPrimitivesSource.includes('node: record?.node || nodesById?.[record?.id]'));
  assert.ok(appPrimitivesSource.includes('.filter((record) => record && (record.node || record.render))'));
  assert.ok(appPrimitivesSource.includes('const orderedItems = Array.isArray(items)'));
  assert.ok(appPrimitivesSource.includes('left?.metadata?.displayPriority'));
  assert.ok(appPrimitivesSource.includes('right?.metadata?.displayPriority'));
  assert.ok(appPrimitivesSource.includes("typeof item.render === 'function' ? item.render(item.metadata) : item.node"));
  assert.ok(appPrimitivesSource.includes('function DrawerMetadataItem({'));
  assert.ok(appPrimitivesSource.includes('function DrawerMetadataEntry({'));
  assert.ok(drawerMetadataSource.includes('export function buildEditionMetadata({ trait = null, mediaType = \'movie\' } = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildGradingMetadata({ trait = null, mediaType = \'\', ownerType = \'\' } = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildProvenanceMetadata({ trait = null } = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildObjectRelationshipMetadata({ relationships = [], loading = false } = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildLoanMetadata({ loan = null, loading = false, formatDate = (value) => value } = {})'));
  assert.ok(drawerMetadataSource.includes('export const DRAWER_METADATA_IDS = Object.freeze({'));
  assert.ok(drawerMetadataSource.includes('const DRAWER_METADATA_BASE = Object.freeze({'));
  assert.ok(drawerMetadataSource.includes('export const DRAWER_METADATA_REGISTRY = Object.freeze({'));
  assert.ok(drawerMetadataSource.includes('export function buildDrawerMetadata(id = \'\', context = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildDrawerMetadataItems(entries = [], sharedContext = {})'));
  assert.ok(drawerMetadataSource.includes('export function buildObjectDrawerMetadataRecords({'));
  assert.ok(drawerMetadataSource.includes('export function getDrawerMetadataRegistryEntry(id = \'\')'));
  assert.ok(drawerMetadataSource.includes('appliesTo: () => true'));
  assert.ok(drawerMetadataSource.includes('.filter((item) => item && item.metadata?.applies !== false)'));
  assert.ok(drawerMetadataSource.includes('left?.metadata?.displayPriority'));
  assert.ok(drawerMetadataSource.includes('right?.metadata?.displayPriority'));
  assert.ok(appPrimitivesSource.includes("className={cx('border-b border-edge/70 py-2.5'"));
  assert.ok(appPrimitivesSource.includes('children,'));
  assert.ok(appPrimitivesSource.includes('actions,'));
  assert.ok(appPrimitivesSource.includes('actionDisabled = false'));
  assert.ok(drawerMetadataSource.includes("displayPriority: 20"));
  assert.ok(drawerMetadataSource.includes("displayPriority: 30"));
  assert.ok(drawerMetadataSource.includes("displayPriority: 40"));
  assert.ok(drawerMetadataSource.includes("displayPriority: 50"));
  assert.ok(drawerMetadataSource.includes("displayPriority: 60"));
  assert.ok(drawerMetadataSource.includes("form: 'edition_variant'"));
  assert.ok(drawerMetadataSource.includes("form: 'grading'"));
  assert.ok(drawerMetadataSource.includes("form: 'provenance'"));
  assert.ok(drawerMetadataSource.includes("form: 'object_relationship'"));
  assert.ok(drawerMetadataSource.includes("form: 'loan'"));
  assert.ok(drawerMetadataSource.includes("proof: 'proof'"));
  assert.ok(drawerMetadataSource.includes("related: 'related'"));
  assert.ok(drawerMetadataSource.includes("loan: 'loan'"));
  assert.ok(drawerMetadataSource.includes('id: base.id'));
  assert.ok(drawerMetadataSource.includes("id: normalizedOwner === 'art'"));
  assert.ok(drawerMetadataSource.includes("? 'authentication'"));
  assert.ok(drawerMetadataSource.includes("? 'condition' : 'grading'"));
  assert.ok(appPrimitivesSource.includes('const metadata = buildEditionMetadata({ trait: currentTrait, mediaType });'));
  assert.ok(appPrimitivesSource.includes('const metadata = buildGradingMetadata({ trait: currentTrait, mediaType, ownerType });'));
  assert.ok(appPrimitivesSource.includes('const metadata = buildProvenanceMetadata({ trait: currentTrait });'));
  assert.ok(appPrimitivesSource.includes('const metadata = buildObjectRelationshipMetadata({ relationships, loading });'));
  assert.ok(appPrimitivesSource.includes('const copy = metadata.copy;'));
  assert.ok(appPrimitivesSource.includes('<DrawerMetadataEntry'));
  assert.ok(appPrimitivesSource.includes("{children ? <div className=\"mt-3\">{children}</div> : null}"));
  assert.ok(drawerMetadataSource.includes('export function gradingCopyForContext({ mediaType = \'\', ownerType = \'\' } = {})'));
  assert.ok(drawerMetadataSource.includes("CONDITION_LIKE_MEDIA_TYPES.has(normalizedMedia)"));
  assert.ok(drawerMetadataSource.includes("title: 'Condition'"));
  assert.ok(drawerMetadataSource.includes("title: 'Authentication'"));
  assert.ok(appPrimitivesSource.includes('export function buildObjectDrawerMetadataEditorNodes({'));
  assert.ok(appPrimitivesSource.includes('nodes[DRAWER_METADATA_IDS.edition] = ('));
  assert.ok(appPrimitivesSource.includes('nodes[DRAWER_METADATA_IDS.grading] = ('));
  assert.ok(appPrimitivesSource.includes('nodes[DRAWER_METADATA_IDS.proof] = ('));
  assert.ok(appPrimitivesSource.includes('nodes[DRAWER_METADATA_IDS.related] = ('));
  assert.ok(appPrimitivesSource.includes('<EditionVariantEditor'));
  assert.ok(appPrimitivesSource.includes('<CollectibleGradingEditor'));
  assert.ok(appPrimitivesSource.includes('<CollectibleProvenanceEditor'));
  assert.ok(appPrimitivesSource.includes('<ObjectRelationshipEditor'));
  assert.ok(drawerMetadataSource.includes("summary: trait?.summary || ''"));
  assert.ok(!appPrimitivesSource.includes("currentTrait && !editing ? (\\n            <p className=\"mt-1 text-sm text-dim\">"));
  assert.ok(!appPrimitivesSource.includes("rounded-lg border border-edge bg-surface/35 p-3"));
  assert.ok(!appPrimitivesSource.includes('Record COA, receipt, witnessed, or source details when evidence exists.'));
  assert.ok(!libraryViewSource.includes('Record when this title leaves the shelf and when it should come back.'));
  assert.ok(!drawerMetadataSource.includes('Link box sets, bundle pieces, companion records, or event-acquired items without duplicating records.'));
  assert.ok(libraryViewSource.includes('const drawerMetadataRecords = showLoanFocusedView ? [] : buildObjectDrawerMetadataRecords({'));
  assert.ok(libraryViewSource.includes("ownerType: 'media'"));
  assert.ok(libraryViewSource.includes('includeEdition: true'));
  assert.ok(drawerMetadataSource.includes('id: DRAWER_METADATA_IDS.edition'));
  assert.ok(drawerMetadataSource.includes('id: DRAWER_METADATA_IDS.grading'));
  assert.ok(drawerMetadataSource.includes('id: DRAWER_METADATA_IDS.proof'));
  assert.ok(drawerMetadataSource.includes('id: DRAWER_METADATA_IDS.related'));
  assert.ok(libraryViewSource.includes('const drawerMetadataNodes = buildObjectDrawerMetadataEditorNodes({'));
  assert.ok(libraryViewSource.includes('mediaType: item?.media_type'));
  assert.ok(libraryViewSource.includes('const drawerMetadataItems = buildDrawerMetadataRenderItems(drawerMetadataRecords, drawerMetadataNodes);'));
  assert.ok(libraryViewSource.includes('<DrawerMetadataList items={drawerMetadataItems} />'));
  assert.ok(libraryViewSource.includes('<DrawerOverview'));
  assert.ok(libraryViewSource.includes('collapsedLines={4}'));
  assert.ok(!libraryViewSource.includes('comicOverviewExpanded'));
  assert.ok(!libraryViewSource.includes('comicOverviewNeedsClamp'));
  assert.ok(libraryViewSource.includes('const loanMetadata = buildLoanMetadata({ loan: activeLoan, loading: loanLoading, formatDate });'));
  assert.ok(libraryViewSource.includes('<DrawerMetadataEntry'));
  assert.ok(libraryViewSource.includes("{loanFormOpen ? 'Cancel' : 'Loan out'}"));
  assert.ok(collectiblesViewSource.includes('DrawerMetadataList'));
  assert.ok(collectiblesViewSource.includes('buildObjectDrawerMetadataRecords({'));
  assert.ok(collectiblesViewSource.includes('buildObjectDrawerMetadataEditorNodes({'));
  assert.ok(collectiblesViewSource.includes('ownerType: \'collectible\''));
  assert.ok(collectiblesViewSource.includes('const drawerMetadataItems = buildDrawerMetadataRenderItems(drawerMetadataRecords, drawerMetadataNodes);'));
  assert.ok(collectiblesViewSource.includes('<DrawerMetadataList items={drawerMetadataItems} />'));
  assert.ok(collectiblesViewSource.includes('<DetailField label="Classification">{itemTypeLabel}</DetailField>'));
  assert.ok(artViewSource.includes('DrawerMetadataList'));
  assert.ok(artViewSource.includes('buildObjectDrawerMetadataRecords({'));
  assert.ok(artViewSource.includes('buildObjectDrawerMetadataEditorNodes({'));
  assert.ok(artViewSource.includes('ownerType: \'art\''));
  assert.ok(artViewSource.includes('const drawerMetadataItems = buildDrawerMetadataRenderItems(drawerMetadataRecords, drawerMetadataNodes);'));
  assert.ok(artViewSource.includes('<DrawerMetadataList items={drawerMetadataItems} />'));
  assert.ok(artViewSource.includes('<DetailField label="Signature proof">'));
  assert.ok(artViewSource.includes('<CompactDetailRow label="Proof">'));
}));

results.push(run('drawer metadata registry builders order and adapt by context', () => {
  const {
    DRAWER_METADATA_IDS,
    DRAWER_METADATA_REGISTRY,
    buildDrawerMetadata,
    buildDrawerMetadataItems,
    buildObjectDrawerMetadataRecords,
    getDrawerMetadataRegistryEntry
  } = drawerMetadataModule;

  assert.strictEqual(getDrawerMetadataRegistryEntry(DRAWER_METADATA_IDS.edition), DRAWER_METADATA_REGISTRY.edition);
  assert.strictEqual(DRAWER_METADATA_REGISTRY.edition.form, 'edition_variant');
  assert.strictEqual(DRAWER_METADATA_REGISTRY.edition.displayPriority, 20);
  assert.strictEqual(DRAWER_METADATA_REGISTRY.loan.form, 'loan');
  assert.strictEqual(DRAWER_METADATA_REGISTRY.loan.displayPriority, 60);
  assert.strictEqual(buildDrawerMetadata('missing'), null);

  const edition = buildDrawerMetadata(DRAWER_METADATA_IDS.edition, {
    mediaType: 'comic_book',
    trait: {
      summary: 'Issue 21',
      details: [
        { label: 'Edition', value: 'Issue 21' },
        { label: 'Empty', value: '' }
      ]
    }
  });
  assert.strictEqual(edition.id, 'edition');
  assert.strictEqual(edition.label, 'Comic edition');
  assert.strictEqual(edition.form, 'edition_variant');
  assert.strictEqual(edition.summary, 'Issue 21');
  assert.strictEqual(edition.details, 'Edition: Issue 21');

  const condition = buildDrawerMetadata(DRAWER_METADATA_IDS.grading, {
    mediaType: 'audio',
    ownerType: 'media',
    trait: {
      summary: 'NM',
      details: [{ label: 'Authority', value: 'Seller' }]
    }
  });
  assert.strictEqual(condition.id, 'condition');
  assert.strictEqual(condition.label, 'Condition');
  assert.strictEqual(condition.copy.gradePlaceholder, 'VG+ / NM');

  const authentication = buildDrawerMetadata(DRAWER_METADATA_IDS.grading, {
    ownerType: 'art',
    trait: { summary: 'Authenticated' }
  });
  assert.strictEqual(authentication.id, 'authentication');
  assert.strictEqual(authentication.label, 'Authentication');

  const hidden = buildDrawerMetadata(DRAWER_METADATA_IDS.proof, { applies: false });
  assert.strictEqual(hidden.applies, false);

  const records = buildDrawerMetadataItems([
    DRAWER_METADATA_IDS.related,
    {
      id: DRAWER_METADATA_IDS.proof,
      context: { trait: { summary: 'COA' } }
    },
    {
      id: DRAWER_METADATA_IDS.grading,
      context: { mediaType: 'game', trait: { summary: '9.8' } }
    },
    'missing',
    {
      id: DRAWER_METADATA_IDS.edition,
      context: { mediaType: 'book', trait: { summary: 'First edition' } }
    },
    {
      id: DRAWER_METADATA_IDS.loan,
      context: { applies: false }
    }
  ]);
  assert.deepStrictEqual(records.map((record) => record.id), [
    DRAWER_METADATA_IDS.edition,
    DRAWER_METADATA_IDS.grading,
    DRAWER_METADATA_IDS.proof,
    DRAWER_METADATA_IDS.related
  ]);
  assert.deepStrictEqual(records.map((record) => record.metadata.displayPriority), [20, 30, 40, 50]);
  assert.strictEqual(records[0].metadata.label, 'Book edition');
  assert.strictEqual(records[1].metadata.label, 'Grading');
  assert.strictEqual(records[2].metadata.summary, 'COA');
  assert.strictEqual(records[3].metadata.emptyLabel, 'Add');

  const mediaRecords = buildObjectDrawerMetadataRecords({
    traits: [
      { family: 'edition_variant', summary: 'SteelBook' },
      { family: 'graded', summary: 'Near mint' },
      { family: 'provenance', summary: 'Receipt' }
    ],
    ownerType: 'media',
    mediaType: 'movie',
    includeEdition: true
  });
  assert.deepStrictEqual(Array.from(mediaRecords, (record) => record.id), [
    DRAWER_METADATA_IDS.edition,
    DRAWER_METADATA_IDS.grading,
    DRAWER_METADATA_IDS.proof,
    DRAWER_METADATA_IDS.related
  ]);
  assert.strictEqual(mediaRecords[0].metadata.summary, 'SteelBook');
  assert.strictEqual(mediaRecords[1].metadata.label, 'Condition');
  assert.strictEqual(mediaRecords[2].metadata.summary, 'Receipt');

  const artRecords = buildObjectDrawerMetadataRecords({
    traits: [{ family: 'graded', summary: 'Authenticated' }],
    ownerType: 'art'
  });
  assert.deepStrictEqual(Array.from(artRecords, (record) => record.id), [
    DRAWER_METADATA_IDS.grading,
    DRAWER_METADATA_IDS.proof,
    DRAWER_METADATA_IDS.related
  ]);
  assert.strictEqual(artRecords[0].metadata.label, 'Authentication');
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
  assert.ok(localReleaseGateSource.includes('test:browser:core'));
  assert.ok(releasePreflightLocalSource.includes('Image security and SBOM'));
  assert.ok(releasePreflightLocalSource.includes('test:integration-smoke'));
  assert.ok(releasePreflightLocalSource.includes('/api/auth/csrf-token'));
  assert.ok(releasePreflightLocalSource.includes('/api/auth/me'));
  assert.ok(releasePreflightLocalSource.includes('npm audit'));
}));

results.push(run('repo includes local CI/CD release gate and opt-in pre-push hook tooling', () => {
  assert.strictEqual(rootPackageJson.scripts['release:local-gate'], 'node scripts/local-release-gate.js');
  assert.strictEqual(rootPackageJson.scripts['release:local-gate:full'], 'node scripts/local-release-gate.js --profile=full');
  assert.strictEqual(rootPackageJson.scripts['release:install-hooks'], 'node scripts/install-local-git-hooks.js');
  assert.strictEqual(rootPackageJson.scripts['test:runtime-smoke:local'], 'npm run test:runtime-smoke:core');
  assert.strictEqual(rootPackageJson.scripts['test:runtime-smoke:core'], 'node scripts/local-runtime-smoke.js');
  assert.strictEqual(rootPackageJson.scripts['test:runtime-smoke:platform'], 'node scripts/local-runtime-smoke.js --platform-only');
  assert.strictEqual(rootPackageJson.scripts['test:edition-boundaries:local'], 'node scripts/local-runtime-smoke.js --include-platform');
  assert.ok(localReleaseGateSource.includes("profile: 'standard'"));
  assert.ok(localReleaseGateSource.includes("profile: 'full'"));
  assert.ok(localReleaseGateSource.includes("artifacts', 'local-ci'"));
  assert.ok(localReleaseGateSource.includes('local-release-gate.json'));
  assert.ok(localReleaseGateSource.includes('local-release-gate.md'));
  assert.ok(localReleaseGateSource.includes('test:release-preflight-local'));
  assert.ok(localReleaseGateSource.includes('collectz-maintained-source.qls'));
  assert.ok(localReleaseGateSource.includes('gitleaks'));
  assert.ok(localReleaseGateSource.includes('test:runtime-smoke:local'));
  assert.ok(localReleaseGateSource.includes('PLAYWRIGHT_E2E_BYPASS_TOKEN'));
  assert.ok(localReleaseGateSource.includes('trivy'));
  assert.ok(localReleaseGateSource.includes('redacts common secret-bearing output patterns'));
  assert.ok(localRuntimeSmokeSource.includes('collectz-local-runtime-'));
  assert.ok(localRuntimeSmokeSource.includes('docker-compose.build.yml'));
  assert.ok(localRuntimeSmokeSource.includes('docker-compose.platform.yml'));
  assert.ok(localRuntimeSmokeSource.includes('test:core-runtime-smoke'));
  assert.ok(localRuntimeSmokeSource.includes('test:control-plane-runtime-smoke'));
  assert.ok(localRuntimeSmokeSource.includes('--include-platform'));
  assert.ok(localRuntimeSmokeSource.includes('--platform-only'));
  assert.ok(localGitHooksInstallerSource.includes('collectZ managed local release gate hook'));
  assert.ok(localGitHooksInstallerSource.includes('COLLECTZ_SKIP_LOCAL_GATE'));
  assert.ok(localGitHooksInstallerSource.includes('npm run release:local-gate'));
  assert.ok(localGitHooksInstallerSource.includes('--force'));
  assert.ok(localGitHooksInstallerSource.includes("fs.openSync(hookPath, 'wx'"));
  assert.ok(localGitHooksInstallerSource.includes('writeHookAtomically'));
  assert.ok(localGitHooksInstallerSource.includes('fs.renameSync(tempPath, hookPath)'));
  assert.ok(!localGitHooksInstallerSource.includes('codeql[js/file-system-race]'));
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
  assert.ok(mediaRoutesSource.includes('function unwrapShortLookupTitleDescriptors'));
  assert.ok(mediaRoutesSource.includes('function removeLookupTitleSequenceDescriptors'));
  assert.ok(mediaRoutesSource.includes('LOOKUP_TITLE_SEQUENCE_WORDS'));
  assert.ok(mediaRoutesSource.includes("const closeChar = char === '[' ? ']' : char === '(' ? ')' : '';"));
  assert.ok(mediaRoutesSource.includes('descriptorLength > 80'));
  assert.ok(mediaRoutesSource.includes('isLookupTitleSequenceValue(tokens[index + 2])'));
  assert.ok(mediaRoutesSource.includes('tmdb:title_variant_hit'));
  assert.ok(mediaRoutesSource.includes('lookupTitleCandidates'));
  assert.ok(mediaRoutesSource.includes('tmdbPosterLookupNoMatch'));
  assert.ok(mediaRoutesSource.includes('tmdbPosterLookupNoImage'));
  assert.ok(mediaRoutesSource.includes('trailingArticleSwap'));
  assert.ok(mediaRoutesSource.includes('bracketStripped'));
}));

results.push(run('media library search matches stored identifiers and guards empty digit matches', () => {
  assert.ok(mediaRoutesSource.includes("OR COALESCE(upc, '') ILIKE"));
  assert.ok(mediaRoutesSource.includes('OR tmdb_id::text ='));
  assert.ok(mediaRoutesSource.includes("COALESCE(type_details->>'provider_item_id', '') ILIKE"));
  assert.ok(mediaRoutesSource.includes("COALESCE(type_details->>'provider_issue_id', '') ILIKE"));
  assert.ok(mediaRoutesSource.includes("COALESCE(type_details->>'calibre_entry_id', '') ILIKE"));
  assert.ok(mediaRoutesSource.includes('mm."key" IN ('));
  assert.ok(mediaRoutesSource.includes("'plex_rating_key'"));
  assert.ok(mediaRoutesSource.includes("regexp_replace($${likeIdx}, '\\\\D+', '', 'g') <> ''"));
  assert.ok(mediaRoutesSource.includes("ILIKE ('%' || regexp_replace($${likeIdx}, '\\\\D+', '', 'g') || '%')"));
}));

results.push(run('LibraryView advertises identifier-aware library search', () => {
  assert.ok(libraryViewSource.includes('searchPlaceholder="Search title, creator, or identifier…"'));
}));

results.push(run('LibraryView supports browser-local saved library views by media type', () => {
  assert.ok(libraryViewSource.includes("const SAVED_LIBRARY_VIEWS_STORAGE_KEY = 'collectz_library_saved_views_v1';"));
  assert.ok(libraryViewSource.includes('function normalizeSavedLibraryViewRecord(record, scope)'));
  assert.ok(libraryViewSource.includes('function readSavedLibraryViews(scope)'));
  assert.ok(libraryViewSource.includes('function writeSavedLibraryViews(scope, scopedViews)'));
  assert.ok(libraryViewSource.includes("const savedViewScope = libraryViewScope(forcedMediaType || 'movie');"));
  assert.ok(libraryViewSource.includes('aria-label="Saved library views"'));
  assert.ok(libraryViewSource.includes('const hasSavedViewFilterControls ='));
  assert.ok(libraryViewSource.includes('Save current view'));
  assert.ok(libraryViewSource.includes('savedViewDialogMode'));
  assert.ok(!libraryViewSource.includes('Name this saved view'));
  assert.ok(libraryViewSource.includes('saveCurrentLibraryView'));
  assert.ok(libraryViewSource.includes('deleteActiveSavedLibraryView'));
}));

results.push(run('library saved views persist through scoped backend endpoints', () => {
  assert.ok(migrationsSource.includes('version: 110'));
  assert.ok(migrationsSource.includes("description: 'Add saved library views'"));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS saved_library_views'));
  assert.ok(migrationsSource.includes('idx_saved_library_views_owner_scope'));
  assert.ok(validateSource.includes('savedLibraryViewCreateSchema'));
  assert.ok(validateSource.includes('savedLibraryViewUpdateSchema'));
  assert.ok(librariesRoutesSource.includes("router.get('/libraries/saved-views'"));
  assert.ok(librariesRoutesSource.includes("router.post('/libraries/saved-views'"));
  assert.ok(librariesRoutesSource.includes("router.put('/libraries/saved-views/:id'"));
  assert.ok(librariesRoutesSource.includes("router.delete('/libraries/saved-views/:id'"));
  assert.ok(openApiSource.includes('"/api/libraries/saved-views"'));
  assert.ok(openApiSource.includes('"/api/libraries/saved-views/{id}"'));
  assert.ok(librariesRoutesSource.includes('owner_user_id = $'));
  assert.ok(librariesRoutesSource.includes('appendScopeSql(params, scopeContext)'));
  assert.ok(libraryViewSource.includes("apiCall('get', `/libraries/saved-views?media_type=${encodeURIComponent(savedViewScope)}`)"));
  assert.ok(libraryViewSource.includes("apiCall('post', '/libraries/saved-views', payload)"));
  assert.ok(libraryViewSource.includes("apiCall('delete', `/libraries/saved-views/${current.id}`)"));
  assert.ok(libraryViewSource.includes("setSavedViewsStorageMode('local')"));
}));

results.push(run('library saved views have a dashboard navigation entry point', () => {
  assert.ok(dashboardRoutingSource.includes("'library-saved-views'"));
  assert.ok(productEditionFrontendSource.includes("'library-saved-views'"));
  assert.ok(sidebarNavSource.includes('id="library-saved-views"'));
  assert.ok(sidebarNavSource.includes('label="Saved Views"'));
  assert.ok(dashboardShellSource.includes("'library-saved-views': 'Saved Views'"));
  assert.ok(dashboardContentSource.includes('function SavedLibraryViewsView('));
  assert.ok(dashboardContentSource.includes("apiCall('get', '/libraries/saved-views')"));
  assert.ok(dashboardContentSource.includes('setPendingLibrarySavedViewId'));
  assert.ok(dashboardContentSource.includes('initialSavedViewId={pendingLibrarySavedViewId}'));
  assert.ok(libraryViewSource.includes('initialSavedViewId = \'\''));
  assert.ok(libraryViewSource.includes('onSavedViewApplied?.(selected)'));
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

results.push(run('deliciousNormalize uses longest platform aliases for title suffixes', () => {
  const out = normalizeDeliciousRow({
    title: 'Halo Infinite - Xbox Series X',
    'item type': 'VideoGame'
  });
  assert.strictEqual(out.normalizedTitle, 'Halo Infinite');
  assert.strictEqual(out.normalizedPlatform, 'Xbox Series X');
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
    track_count: '26',
    compilation: 'true',
    track_artists: ' Aimee Mann, Elliott Smith '
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, []);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.value, {
    artist: 'Pink Floyd',
    album: 'The Wall',
    track_count: 26,
    compilation: true,
    track_artists: 'Aimee Mann, Elliott Smith'
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

results.push(run('typeDetails keeps Kavita provider detail fields for digital library imports', () => {
  const out = normalizeTypeDetails('comic_book', {
    provider_name: 'kavita',
    provider_item_id: 'kavita:series:8602',
    provider_external_url: 'https://kavita.example/library/87/series/8602',
    kavita_library_id: 87,
    kavita_library_name: 'Sequential Shelf',
    kavita_library_type: 'comic',
    kavita_series_id: 8602,
    kavita_series_name: 'Metadata Smoke Issue',
    kavita_localized_name: 'Metadata Smoke Issue',
    kavita_original_name: 'Metadata Smoke Issue Original',
    kavita_sort_name: 'Metadata Smoke Issue 001',
    kavita_format: 1,
    kavita_pages: 24,
    kavita_cover_image: '/api/image/series-cover?seriesId=8602',
    kavita_cover_url: 'https://kavita.example/api/image/series-cover?seriesId=8602',
    kavita_cover_proxy_url: '/api/media/kavita-cover/8602',
    kavita_cover_source: 'collectz_proxy',
    kavita_cover_status: 'proxied',
    kavita_series_url: 'https://kavita.example/library/87/series/8602',
    kavita_launch_url: 'https://kavita.example/library/87/series/8602/manga/9702',
    kavita_launch_label: 'Read in Kavita',
    kavita_launch_target: 'first_chapter_reader',
    kavita_volume_detail_status: 'loaded',
    kavita_volume_count: 1,
    kavita_chapter_count: 1,
    kavita_volume_numbers: '1',
    kavita_first_volume_number: '1',
    kavita_first_chapter_id: 9702,
    kavita_first_chapter_number: '1',
    kavita_first_chapter_title: 'Metadata Smoke Issue #1',
    kavita_first_chapter_release_date: '2023-03-04',
    kavita_first_chapter_pages: 24,
    kavita_chapter_titles: 'Metadata Smoke Issue #1',
    kavita_chapter_pages_total: 24,
    kavita_chapter_fanout: 'true',
    kavita_chapter_id: 9702,
    kavita_volume_id: 9602,
    kavita_chapter_number: '1',
    kavita_chapter_title: 'Metadata Smoke Issue #1',
    kavita_chapter_release_date: '2023-03-04',
    kavita_chapter_pages: 24,
    kavita_parent_provider_item_id: 'kavita:series:8602',
    kavita_series_provider_item_id: 'kavita:series:8602',
    kavita_chapter_provider_item_id: 'kavita:chapter:9702',
    source_updated_at: '2026-05-03T00:00:00Z'
  }, { strict: true });
  assert.deepStrictEqual(out.invalidKeys, []);
  assert.deepStrictEqual(out.errors, []);
  assert.strictEqual(out.value.kavita_library_id, '87');
  assert.strictEqual(out.value.kavita_library_type, 'comic');
  assert.strictEqual(out.value.kavita_series_id, '8602');
  assert.strictEqual(out.value.kavita_pages, '24');
  assert.strictEqual(out.value.kavita_cover_image, '/api/image/series-cover?seriesId=8602');
  assert.strictEqual(out.value.kavita_cover_url, 'https://kavita.example/api/image/series-cover?seriesId=8602');
  assert.strictEqual(out.value.kavita_cover_proxy_url, '/api/media/kavita-cover/8602');
  assert.strictEqual(out.value.kavita_cover_source, 'collectz_proxy');
  assert.strictEqual(out.value.kavita_cover_status, 'proxied');
  assert.strictEqual(out.value.kavita_series_url, 'https://kavita.example/library/87/series/8602');
  assert.strictEqual(out.value.kavita_launch_url, 'https://kavita.example/library/87/series/8602/manga/9702');
  assert.strictEqual(out.value.kavita_launch_label, 'Read in Kavita');
  assert.strictEqual(out.value.kavita_launch_target, 'first_chapter_reader');
  assert.strictEqual(out.value.kavita_volume_detail_status, 'loaded');
  assert.strictEqual(out.value.kavita_volume_count, '1');
  assert.strictEqual(out.value.kavita_chapter_count, '1');
  assert.strictEqual(out.value.kavita_first_chapter_id, '9702');
  assert.strictEqual(out.value.kavita_first_chapter_title, 'Metadata Smoke Issue #1');
  assert.strictEqual(out.value.kavita_chapter_pages_total, '24');
  assert.strictEqual(out.value.kavita_chapter_fanout, 'true');
  assert.strictEqual(out.value.kavita_chapter_id, '9702');
  assert.strictEqual(out.value.kavita_volume_id, '9602');
  assert.strictEqual(out.value.kavita_chapter_provider_item_id, 'kavita:chapter:9702');
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

results.push(run('log field sanitizers remove line breaks before console output', () => {
  const webhookCredential = ['czpw', 'fixture'].join('_');
  const queryCredential = ['czpw', 'other'].join('_');
  assert.strictEqual(sanitizeAuditLogField('first\nsecond\tthird'), 'firstsecond third');
  assert.strictEqual(sanitizeRequestLogField('GET\r\nX-Injected: yes'), 'GETX-Injected: yes');
  assert.strictEqual(
    sanitizeRequestUrl(`/api/plex/webhooks/${webhookCredential}\nnext?${'token'}=${queryCredential}`),
    '/api/plex/webhooks/[REDACTED]?token=[REDACTED]'
  );
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
    kavitaBaseUrl: 'https://kavita.example',
    kavitaApiKey: 'kavita-secret',
    kavitaTimeoutMs: 20000,
    decryptWarnings: []
  });

  assert.strictEqual(response.barcodeApiKeySet, true);
  assert.strictEqual(response.gamesClientSecretSet, true);
  assert.strictEqual(response.cwaPasswordSet, true);
  assert.strictEqual(response.kavitaApiKeySet, true);
  assert.ok(response.barcodeApiKeyMasked);
  assert.ok(response.gamesClientSecretMasked);
  assert.ok(response.cwaPasswordMasked);
  assert.ok(response.kavitaApiKeyMasked);
  assert.notStrictEqual(response.barcodeApiKeyMasked, 'barcode-secret');
  assert.notStrictEqual(response.gamesClientSecretMasked, 'games-client-secret');
  assert.notStrictEqual(response.cwaPasswordMasked, 'cwa-secret');
  assert.notStrictEqual(response.kavitaApiKeyMasked, 'kavita-secret');
  assert.strictEqual('barcodeApiKey' in response, false);
  assert.strictEqual('gamesClientSecret' in response, false);
  assert.strictEqual('cwaPassword' in response, false);
  assert.strictEqual('kavitaApiKey' in response, false);
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
      if (new URL(String(url)).hostname === 'www.pricecharting.com') {
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

results.push(run('collectible trait readback derives shared trait summaries and merges persisted traits', () => {
  assert.strictEqual(formatNumberedValue(150, 200), '#150/200');
  const traits = buildCollectibleTraits({
    row: {
      media_type: 'book',
      signed_by: 'Author Name',
      signed_role: 'author',
      signed_on: '2026-06-01',
      print_number: 12,
      print_run: 100,
      event_title: 'San Diego ComicCon 2026',
      vendor: 'Booth Vendor',
      exclusive: true,
      type_details: { edition: 'Limited hardcover' }
    },
    signatures: [
      {
        signer_name: 'Author Name',
        signer_role: 'Author',
        signed_on: '2026-06-01',
        proof_path: '/uploads/signature.jpg',
        is_primary: true,
        proofs: [{ proof_type: 'coa', label: 'COA', proof_path: '/uploads/coa.jpg' }]
      }
    ]
  });
  assert.deepStrictEqual(traits.map((trait) => trait.family), ['signed', 'numbered', 'certificate', 'event_acquired', 'edition_variant']);
  assert.ok(traits.find((trait) => trait.key === 'signed')?.summary.includes('Author Name'));
  assert.ok(traits.find((trait) => trait.key === 'numbered_limited')?.summary.includes('#12/100'));
  const persistedTraits = buildCollectibleTraits({
    row: {
      signed_by: 'Derived Signer',
      persisted_collectible_traits: [
        {
          trait_key: 'signed',
          family: 'signed',
          label: 'Signed',
          summary: 'Stored signed readback',
          tone: 'brand',
          details: [{ label: 'Signer', value: 'Persisted Signer' }]
        },
        {
          trait_key: 'graded',
          family: 'graded',
          label: 'Graded',
          summary: 'CGC 9.8',
          tone: 'brand',
          details: [{ label: 'Grade', value: '9.8' }]
        }
      ]
    }
  });
  assert.strictEqual(persistedTraits.find((trait) => trait.key === 'signed')?.summary, 'Stored signed readback');
  assert.ok(persistedTraits.find((trait) => trait.key === 'graded'));
  assert.ok(collectibleTraitsSource.includes('buildCollectibleTraits'));
  assert.ok(collectibleTraitsSource.includes('buildEventAcquiredTrait'));
  assert.ok(collectibleTraitsSource.includes('mergeCollectibleTraits'));
  assert.ok(mediaRoutesSource.includes('collectible_traits: buildCollectibleTraits'));
  assert.ok(mediaRoutesSource.includes('attachPersistedTraitsToMediaRows'));
  assert.ok(collectiblesRoutesSource.includes('collectible_traits: buildCollectibleTraits'));
  assert.ok(collectiblesRoutesSource.includes('attachPersistedTraitsToCollectibleRows'));
  assert.ok(libraryViewSource.includes('CollectibleTraitReadback'));
  assert.ok(artViewSource.includes('CollectibleTraitPills'));
  assert.ok(collectibleCardSource.includes('CollectibleTraitPills'));
  assert.ok(collectibleRowSource.includes('CollectibleTraitPills'));
}));

results.push(run('collectible trait persistence contract is scoped and documented', () => {
  const normalized = normalizeTraitPayload({
    key: 'CGC Grade',
    family: 'graded',
    label: 'Graded',
    summary: 'CGC 9.8',
    tone: 'brand',
    details: [{ label: 'Certificate', value: '12345' }],
    payload: { company: 'CGC', grade: '9.8' }
  });
  assert.strictEqual(normalized.trait_key, 'cgc_grade');
  assert.strictEqual(normalizeTraitPayload({
    key: '  ** CGC Grade / Signed! ',
    family: 'signed'
  }).trait_key, 'cgc_grade_signed');
  assert.strictEqual(normalized.family, 'graded');
  assert.strictEqual(normalized.details[0].label, 'Certificate');
  assert.ok(collectibleTraitRecordsSource.includes('function trimBoundaryChar'));
  assert.ok(!collectibleTraitRecordsSource.includes("replace(/[^a-z0-9_:-]+/g, '_'"));
  assert.ok(migrationsSource.includes('version: 107'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS collectible_trait_records'));
  assert.ok(migrationsSource.includes("owner_type VARCHAR(30) NOT NULL CHECK (owner_type IN ('media', 'art', 'collectible'))"));
  assert.ok(collectibleTraitRecordsSource.includes('resolveTraitOwner'));
  assert.ok(collectibleTraitRecordsSource.includes('upsertTraitRecord'));
  assert.ok(collectibleTraitRecordsSource.includes('archiveTraitRecord'));
  assert.ok(collectibleTraitsRoutesSource.includes("router.use('/collectible-traits', authenticateToken);"));
  assert.ok(collectibleTraitsRoutesSource.includes("router.put('/collectible-traits/:ownerType/:ownerId', upsertTraitHandler);"));
  assert.ok(collectibleTraitsRoutesSource.includes("router.put('/collectible-traits/:ownerType/:ownerId/:traitKey', upsertTraitHandler);"));
  assert.ok(serverSource.includes("const collectibleTraitsRouter = require('./routes/collectibleTraits');"));
  assert.ok(serverSource.includes("app.use('/api', collectibleTraitsRouter);"));
  assert.ok(personalAccessTokenSource.includes("path.startsWith('/api/collectible-traits')"));
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
  assert.ok(spec.paths['/api/support/releases']);
  assert.ok(!spec.paths['/api/support/requests']);
  assert.ok(!spec.paths['/api/support/requests/{id}']);
  assert.ok(!spec.paths['/api/support/requests/{id}/messages']);
  assert.ok(!spec.paths['/api/support/requests/{id}/status']);
  assert.ok(!spec.paths['/api/support/requests/{id}/access']);
  assert.ok(!spec.paths['/api/support/requests/{id}/triage']);
  assert.ok(!spec.paths['/api/support/staff/summary']);
  assert.ok(!spec.paths['/api/admin/spaces']);
  assert.ok(!spec.paths['/api/admin/spaces/create-with-onboarding']);
  assert.ok(!spec.paths['/api/admin/spaces/{id}']);
  assert.ok(!spec.paths['/api/admin/spaces/{id}/members']);
  assert.ok(!spec.paths['/api/admin/spaces/{id}/invites']);
  assert.ok(!spec.paths['/api/admin/users']);
  assert.ok(!spec.paths['/api/admin/users/{id}']);
  assert.ok(!spec.paths['/api/admin/users/{id}/summary']);
  assert.ok(!spec.paths['/api/admin/users/{id}/role']);
  assert.ok(!spec.paths['/api/admin/users/{id}/password-reset']);
  assert.ok(!spec.paths['/api/admin/settings/email-delivery']);
  assert.ok(!spec.paths['/api/admin/settings/email-delivery/test']);
  assert.ok(!spec.paths['/api/admin/settings/integrations/test-pricecharting']);
  assert.ok(!spec.paths['/api/admin/settings/integrations/test-ebay']);
  assert.ok(!spec.paths['/api/admin/settings/integrations/test-logs']);
  assert.ok(!spec.paths['/api/admin/activity']);
  assert.ok(!spec.paths['/api/admin/loan-reminder-operations']);
  assert.ok(spec.paths['/api/auth/personal-access-tokens']);
  assert.ok(spec.paths['/api/auth/service-account-keys']);
  assert.ok(spec.components.schemas.LoanReminderOperationsResponse);
  assert.ok(spec.components.schemas.CollectibleTrait);
  assert.ok(spec.components.schemas.CollectibleTraitRecord);
  assert.ok(spec.components.schemas.CollectibleTraitUpsertRequest);
  assert.ok(spec.paths['/api/collectible-traits/{ownerType}/{ownerId}']);
  assert.ok(spec.paths['/api/collectible-traits/{ownerType}/{ownerId}/{traitKey}']);
  assert.ok(spec.components.schemas.MediaListResponse.properties.items.items.properties.collectible_traits);
  assert.ok(spec.components.schemas.ArtRecord.properties.collectible_traits);
  assert.ok(spec.components.schemas.NativeArtRecord.properties.collectible_traits);
  assert.ok(spec.components.schemas.AutomaticLoanReminderRunRecord);
  assert.ok(spec.components.schemas.AutomaticLoanReminderFailureRecord);
  assert.ok(!spec.paths['/api/admin/invites']);
  assert.ok(!spec.paths['/api/docs']);
  assert.ok(!spec.paths['/api/docs/openapi.json']);
  assert.ok(!spec.paths['/api/metrics']);
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
  assert.ok(spec.components.schemas.QueuedJobResponse);
  assert.ok(!spec.components.schemas.SupportRequestTriageUpdateRequest);
  assert.ok(!spec.components.schemas.SupportRequestMutationResponse);
  assert.ok(!spec.components.schemas.AdminSpaceRecord);
  assert.ok(!spec.components.schemas.AdminSpaceCreateWithOnboardingRequest);
  assert.ok(spec.components.schemas.SupportReleaseFeedResponse);
  assert.ok(spec.components.schemas.MediaLoanRecord);
  assert.ok(spec.components.schemas.MediaLoanListResponse);
}));

results.push(run('platform docs and metrics routes are no longer mounted in collectZ Core', () => {
  assert.ok(!serverSource.includes("const docsRouter = require('./routes/docs');"));
  assert.ok(!serverSource.includes("const metricsRouter = require('./routes/metrics');"));
  assert.ok(!fs.existsSync(path.resolve(__dirname, '..', 'routes', 'docs.js')));
  assert.ok(!fs.existsSync(path.resolve(__dirname, '..', 'routes', 'metrics.js')));
  assert.ok(!openApiSource.includes('"/api/docs"'));
  assert.ok(!openApiSource.includes('"/api/docs/openapi.json"'));
  assert.ok(!openApiSource.includes('"/api/metrics"'));
  assert.ok(!openApiSource.includes('"MetricsText"'));
}));

results.push(run('auth route source exposes admin-only Core API key management', () => {
  assert.ok(authRoutesSource.includes("router.get('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("router.post('/service-account-keys'"));
  assert.ok(authRoutesSource.includes("router.delete('/service-account-keys/:id'"));
  assert.ok(!authRoutesSource.includes("platformRouter.get('/service-account-keys'"));
  assert.ok(!authRoutesSource.includes("platformRouter.post('/service-account-keys'"));
  assert.ok(!authRoutesSource.includes("platformRouter.delete('/service-account-keys/:id'"));
  assert.ok(authRoutesSource.includes("requireRole('admin')"));
}));

results.push(run('rbac regression source bootstraps Core scope without platform invite routes', () => {
  const rbacRegressionSource = require('fs').readFileSync(require.resolve('./rbac-regression-check'), 'utf8');
  assert.ok(rbacRegressionSource.includes('createDirectCoreScope'));
  assert.ok(rbacRegressionSource.includes('setDirectActiveLibrary'));
  assert.ok(!rbacRegressionSource.includes('expose_token: true'));
  assert.ok(!rbacRegressionSource.includes('/api/spaces/${targetSpaceId}/invites'));
  assert.ok(!rbacRegressionSource.includes('/api/admin/spaces'));
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

results.push(run('csrf.csrfProtection accepts matching default csrf cookie and header tokens', () => {
  let nextCalled = false;
  const req = {
    method: 'PATCH',
    originalUrl: '/api/media/1',
    cookies: {
      session_token: 'cookie-token',
      csrf_token: 'csrf-token'
    },
    headers: {},
    get: (name) => (String(name).toLowerCase() === 'x-csrf-token' ? 'csrf-token' : '')
  };
  const res = {
    status() {
      throw new Error('Expected matching CSRF token to call next');
    }
  };
  csrfProtection(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
}));

results.push(run('csrf.csrfProtection rejects missing csrf header for cookie-session writes', () => {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const req = {
    method: 'PATCH',
    originalUrl: '/api/media/1',
    cookies: {
      session_token: 'cookie-token',
      csrf_token: 'csrf-token'
    },
    headers: {},
    get: () => ''
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };
  csrfProtection(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(statusCode, 403);
  assert.deepStrictEqual(body, { error: 'CSRF validation failed' });
}));

results.push(run('public compose source keeps homelab-safe cookie defaults in the single tracked stack', () => {
  assert.ok(!dockerComposeSource.includes('SESSION_COOKIE_NAME'));
  assert.ok(!dockerComposeSource.includes('CSRF_COOKIE_NAME'));
  assert.ok(!dockerComposeSource.includes('session_token_homelab'));
  assert.ok(!dockerComposeSource.includes('csrf_token_homelab'));
  assert.ok(frontendDockerfileSource.includes('ARG VITE_CSRF_COOKIE_NAME=csrf_token'));
  assert.ok(!frontendDockerfileSource.includes('ARG VITE_PLATFORM_API_URL='));
  assert.ok(!frontendDockerfileSource.includes('REACT_APP_CSRF_COOKIE_NAME'));
  assert.ok(frontendDockerfileSource.includes('COPY docker-entrypoint.d/40-runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh'));
  assert.ok(frontendEnvSource.includes('window.__COLLECTZ_RUNTIME_CONFIG__'));
  assert.ok(frontendViteIndexHtmlSource.includes('src="/runtime-env.js"'));
  assert.ok(frontendViteIndexHtmlSource.indexOf('src="/runtime-env.js"') < frontendViteIndexHtmlSource.indexOf('src="/src/main.jsx"'));
  assert.ok(useApiClientSource.includes("readFrontendEnv('VITE_CSRF_COOKIE_NAME', 'csrf_token')"));
  assert.ok(!useApiClientSource.includes("VITE_PLATFORM_API_URL"));
  assert.ok(!useApiClientSource.includes('isPlatformOwnedPath'));
  assert.ok(!frontendAppSource.includes("VITE_PLATFORM_API_URL"));
  assert.ok(!frontendAppSource.includes("space?.external_workspace_id || space?.id"));
  assert.ok(!helpViewSource.includes('supportAccessEnabled'));
  assert.ok(!helpViewSource.includes('/support/requests'));
  assert.ok(!dashboardContentSource.includes('AdminSpacesView'));
  assert.ok(!dashboardContentSource.includes("apiCall('post', '/admin/spaces', payload)"));
  assert.ok(!dashboardContentSource.includes('/admin/spaces'));
  assert.ok(dashboardRoutingSource.includes('RETIRED_PLATFORM_ROUTES'));
  assert.ok(dashboardRoutingSource.includes("'/platform/workspaces': DEFAULT_TAB"));
  assert.ok(dashboardRoutingSource.includes("'/platform/users': DEFAULT_TAB"));
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
    getRequiredPatScopesForRequest({ originalUrl: '/api/media/lookup/barcode', method: 'POST' }),
    ['media:read']
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

results.push(run('space-owned library feature routes check the active space flag', () => {
  const featureFlagsSource = require('fs').readFileSync(require.resolve('../services/featureFlags'), 'utf8');
  assert.ok(featureFlagsSource.includes('return isFeatureEnabled(key, fallback);'));
  assert.ok(adminRoutesSource.includes("commonRouter.get('/feature-flags'"));
  assert.ok(adminRoutesSource.includes("res.set('Cache-Control', 'no-store');"));
  assert.ok(spacesRoutesSource.includes("router.get('/spaces/:id/feature-flags'"));
  assert.ok(spacesRoutesSource.includes("router.patch('/spaces/:id/feature-flags/:key'"));
  assert.ok(spacesRoutesSource.includes("res.set('Cache-Control', 'no-store');"));
  assert.ok(mediaRoutesSource.includes("router.get('/feature-flags'"));
  assert.ok(mediaRoutesSource.includes("res.set('Cache-Control', 'no-store');"));
  assert.ok(collectiblesRoutesSource.includes('isFeatureEnabledForSpace'));
  assert.ok(collectiblesRoutesSource.includes("scopeContext?.spaceId || null, 'collectibles_enabled'"));
  assert.ok(!collectiblesRoutesSource.includes("isFeatureEnabled('collectibles_enabled'"));
  assert.ok(eventsRoutesSource.includes('isFeatureEnabledForSpace'));
  assert.ok(eventsRoutesSource.includes("scopeContext?.spaceId || null, 'events_enabled'"));
  assert.ok(!eventsRoutesSource.includes("isFeatureEnabled('events_enabled'"));
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

results.push(run('global workspace administration belongs to cairn instead of collectZ OpenAPI', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/spaces'"));
  assert.ok(!openApiSource.includes('"/api/admin/spaces"'));
  assert.ok(!openApiSource.includes('"/api/admin/spaces/create-with-onboarding"'));
  assert.ok(!openApiSource.includes('"/api/admin/spaces/{id}/owner"'));
  assert.ok(!openApiSource.includes('AdminSpaceRecord'));
  assert.ok(!adminRoutesSource.includes("platformRouter.post('/spaces"));
  assert.ok(!adminRoutesSource.includes("platformRouter.patch('/spaces"));
  assert.ok(!adminRoutesSource.includes("platformRouter.delete('/spaces"));
  assert.ok(!adminRoutesSource.includes('UPDATE user_sessions s'));
  assert.ok(!adminRoutesSource.includes('s.support_previous_space_id = $1'));
  assert.ok(!adminRoutesSource.includes('contributionScore'));
}));

results.push(run('library service source ensures default scope before returning default library', () => {
  assert.ok(libraryServiceSource.includes('async function ensureUserDefaultScope'));
  assert.ok(libraryServiceSource.includes('ensureDefaultSpaceForClient'));
  assert.ok(libraryServiceSource.includes('resolvePersistedActiveSpaceId'));
  assert.ok(libraryServiceSource.includes('SET active_space_id = $2,'));
  assert.ok(libraryServiceSource.includes('const activeLibrary = userRow.active_library_id'));
  assert.ok(libraryServiceSource.includes('if (!spaceId && activeLibrary) {'));
  assert.ok(libraryServiceSource.includes('let libraryId = activeLibrary && Number(activeLibrary.space_id || 0) === Number(spaceId)'));
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
  assert.ok(librariesRoutesSource.includes('active_space_id: activeSpaceId ?? (libraries[0]?.space_id || null),'));
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
  assert.strictEqual(frontendPackageJson.scripts.build, 'vite build --configLoader native');
  assert.strictEqual(frontendPackageJson.scripts.preview, 'vite preview --host 0.0.0.0');
  assert.strictEqual(frontendPackageJson.scripts['dev:vite'], undefined);
  assert.strictEqual(frontendPackageJson.scripts['build:vite'], undefined);
  assert.strictEqual(frontendPackageJson.scripts['preview:vite'], undefined);
  assert.strictEqual(frontendPackageJson.scripts['start:cra'], undefined);
  assert.strictEqual(frontendPackageJson.scripts['build:cra'], undefined);
  assert.strictEqual(frontendPackageJson.scripts.test, undefined);
  assert.strictEqual(frontendPackageJson.scripts.eject, undefined);
  assert.deepStrictEqual(Object.keys(frontendPackageJson.overrides || {}), ['follow-redirects']);
  [
    '@eslint/eslintrc',
    '@humanwhocodes/config-array',
    'babel-plugin-istanbul',
    'eslint',
    'eslint-plugin-react',
    'fork-ts-checker-webpack-plugin',
    'react-scripts',
    'rollup-plugin-terser',
    'terser-webpack-plugin'
  ].forEach((overrideName) => {
    assert.strictEqual(frontendPackageJson.overrides?.[overrideName], undefined);
  });
  assert.ok(frontendViteConfigSource.includes('VITE_PROXY_TARGET'));
  assert.ok(!frontendViteConfigSource.includes('REACT_APP_'));
  assert.ok(!frontendViteConfigSource.includes('process.env.REACT_APP_'));
  assert.ok(frontendEnvSource.includes('import.meta.env'));
  assert.ok(frontendEnvSource.includes('viteEnv[viteKey]'));
  assert.ok(!frontendEnvSource.includes('process.env'));
  assert.ok(frontendAppSource.includes("readFrontendEnv('VITE_APP_VERSION'"));
  assert.ok(useApiClientSource.includes("readFrontendEnv('VITE_API_URL', '/api')"));
  assert.ok(frontendViteConfigSource.includes("'/api'"));
  assert.ok(frontendViteConfigSource.includes("'/uploads'"));
  assert.ok(frontendViteConfigSource.includes("outDir: 'dist'"));
  assert.ok(frontendViteIndexHtmlSource.includes('src="/src/main.jsx"'));
  assert.ok(frontendViteIndexHtmlSource.includes('<div id="root"></div>'));
  assert.ok(frontendDockerfileSource.includes('FROM node:24-alpine AS builder'));
  assert.ok(!frontendDockerfileSource.includes('FROM node:20-alpine AS builder'));
  assert.ok(frontendDockerfileSource.includes('ARG VITE_API_URL=/api'));
  assert.ok(!frontendDockerfileSource.includes('ARG VITE_PLATFORM_API_URL='));
  assert.ok(!frontendDockerfileSource.includes('REACT_APP_'));
  assert.ok(frontendDockerfileSource.includes('RUN npm run build'));
  assert.ok(frontendDockerfileSource.includes('COPY --from=builder /app/dist /usr/share/nginx/html'));
}));

results.push(run('dashboard content no longer exposes platform control plane tabs', () => {
  assert.ok(!dashboardContentSource.includes("case 'admin-spaces'"));
  assert.ok(!dashboardContentSource.includes('AdminSpacesView'));
  assert.ok(!dashboardContentSource.includes("case 'admin-users'"));
  assert.ok(!dashboardContentSource.includes('AdminUsersView'));
  assert.ok(!dashboardRoutingSource.includes("'admin-spaces'"));
  assert.ok(!dashboardRoutingSource.includes("'admin-users'"));
}));

results.push(run('dashboard shell exposes merge review as workspace-scoped operator navigation', () => {
  assert.ok(dashboardRoutingSource.includes("'admin-merges'"));
  assert.ok(sidebarNavSource.includes("admin-merges"));
  assert.ok(!sidebarNavSource.includes('showPlatformModeSwitch'));
  assert.ok(!sidebarNavSource.includes('aria-label="Navigation mode"'));
  assert.ok(!sidebarNavSource.includes("isPlatformMode ? 'Workspace' : 'Platform'"));
  assert.ok(!sidebarNavSource.includes('Working in'));
  assert.ok(sidebarNavSource.includes("'admin-settings'"));
  assert.ok(sidebarNavSource.includes("'dashboard'"));
  assert.ok(sidebarNavSource.includes('showWorkspaceNavigation'));
  assert.ok(!sidebarNavSource.includes('showPlatformNavigation'));
  assert.ok(!sidebarNavSource.includes('platformNavigationAllowed'));
  assert.ok(!sidebarNavSource.includes('showPlatformGroup'));
  assert.ok(sidebarNavSource.includes('showWorkspaceHelp'));
  assert.ok(sidebarNavSource.includes('showWorkspaceSettingsLink'));
  assert.ok(sidebarNavSource.includes('showLocalAdminSettingsLink'));
  assert.ok(sidebarNavSource.includes('showLocalAdminIntegrationsLink'));
  assert.ok(sidebarNavSource.includes('showWorkspaceMergeReviewLink'));
  assert.ok(sidebarNavSource.includes('showPlatformHelpAdmin'));
  assert.ok(sidebarNavSource.includes('function NavUnderline'));
  assert.ok(sidebarNavSource.includes('function AccountMenuItem'));
  assert.ok(sidebarNavSource.includes("aria-label={pinnedExpanded ? 'Collapse navigation' : 'Expand navigation'}"));
  assert.ok(sidebarNavSource.includes('aria-expanded={!collapsed}'));
  assert.ok(sidebarNavSource.includes('lg:flex'));
  assert.ok(sidebarNavSource.includes('lg:hidden'));
  assert.ok(sidebarNavSource.includes('{mobileOpen && ('));
  assert.ok(sidebarNavSource.includes('aria-label="Close navigation"'));
  assert.ok(!sidebarNavSource.includes('const showDesktopHamburger'));
  assert.ok(sidebarNavSource.includes('bg-gold'));
  assert.ok(sidebarNavSource.includes('group-hover:opacity-100'));
  assert.ok(sidebarNavSource.includes('focus-visible:ring-0'));
  assert.ok(sidebarNavSource.includes('navStateClass(active)'));
  assert.ok(sidebarNavSource.includes('label="Help"'));
  assert.ok(!sidebarNavSource.includes('label="Help Admin"'));
  assert.ok(sidebarNavSource.includes('label="Review" sub'));
  assert.ok(sidebarNavSource.includes("id=\"admin-merges\""));
  assert.ok(sidebarNavSource.includes("'admin-merges'"));
  assert.ok(sidebarNavSource.includes('{showWorkspaceNavigation && showWorkspaceSettingsLink && ('));
  assert.ok(sidebarNavSource.includes('{showWorkspaceMergeReviewLink && <NavLink id="admin-merges"'));
  assert.ok(!sidebarNavSource.includes('{showPlatformNavigation && showPlatformGroup && ('));
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
  assert.ok(automaticLoanRemindersSmokeSource.includes("crypto.randomBytes(4).toString('hex')"));
  assert.ok(automaticLoanRemindersSmokeSource.includes("crypto.randomBytes(18).toString('base64url')"));
  assert.ok(!automaticLoanRemindersSmokeSource.includes('Math.' + 'random()'));
  assert.ok(!automaticLoanRemindersSmokeSource.includes("const password = '"));
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
  assert.ok(migrationsSource.includes('Add event social vendor booth and location notes'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_attendees'));
  assert.ok(initSqlSource.includes("(84, 'Add event social planning foundation tables')"));
  assert.ok(initSqlSource.includes("(87, 'Add event social vendor booth and location notes')"));
  assert.ok(validateMiddlewareSource.includes('eventAttendeeCreateSchema'));
  assert.ok(validateMiddlewareSource.includes('eventSchedulePlanCreateSchema'));
  assert.ok(validateMiddlewareSource.includes('eventScheduleChangePreviewSchema'));
  assert.ok(validateMiddlewareSource.includes('location_notes'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/attendees'"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/groups'"));
  assert.ok(eventsRoutesSource.includes("router.patch('/events/:id/meetups/:meetupId'"));
  assert.ok(eventsRoutesSource.includes("router.delete('/events/:id/schedule-plans/:planId'"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/schedule-change-preview'"));
  assert.ok(eventsRoutesSource.includes('event-schedule-change-preview.v1'));
  assert.ok(eventsRoutesSource.includes('delivery_supported: false'));
  assert.ok(eventsRoutesSource.includes("'vendor', 'booth', 'location_notes'"));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/companion/today'"));
  assert.ok(eventsRoutesSource.includes('event-social-companion.v1'));
  assert.ok(eventsRoutesSource.includes('EVENT_COMPANION_CACHE_POLICY'));
  assert.ok(eventsRoutesSource.includes('buildPersonalIcsSyncVisibility'));
  assert.ok(eventsRoutesSource.includes('raw_url_returned: false'));
  assert.ok(eventsRoutesSource.includes('event-social-offline-packet.v1'));
  assert.ok(eventsRoutesSource.includes('event-companion-now-next.v1'));
  assert.ok(eventsRoutesSource.includes('event-companion-friend-aware-session-changes.v1'));
  assert.ok(eventsRoutesSource.includes('buildCompanionNowNext'));
  assert.ok(eventsRoutesSource.includes('buildCompanionFriendAwareChanges'));
  assert.ok(eventsRoutesSource.includes('quick_actions_supported: true'));
  assert.ok(eventsRoutesSource.includes('selected_recipient_notifications_supported: true'));
  assert.ok(eventsRoutesSource.includes('catalog_sessions_authoritative: true'));
  assert.ok(eventsRoutesSource.includes('buildOfflinePacket'));
  assert.ok(eventsRoutesSource.includes('schedule_catalog: true'));
  assert.ok(!eventsRoutesSource.includes("'now_next_discovery'"));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/schedule-sessions'"));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/schedule-sessions'"));
  assert.ok(eventsRoutesSource.includes('events.schedule_session.create'));
  assert.ok(eventSocialCompanionContractSource.includes('GET /api/events/:id/companion/today'));
  assert.ok(eventSocialCompanionContractSource.includes('The web app remains the canonical admin and planning surface'));
  assert.ok(eventSocialCompanionContractSource.includes('No realtime location, presence, broad social discovery, or push notification behavior is included'));
  assert.ok(platformCompanionIcsVisibilitySource.includes('sync.personal_ics_visibility'));
  assert.ok(platformCompanionIcsVisibilitySource.includes('Raw personal ICS URLs must never appear'));
  assert.ok(platformCompanionOfflinePacketSource.includes('offline_packet'));
  assert.ok(platformCompanionOfflinePacketSource.includes('read-only snapshot'));
  assert.ok(platformCompanionOfflinePacketSource.includes('schedule_catalog'));
  assert.ok(eventScheduleCatalogFoundationSource.includes('event_schedule_sessions'));
  assert.ok(eventScheduleCatalogFoundationSource.includes('separate from personal schedule plans'));
  assert.ok(eventScheduleCatalogFoundationSource.includes('Now / Next'));
  assert.ok(migrationsSource.includes('version: 88'));
  assert.ok(migrationsSource.includes('version: 89'));
  assert.ok(migrationsSource.includes('version: 90'));
  assert.ok(migrationsSource.includes('version: 93'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_sessions'));
  assert.ok(migrationsSource.includes('source_catalog_session_id'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_notifications'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_notification_delivery_attempts'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_sessions'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_notifications'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS event_schedule_notification_delivery_attempts'));
  assert.ok(initSqlSource.includes("(88, 'Add event schedule catalog sessions')"));
  assert.ok(initSqlSource.includes("(89, 'Link personal Sched plans to catalog sessions')"));
  assert.ok(initSqlSource.includes("(90, 'Add event schedule notification draft and send records')"));
  assert.ok(initSqlSource.includes("(93, 'Add event schedule notification delivery attempts')"));
  assert.ok(validateMiddlewareSource.includes('eventScheduleSessionCreateSchema'));
  assert.ok(validateMiddlewareSource.includes('eventScheduleNotificationCreateSchema'));
  assert.ok(openApiSource.includes('"/api/events/{id}/attendees"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/groups/{groupId}"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/schedule-sessions"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/schedule-notifications"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/schedule-notification-delivery-boundary"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/companion/today"'));
  assert.ok(openApiSource.includes('EventCompanionTodayResponse'));
  assert.ok(openApiSource.includes('personal_ics_visibility'));
  assert.ok(openApiSource.includes('offline_packet'));
  assert.ok(openApiSource.includes('event-social-offline-packet.v1'));
  assert.ok(openApiSource.includes('EventMeetupRecord'));
  assert.ok(openApiSource.includes('EventSchedulePlanRecord'));
  assert.ok(openApiSource.includes('EventScheduleChangePreviewResponse'));
  assert.ok(openApiSource.includes('EventScheduleNotificationRecord'));
  assert.ok(openApiSource.includes('EventScheduleNotificationDeliveryBoundaryResponse'));
  assert.ok(openApiSource.includes('EventScheduleNotificationDeliveryAttemptListResponse'));
  assert.ok(openApiSource.includes('event-schedule-notification-provider-prep.v1'));
  assert.ok(openApiSource.includes('event-schedule-notification-delivery-attempt-model.v1'));
  assert.ok(openApiSource.includes('event-schedule-notification-delivery-attempt-readback.v1'));
  assert.ok(openApiSource.includes('delivery_providers'));
  assert.ok(openApiSource.includes('delivery_attempt_model'));
  assert.ok(openApiSource.includes('EventLinkedUserIdentity'));
  assert.ok(openApiSource.includes('link_current_user'));
  assert.ok(openApiSource.includes('current_user_filter_supported'));
  assert.ok(openApiSource.includes('source_catalog_session_id'));
  assert.ok(openApiSource.includes('EventScheduleSessionRecord'));
  assert.ok(backendPackageJson.scripts['test:event-social-planning-smoke']);
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/attendees'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-plans'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-change-preview'));
  assert.ok(eventSocialPlanningSmokeSource.includes('preview_only === true'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-notifications'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-schedule-notification.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-notification-delivery-boundary'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-schedule-notification-delivery-boundary.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-schedule-notification-provider-prep.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-schedule-notification-delivery-attempt-model.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-schedule-notification-delivery-attempt-readback.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('external_delivery_attempts_created === false'));
  assert.ok(eventSocialPlanningSmokeSource.includes('creates_records === true'));
  assert.ok(eventSocialPlanningSmokeSource.includes('deliveryAttemptReadbackCount'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/schedule-sessions'));
  assert.ok(eventSocialPlanningSmokeSource.includes('/api/events/${eventId}/companion/today'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-companion-now-next.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('event-companion-friend-aware-session-changes.v1'));
  assert.ok(eventSocialPlanningSmokeSource.includes('personal_ics_visibility'));
  assert.ok(eventSocialPlanningSmokeSource.includes('offline_packet'));
  assert.ok(eventPersonalIcsSyncSmokeSource.includes('/api/events/${eventId}/companion/today'));
  assert.ok(eventPersonalIcsSyncSmokeSource.includes('manual_refresh_endpoint'));
  assert.ok(eventPersonalIcsSyncSmokeSource.includes('offlinePacketVersion'));
  assert.ok(eventsViewSource.includes('function EventSocialPlanningPanel'));
  assert.ok(eventsViewSource.includes('function EventScheduleCatalog'));
  assert.ok(eventsViewSource.includes('function EventScheduleNowNext'));
  assert.ok(eventsViewSource.includes('getCatalogNowNext'));
  assert.ok(eventsViewSource.includes('QUICK_SCHEDULE_PLAN_STATUS_OPTIONS'));
  assert.ok(eventsViewSource.includes('CONFLICTING_SCHEDULE_PLAN_STATUSES'));
  assert.ok(eventsViewSource.includes('buildScheduleConflictMap'));
  assert.ok(eventsViewSource.includes('findCatalogSessionConflicts'));
  assert.ok(eventsViewSource.includes('Conflicts with'));
  assert.ok(eventsViewSource.includes('CatalogConflictResolutionPanel'));
  assert.ok(eventsViewSource.includes('resolveCatalogConflict'));
  assert.ok(eventsViewSource.includes('Make planned, move conflicts to backup'));
  assert.ok(eventsViewSource.includes('buildScheduleAttendanceSummary'));
  assert.ok(eventsViewSource.includes('buildPlanAttendanceSummary'));
  assert.ok(eventsViewSource.includes('scheduleSharedAudience'));
  assert.ok(eventsViewSource.includes('Shared with'));
  assert.ok(eventsViewSource.includes('Shared attendance'));
  assert.ok(eventsViewSource.includes('ScheduleAttendanceInline'));
  assert.ok(eventsViewSource.includes('ScheduleAttendanceDetails'));
  assert.ok(eventsViewSource.includes('Session presence'));
  assert.ok(eventsViewSource.includes('People'));
  assert.ok(eventsViewSource.includes('Groups'));
  assert.ok(eventsViewSource.includes('CATALOG_TIME_FILTER_OPTIONS'));
  assert.ok(eventsViewSource.includes('Catalog filters'));
  assert.ok(eventsViewSource.includes('Catalog track filter'));
  assert.ok(eventsViewSource.includes('Catalog category filter'));
  assert.ok(eventsViewSource.includes('Catalog room or location filter'));
  assert.ok(eventsViewSource.includes('Has shared attendance'));
  assert.ok(eventsViewSource.includes('Conflicts only'));
  assert.ok(eventsViewSource.includes('CatalogPlanStateSelect'));
  assert.ok(eventsViewSource.includes('CatalogPlanIntentActions'));
  assert.ok(eventsViewSource.includes('SchedulePlanDraftIntentActions'));
  assert.ok(eventsViewSource.includes('Join'));
  assert.ok(eventsViewSource.includes('Leave'));
  assert.ok(eventsViewSource.includes('Replace with this'));
  assert.ok(eventsViewSource.includes('SCHEDULE_MESSAGE_INTENTS'));
  assert.ok(eventsViewSource.includes('SCHEDULE_MESSAGE_TEMPLATE_OPTIONS'));
  assert.ok(eventsViewSource.includes('ScheduleNotificationComposer'));
  assert.ok(eventsViewSource.includes('Schedule notification message'));
  assert.ok(eventsViewSource.includes('Preview uses a matching local-notice template.'));
  assert.ok(eventsViewSource.includes('Suggested:'));
  assert.ok(eventsViewSource.includes('ScheduleChangePreviewPanel'));
  assert.ok(eventsViewSource.includes('Preview share'));
  assert.ok(eventsViewSource.includes('ScheduleNotificationPanel'));
  assert.ok(eventsViewSource.includes('ScheduleNotificationHistory'));
  assert.ok(eventsViewSource.includes('Notification history'));
  assert.ok(eventsViewSource.includes('ScheduleDeliveryAttemptRows'));
  assert.ok(eventsViewSource.includes('Delivery attempt readback'));
  assert.ok(eventsViewSource.includes('Local audit only. This is not push, email, or device delivery.'));
  assert.ok(eventsViewSource.includes('EventScheduleNotificationInbox'));
  assert.ok(eventsViewSource.includes('Notification inbox'));
  assert.ok(eventsViewSource.includes('Notification delivery boundary'));
  assert.ok(eventsViewSource.includes('Notification inbox filter'));
  assert.ok(eventsViewSource.includes('recipient=me'));
  assert.ok(eventsViewSource.includes('Add me to this event'));
  assert.ok(eventsViewSource.includes('Add your own attendee before managing other people'));
  assert.ok(eventsViewSource.includes('You are not added to this event yet'));
  assert.ok(eventsViewSource.includes('You were added to this event and the group was created'));
  assert.ok(eventsViewSource.includes('You were added to this event and the meetup was created'));
  assert.ok(eventsViewSource.includes('You were added to this event and the schedule plan was saved'));
  assert.ok(eventsViewSource.includes('const ensureSelfAttendeeForSocialAction = async () => {'));
  assert.ok(eventsViewSource.includes('findMatchingAttendeeByName'));
  assert.ok(eventsViewSource.includes('Duplicate acknowledged. The next Add will create a separate Event-local attendee.'));
  assert.ok(eventsViewSource.includes('Use the existing attendee row if this is the same person'));
  assert.ok(eventsRoutesSource.includes('findExistingLinkedEventAttendee'));
  assert.ok(eventsRoutesSource.includes('existing_attendee'));
  assert.ok(eventsRoutesSource.includes('Use that attendee row instead of adding another linked self attendee.'));
  assert.ok(eventsViewSource.includes('Linked to you'));
  assert.ok(eventsViewSource.includes('Use this form for other people.'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/schedule-notification-inbox'));
  assert.ok(eventsViewSource.includes('Send local notice'));
  assert.ok(eventsViewSource.includes('Schedule notification recipients'));
  assert.ok(eventsViewSource.includes('recipient_attendee_ids'));
  assert.ok(eventsViewSource.includes('recipient_group_ids'));
  assert.ok(eventsViewSource.includes('Selected recipients are recorded here'));
  assert.ok(eventsViewSource.includes('Edit draft'));
  assert.ok(eventsViewSource.includes('Send draft'));
  assert.ok(eventsViewSource.includes('Discard draft'));
  assert.ok(eventsRoutesSource.includes("router.patch('/events/:id/schedule-notifications/:notificationId'"));
  assert.ok(eventsRoutesSource.includes("router.delete('/events/:id/schedule-notifications/:notificationId'"));
  assert.ok(eventsRoutesSource.includes('Only draft schedule notifications can be edited or sent'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/schedule-notification-delivery-boundary'"));
  assert.ok(eventsRoutesSource.includes('event-schedule-notification-delivery-boundary.v1'));
  assert.ok(eventsRoutesSource.includes('event-schedule-notification-provider-prep.v1'));
  assert.ok(eventsRoutesSource.includes('event-schedule-notification-delivery-attempt-model.v1'));
  assert.ok(eventsRoutesSource.includes('event-schedule-notification-delivery-attempt-readback.v1'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/schedule-notification-delivery-attempts'"));
  assert.ok(eventsRoutesSource.includes("provider: 'platform_device'"));
  assert.ok(eventsRoutesSource.includes("provider_selection: 'fixed_event_local'"));
  assert.ok(eventsRoutesSource.includes("relationship: 'one_attempt_per_notification_recipient_provider'"));
  assert.ok(eventsRoutesSource.includes("provider_message_id: 'string | null'"));
  assert.ok(eventsRoutesSource.includes('push, email, device, or global inbox behavior requires a new contract version'));
  assert.ok(eventsRoutesSource.includes('event-schedule-notification-inbox.v1'));
  assert.ok(eventsRoutesSource.includes('buildScheduleMessageTemplate'));
  assert.ok(eventsRoutesSource.includes('Anyone want to join me for'));
  assert.ok(eventsRoutesSource.includes("I'm switching to"));
  assert.ok(eventsRoutesSource.includes('Meet outside this room'));
  assert.ok(validateMiddlewareSource.includes('message_intent'));
  assert.ok(validateMiddlewareSource.includes("'meet'"));
  assert.ok(openApiSource.includes('message_intent'));
  assert.ok(openApiSource.includes('"meet"'));
  assert.ok(eventsRoutesSource.includes('idx_event_attendees_event_user_active'));
  assert.ok(eventsRoutesSource.includes('current_user_recipient'));
  assert.ok(eventsRoutesSource.includes('event_schedule_notification_recipients'));
  assert.ok(eventSocialPlanningSmokeSource.includes('scheduleNotificationInboxCount'));
  assert.ok(eventSocialPlanningSmokeSource.includes('linkedScheduleNotificationInboxCount'));
  assert.ok(eventSocialPlanningSmokeSource.includes('recipient=me'));
  assert.ok(eventsViewSource.includes('upsertCatalogSessionPlanStatus'));
  assert.ok(eventsViewSource.includes('Catalog now and next'));
  assert.ok(eventsViewSource.includes('Catalog time window filters'));
  assert.ok(eventsViewSource.includes('Later Today'));
  assert.ok(eventsViewSource.includes('plannedToday'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/schedule-sessions'));
  assert.ok(eventsViewSource.includes('Add catalog session'));
  assert.ok(eventsViewSource.includes('Not in schedule'));
  assert.ok(eventsViewSource.includes('/events/${eventId}/meetups'));
  assert.ok(eventsViewSource.includes('Event plans'));
  assert.ok(eventsViewSource.includes('function EventScheduleAgenda'));
  assert.ok(eventsViewSource.includes('Manage Sched feed'));
  assert.ok(eventsViewSource.includes('function EventSocialMobileOverview'));
  assert.ok(eventsViewSource.includes('Mobile event social overview'));
  assert.ok(eventsViewSource.includes('Day-of social plan'));
  assert.ok(eventsViewSource.includes('event-social-schedule'));
  assert.ok(eventsViewSource.includes('event-social-meetups'));
  assert.ok(eventsViewSource.includes('event-social-people'));
  assert.ok(eventsViewSource.includes('onJump?.(action.key)'));
  assert.ok(eventsViewSource.includes('Related groups'));
  assert.ok(eventsViewSource.includes('Next meetup'));
  assert.ok(eventsViewSource.includes('Next shared plan'));
  assert.ok(eventsViewSource.includes('Members'));
  assert.ok(eventsViewSource.includes('Shared plans'));
  assert.ok(eventsViewSource.includes('Related group'));
  assert.ok(eventsViewSource.includes('Group members'));
  assert.ok(eventsViewSource.includes('Meetup notes'));
  assert.ok(eventsViewSource.includes('updateAttendee'));
  assert.ok(eventsViewSource.includes('updateGroup'));
  assert.ok(eventsViewSource.includes('Attendee updated'));
  assert.ok(eventsViewSource.includes('Group updated'));
  assert.ok(eventsViewSource.includes('Group name'));
}));

results.push(run('Comic-Con field kit contract is wired for 3.22.0', () => {
  assert.ok(migrationsSource.includes('version: 115'));
  assert.ok(migrationsSource.includes('ADD COLUMN IF NOT EXISTS booth VARCHAR(120)'));
  assert.ok(initSqlSource.includes('booth VARCHAR(120)'));
  assert.ok(initSqlSource.includes("(115, 'Add wishlist booth support for event field kits')"));
  assert.ok(wishlistRoutesSource.includes('booth: row.booth'));
  assert.ok(wishlistRoutesSource.includes("if (has('booth')) next.booth"));
  assert.ok(wishlistRoutesSource.includes('const eventId = nullableInt(req.query.event_id)'));
  assert.ok(eventsRoutesSource.includes("router.get('/events/:id/field-kit'"));
  assert.ok(eventsRoutesSource.includes('event-field-kit.v1'));
  assert.ok(eventsRoutesSource.includes('buildFieldKitCompanionSummary'));
  assert.ok(eventsRoutesSource.includes('fieldKitWishlistSourceUrl'));
  assert.ok(eventsRoutesSource.includes('personal_ics_visibility'));
  assert.ok(!eventsRoutesSource.includes('feed_url_encrypted'));
  assert.ok(openApiSource.includes('"EventFieldKitResponse"'));
  assert.ok(openApiSource.includes('"/api/events/{id}/field-kit"'));
  assert.ok(openApiSource.includes('"source_url": { "type": ["string", "null"], "format": "uri" }'));
  assert.ok(openApiSource.includes('"booth": { "type": ["string", "null"] }'));
  assert.ok(wishlistViewSource.includes('form.booth'));
  assert.ok(eventsViewSource.includes('Comic-Con field kit'));
  assert.ok(eventsViewSource.includes('Quick haul capture'));
  assert.ok(eventsViewSource.includes('Post-con cleanup'));
  assert.ok(eventsViewSource.includes('Break out article wants'));
  assert.ok(eventsViewSource.includes('sdcc_blog_exclusive_breakout'));
  assert.ok(eventsViewSource.includes('exclusiveBreakoutProviderKey'));
  assert.ok(eventsViewSource.includes('huntItemReadback'));
  assert.ok(eventsViewSource.includes('More info'));
  assert.ok(eventsViewSource.includes("apiCall('post', '/wishlist'"));
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

results.push(run('catalog ICS import parser normalizes provider taxonomy for schedule sessions', () => {
  assert.ok(backendPackageJson.scripts['test:event-catalog-ics-import-smoke']);
  assert.ok(validateMiddlewareSource.includes('eventScheduleCatalogIcsImportSchema'));
  assert.ok(eventsRoutesSource.includes("router.post('/events/:id/schedule-sessions/import-ics'"));
  assert.ok(eventsRoutesSource.includes('events.schedule_session.import_ics.success'));
  assert.ok(schedIcsSyncSource.includes('CATALOG_ICS_SOURCE_TYPE'));
  assert.ok(schedIcsSyncSource.includes('function parseIcsCatalogSessions'));
  assert.ok(openApiSource.includes('EventScheduleCatalogIcsImportRequest'));
  assert.ok(openApiSource.includes('\"/api/events/{id}/schedule-sessions/import-ics\"'));
  assert.ok(eventCatalogIcsImportSmokeSource.includes("source_type === 'sched_catalog_ics'"));
  assert.ok(eventCatalogIcsImportSmokeSource.includes('Catalog import must not create duplicate personal schedule plans'));
  assert.ok(eventCatalogIcsImportSmokeSource.includes('source_catalog_session_id'));
  assert.ok(eventsViewSource.includes('Import catalog ICS'));
  assert.ok(eventsViewSource.includes('planLinksCatalogSession'));
  assert.ok(eventsViewSource.includes('source_catalog_session_id'));
  assert.strictEqual(typeof linkPersonalPlansToCatalogSessions, 'function');

  const [session] = parseIcsCatalogSessions(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:catalog-sched-1
SUMMARY:Spotlight on Jim Lee
DESCRIPTION:World-renowned artist &amp; publisher\\nSketches live.
CATEGORIES:1: PROGRAMS, Comics, Art
LOCATION:Room 6DE, San Diego Convention Center
URL:https://example.test/session/spotlight
DTSTART:20250724T194500Z
DTEND:20250724T204500Z
END:VEVENT
END:VCALENDAR`);

  assert.strictEqual(session.source_type, 'sched_catalog_ics');
  assert.strictEqual(session.room, 'Room 6DE');
  assert.strictEqual(session.track, 'Comics');
  assert.deepStrictEqual(session.categories, ['Comics', 'Art']);
  assert.ok(session.description.includes('artist & publisher'));
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
  }, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] });

  assert.strictEqual(text.includes('BEGIN:VCALENDAR'), true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://example.test/personal.ics');
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.headers['User-Agent'], ICS_FETCH_USER_AGENT);
  assert.ok(calls[0].options.headers.Accept.includes('text/calendar'));
}));

results.push(run('outbound URL policy blocks user-supplied ICS private hosts by default', async () => {
  assert.strictEqual(parseHttpUrl('webcal://calendar.example.test/feed.ics', { allowWebcal: true }).toString(), 'https://calendar.example.test/feed.ics');
  assert.strictEqual(parseHttpUrl('https://user:secret@example.test/feed.ics'), null);
  assert.strictEqual(isPrivateAddress('127.0.0.1'), true);
  assert.strictEqual(isPrivateAddress('192.168.1.20'), true);
  assert.strictEqual(isPrivateAddress('93.184.216.34'), false);

  await assert.rejects(
    () => assertPublicHttpUrl('https://localhost/feed.ics', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /localhost/
  );
  await assert.rejects(
    () => assertPublicHttpUrl('https://calendar.example.test/feed.ics', { lookup: async () => [{ address: '10.0.0.4', family: 4 }] }),
    /private/
  );
  assert.strictEqual(
    await assertPublicHttpUrl('https://calendar.example.test/feed.ics', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    'https://calendar.example.test/feed.ics'
  );
}));

results.push(run('repo documents CodeQL request-forgery boundaries for maintained outbound URLs', () => {
  assert.ok(codeqlWorkflowSource.includes('config-file: ./.github/codeql/codeql-config.yml'));
  assert.ok(codeqlWorkflowSource.includes('queries: ./.github/codeql/collectz-maintained-source.qls'));
  assert.ok(codeqlMaintainedSourceSuite.includes('AlertSuppression.ql'));
  assert.ok(codeqlConfigSource.includes('id: js/http-to-file-access'));
  assert.ok(codeqlConfigSource.includes('id: js/request-forgery'));
  assert.ok(!codeqlWorkflowSource.includes('packs: ./.github/codeql/collectz-js-models'));
  assert.ok(!codeqlWorkflowSource.includes('codeql/javascript-queries:AlertSuppression.ql'));
  for (const ignoredPath of [
    'artifacts/**',
    'backend/artifacts/**',
    'frontend/artifacts/**',
    '**/playwright-report/**',
    '**/coverage/**',
    '**/dist/**',
    '**/build/**',
    '**/node_modules/**',
    '**/*.sarif'
  ]) {
    assert.ok(codeqlConfigSource.includes(ignoredPath), `Missing CodeQL ignored path: ${ignoredPath}`);
  }
  assert.ok(codeqlModelPackSource.includes('extensionTargets:'));
  assert.ok(codeqlRequestForgeryModelSource.includes('extensible: barrierModel'));
  assert.ok(codeqlRequestForgeryModelSource.includes('Member[assertPublicHttpUrl].ReturnValue'));
  assert.ok(codeqlRequestForgeryModelSource.includes('Member[assertPublicIcsUrl].ReturnValue'));
  assert.ok(codeqlRequestForgeryModelSource.includes('Member[normalizeTrustedConnectorHttpUrl].ReturnValue'));
  assert.ok(outboundUrlPolicySource.includes('function normalizeTrustedConnectorHttpUrl'));
  assert.ok(outboundUrlPolicySource.includes('function assertPublicHttpUrl'));
  assert.ok(kavitaServiceSource.includes('normalizeTrustedConnectorHttpUrl(value)'));
  assert.ok(kavitaServiceSource.includes("axios.post('/api/Plugin/authenticate'"));
  assert.ok(kavitaServiceSource.includes("axios.get('/api/Library/libraries'"));
  assert.ok(kavitaServiceSource.includes("axios.post('/api/Series/all-v2'"));
  assert.ok(kavitaServiceSource.includes('baseURL: baseUrl'));
  assert.ok(schedIcsSyncSource.includes('function assertPublicIcsUrl'));
  assert.ok(schedIcsSyncSource.includes('parseHttpUrl'));
  assert.ok(schedIcsSyncSource.includes('assertPublicIcsUrl('));
  assert.ok(schedIcsSyncSource.includes('codeql[js/request-forgery]'));
  }));

results.push(run('CSV import uploads stay in memory instead of reading request-controlled temp paths', () => {
  assert.ok(mediaRoutesSource.includes('const tempUpload = multer({ storage: multer.memoryStorage(), limits: SINGLE_FILE_UPLOAD_LIMITS })'));
  assert.ok(mediaRoutesSource.includes('fieldNameSize: 100'));
  assert.ok(mediaRoutesSource.includes('parts: 25'));
  assert.ok(mediaRoutesSource.includes("req.file.buffer.toString('utf8')"));
  assert.ok(!mediaRoutesSource.includes('fs.promises.readFile(req.file.path'));
  assert.ok(!mediaRoutesSource.includes('fs.promises.unlink(req.file.path'));
}));

results.push(run('media identity alias SQL uses query parameters instead of escaped interpolation', () => {
  assert.ok(mediaRoutesSource.includes('function appendMetadataKeyMatchSql'));
  assert.ok(mediaRoutesSource.includes('function appendMetadataKeyAnySql'));
  assert.ok(mediaRoutesSource.includes('mm."key" = ANY(${appendSqlParam(params, keys)}::text[])'));
  assert.ok(!mediaRoutesSource.includes("aliasKey.replace(/'/g"));
  assert.ok(!mediaRoutesSource.includes("key.replace(/'/g"));
  assert.ok(!mediaRoutesSource.includes('ANY(ARRAY[${'));
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

results.push(run('reusable artist records are wired into artwork entry for the 3.4.152 slice', () => {
  assert.ok(migrationsSource.includes('version: 101'));
  assert.ok(migrationsSource.includes("description: 'Add reusable artist records for Art'"));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS art_artist_records'));
  assert.ok(migrationsSource.includes('artist_id INTEGER REFERENCES art_artist_records(id) ON DELETE SET NULL'));
  assert.ok(migrationsSource.includes('artist_role VARCHAR(100)'));
  assert.ok(migrationsSource.includes('idx_art_artist_records_library_name_active'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS art_artist_records'));
  assert.ok(initSqlSource.includes('artist_id INTEGER REFERENCES art_artist_records(id) ON DELETE SET NULL'));
  assert.ok(initSqlSource.includes('idx_art_items_artist_id'));
  assert.ok(initSqlSource.includes('update_art_artist_records_updated_at'));
  assert.ok(validateMiddlewareSource.includes('artist_id: nullableNumberSchema'));
  assert.ok(validateMiddlewareSource.includes('artist_role: z.preprocess(emptyStringToNull'));
  assert.ok(collectiblesRoutesSource.includes("router.get('/art/artists'"));
  assert.ok(collectiblesRoutesSource.includes("router.post('/art/artists'"));
  assert.ok(collectiblesRoutesSource.includes('validateScopedArtistRecord'));
  assert.ok(collectiblesRoutesSource.includes('artist_record: row.artist_id ?'));
  assert.ok(collectiblesRoutesSource.includes('payload.artist = payload.artist || artistRecord.name'));
  assert.ok(artViewSource.includes('function ArtistRecordPicker'));
  assert.ok(artViewSource.includes("apiCall('get', `/art/artists?q="));
  assert.ok(artViewSource.includes("apiCall('post', '/art/artists'"));
  assert.ok(artViewSource.includes('Create artist record'));
  assert.ok(artViewSource.includes('Unlink'));
  assert.ok(artViewSource.includes('Website'));
  assert.ok(artViewSource.includes('Other works'));
  assert.ok(openApiSource.includes('/api/art/artists'));
  assert.ok(openApiSource.includes('"ArtArtistRecord"'));
  assert.ok(openApiSource.includes('"artist_record"'));
  assert.ok(releaseRoadmapSource.includes('3.4.152 — Reusable Artist Records for Artwork Entry'));
}));

results.push(run('kavita chapter cover repair migration updates existing fan-out poster paths', () => {
  assert.ok(migrationsSource.includes('version: 102'));
  assert.ok(migrationsSource.includes("description: 'Repair Kavita chapter issue cover proxy paths'"));
  assert.ok(migrationsSource.includes("'/api/media/kavita-chapter-cover/' || (type_details->>'kavita_chapter_id')"));
  assert.ok(migrationsSource.includes("poster_path LIKE '/api/media/kavita-cover/%'"));
  assert.ok(migrationsSource.includes("to_jsonb('collectz_chapter_proxy'::text)"));
  assert.ok(initSqlSource.includes("(102, 'Repair Kavita chapter issue cover proxy paths')"));
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
  assert.ok(eventsViewSource.includes('label="Entry image"'));
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
  assert.ok(eventsRoutesSource.includes('const signature = await syncEventArtifactSignature'));
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
  assert.ok(artViewSource.includes('<span className="label">Height</span>'));
  assert.ok(artViewSource.includes('<span className="label">Width</span>'));
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

results.push(run('Art numbered print metadata and readback are wired through native Art contracts', () => {
  assert.ok(migrationsSource.includes('version: 95'));
  assert.ok(migrationsSource.includes('Add Art numbered print metadata'));
  assert.ok(initSqlSource.includes('print_number INTEGER CHECK'));
  assert.ok(initSqlSource.includes('print_run INTEGER CHECK'));
  assert.ok(validateMiddlewareSource.includes('print_number: nullableNumberSchema'));
  assert.ok(validateMiddlewareSource.includes('print_run: nullableNumberSchema'));
  assert.ok(collectiblesRoutesSource.includes('print_number: row.print_number === null'));
  assert.ok(collectiblesRoutesSource.includes('print_run: row.print_run === null'));
  assert.ok(collectiblesRoutesSource.includes("'print_number', 'print_run'"));
  assert.ok(artViewSource.includes('function formatPrintEdition'));
  assert.ok(artViewSource.includes('<span className="label">Print #</span>'));
  assert.ok(artViewSource.includes('<span className="label">Run</span>'));
  assert.ok(artViewSource.includes("return `#${printNumber}/${printRun}`;"));
  assert.ok(artViewSource.includes("const subtitle = [printEdition, item.signed ? 'Signed' : null, mediumLabel].filter(Boolean).join(' ');"));
  assert.ok(!artViewSource.includes("leftBadges={[`#${item.id}`, 'Art']}"));
  assert.ok(!artViewSource.includes('rightBadge={item.signed'));
  assert.ok(artViewSource.includes('{`Print ${printEdition}`}'));
  assert.ok(openApiSource.includes('"print_number"'));
  assert.ok(openApiSource.includes('"print_run"'));
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
  assert.ok(libraryMultiformatBrowserSpecSource.includes("name: 'Details'"));
  assert.ok(libraryMultiformatBrowserSpecSource.includes("name: 'Hide'"));
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
  assert.ok(adminShellBrowserSpecSource.includes("getByRole('button', { name: 'Review', exact: true })"));
  assert.ok(adminShellBrowserSpecSource.includes('Preview merge'));
  assert.ok(adminShellBrowserSpecSource.includes('Apply merge'));
  assert.ok(adminShellBrowserSpecSource.includes('Cross-type merges are not allowed'));
  assert.ok(adminShellBrowserSpecSource.includes('Compared fields'));
}));

results.push(run('dashboard command center is authenticated scoped dashboard default', () => {
  assert.ok(serverSource.includes("const dashboardRouter = require('./routes/dashboard');"));
  assert.ok(serverSource.includes("app.use('/api', dashboardRouter);"));
  assert.ok(dashboardRoutesSource.includes("router.use('/dashboard', authenticateToken);"));
  assert.ok(dashboardRoutesSource.includes("router.use('/dashboard', enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(dashboardRoutesSource.includes("router.get('/dashboard/summary'"));
  assert.ok(dashboardRoutesSource.includes('plex_reconciliation_reviews'));
  assert.ok(dashboardRoutesSource.includes('missing_identifiers'));
  assert.ok(dashboardRoutesSource.includes('sparse_metadata'));
  assert.ok(dashboardRoutesSource.includes('attention_details'));
  assert.ok(dashboardRoutesSource.includes('missing_cover_items'));
  assert.ok(dashboardRoutesSource.includes('missing_identifier_items'));
  assert.ok(dashboardRoutesSource.includes('sparse_metadata_items'));
  assert.ok(dashboardRoutesSource.includes('summarizeProviderRow'));
  assert.ok(openApiSource.includes('"/api/dashboard/summary"'));
  assert.ok(openApiSource.includes('"/api/dashboard/review-decisions"'));
  assert.ok(openApiSource.includes('"/api/dashboard/review-decisions/{id}"'));
  assert.ok(openApiSource.includes('"DashboardReviewDecisionRequest"'));
  assert.ok(openApiSource.includes('"DashboardReviewDecisionResponse"'));
  assert.ok(openApiSource.includes('"DashboardReviewDecisionHistory"'));
  assert.ok(openApiSource.includes('"DashboardReviewDecisionList"'));
  assert.ok(openApiSource.includes('"DashboardSummary"'));
  assert.ok(openApiSource.includes('"attention_details"'));
  assert.ok(openApiSource.includes('"review_filter"'));
  assert.ok(openApiSource.includes('"missing_covers"'));
  assert.ok(openApiSource.includes('"missing_identifiers"'));
  assert.ok(openApiSource.includes('"sparse_metadata"'));
  assert.ok(openApiSource.includes('"review_reasons"'));
  assert.ok(openApiSource.includes('"recommended_identifiers"'));
  assert.ok(openApiSource.includes('"recommended_metadata"'));
  assert.ok(openApiSource.includes('"review_lookup_title"'));
  assert.ok(openApiSource.includes('"review_lookup_context"'));
  assert.ok(openApiSource.includes('"review_next_action"'));
  assert.ok(openApiSource.includes('"review_decision_history"'));
  assert.ok(openApiSource.includes('"hidden_review_decisions"'));
  assert.ok(dashboardRoutesSource.includes('buildMissingIdentifierReviewClues'));
  assert.ok(dashboardRoutesSource.includes('buildSparseMetadataReviewClues'));
  assert.ok(dashboardRoutesSource.includes("router.post('/dashboard/review-decisions'"));
  assert.ok(dashboardRoutesSource.includes("router.delete('/dashboard/review-decisions/:id'"));
  assert.ok(dashboardRoutesSource.includes('media_review_decisions'));
  assert.ok(dashboardRoutesSource.includes("mrd.action = 'dismissed'"));
  assert.ok(dashboardRoutesSource.includes("mrd.action = 'deferred'"));
  assert.ok(dashboardRoutesSource.includes("CURRENT_TIMESTAMP + INTERVAL '7 days'"));
  assert.ok(dashboardRoutesSource.includes('dashboard.review.${action}'));
  assert.ok(dashboardRoutesSource.includes('dashboard.review.restored'));
  assert.ok(dashboardRoutesSource.includes('reviewDecisionHistorySql'));
  assert.ok(dashboardRoutesSource.includes('review_decision_history'));
  assert.ok(dashboardRoutesSource.includes('hiddenReviewDecisions'));
  assert.ok(dashboardRoutesSource.includes('shapeReviewDecisionRow'));
  assert.ok(validateMiddlewareSource.includes('dashboardReviewDecisionSchema'));
  assert.ok(migrationsSource.includes('version: 106'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS media_review_decisions'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS media_review_decisions'));
  assert.ok(mediaRoutesSource.includes('applyMediaReviewClues'));
  assert.ok(mediaRoutesSource.includes('normalizedReviewFilter'));
  assert.ok(mediaRoutesSource.includes("media.poster_path"));
  assert.ok(mediaRoutesSource.includes('buildMissingIdentifierReviewSql'));
  assert.ok(mediaRoutesSource.includes('buildSparseMetadataReviewSql'));
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/dashboard/summary', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/dashboard/review-decisions', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/dashboard/review-decisions/1', method: 'DELETE' }), ['media:write']);
}));

results.push(run('dashboard review owns inline media resolution instead of a standalone review route', () => {
  const dashboardReviewSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend/src/components/DashboardCommandCenterView.jsx'), 'utf8');
  assert.ok(!serverSource.includes("routes/reviewQueue"));
  assert.ok(!openApiSource.includes('"/api/review-queue"'));
  assert.ok(!personalAccessTokenSource.includes('/api/review-queue'));
  assert.ok(dashboardRoutesSource.includes('attention_details'));
  assert.ok(dashboardReviewSource.includes('MediaReviewDrawer'));
  assert.ok(dashboardReviewSource.includes('/media/upload-cover'));
  assert.ok(dashboardReviewSource.includes('/media/search-tmdb'));
  assert.ok(dashboardReviewSource.includes('/media/enrich/book/search'));
  assert.ok(dashboardReviewSource.includes('Search TMDB'));
  assert.ok(dashboardReviewSource.includes('Search Google Books'));
  assert.ok(dashboardReviewSource.includes('Search comic issue'));
  assert.ok(dashboardReviewSource.includes('Search Discogs'));
  assert.ok(dashboardReviewSource.includes('lookupContextValue'));
  assert.ok(dashboardReviewSource.includes('suggestedReviewLookupTitle'));
  assert.ok(dashboardReviewSource.includes('Use search text as title'));
  assert.ok(dashboardReviewSource.includes('Upload cover'));
  assert.ok(dashboardReviewSource.includes('reviewDecisionFindingType'));
  assert.ok(dashboardReviewSource.includes('/dashboard/review-decisions'));
  assert.ok(dashboardReviewSource.includes('HiddenReviewDecisionList'));
  assert.ok(dashboardReviewSource.includes('Hidden review items'));
  assert.ok(dashboardReviewSource.includes('Review item restored'));
  assert.ok(dashboardReviewSource.includes('ReviewDecisionHistory'));
  assert.ok(dashboardReviewSource.includes('Recent review decisions'));
  assert.ok(dashboardReviewSource.includes('ReviewIdentitySnapshot'));
  assert.ok(dashboardReviewSource.includes('Known identity'));
  assert.ok(dashboardReviewSource.includes('No recognized identifier on this record yet.'));
  assert.ok(dashboardReviewSource.includes('ReviewPendingUpdates'));
  assert.ok(dashboardReviewSource.includes('Pending updates'));
  assert.ok(dashboardReviewSource.includes('Save updates to apply these changes.'));
  assert.ok(dashboardReviewSource.includes('hasPendingUpdates'));
  assert.ok(dashboardReviewSource.includes('Make a change before saving.'));
  assert.ok(dashboardReviewSource.includes('manualFallbackGuidance'));
  assert.ok(dashboardReviewSource.includes('Manual fallback'));
  assert.ok(dashboardReviewSource.includes('Use provider lookup first.'));
  assert.ok(dashboardReviewSource.includes("reviewType === 'missing-identifiers' || reviewType === 'sparse-metadata'"));
  assert.ok(dashboardReviewSource.includes('Use lookup when the source can fill missing details.'));
  assert.ok(dashboardReviewSource.includes('const DASHBOARD_SAMPLE_LIMIT = 8;'));
  assert.ok(dashboardReviewSource.includes('idBase="dashboard-sections"'));
  assert.ok(!dashboardReviewSource.includes('xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]'));
  assert.ok(!dashboardReviewSource.includes('dashboard-mobile-sections'));
  assert.ok(dashboardReviewSource.includes('Defer 7 days'));
  assert.ok(dashboardReviewSource.includes('Dismiss'));
}));

results.push(run('media review clues classify identifiers separately from sparse metadata', () => {
  assert.ok(reviewCluesServiceSource.includes('Physical audio item has no retail identifier'));
  assert.ok(reviewCluesServiceSource.includes('Record is missing helpful descriptive metadata'));
  assert.ok(reviewCluesServiceSource.includes('buildReviewLookupGuidance'));
  assert.ok(reviewCluesServiceSource.includes('Search by corrected title or year before entering provider IDs by hand.'));
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'book', type_details: {} }), {
    review_finding_type: 'missing_identifier',
    review_reasons: ['No book identifier on record'],
    recommended_identifiers: ['ISBN', 'Google Books ID'],
    review_lookup_title: '',
    review_lookup_context: '',
    review_next_action: 'Search by corrected title or author before entering ISBN by hand.'
  });
  assert.strictEqual(
    buildMissingIdentifierReviewClues({ media_type: 'movie', title: 'Example.Movie.1080p.mkv', year: 1982, type_details: {} }).review_lookup_title,
    'Example Movie'
  );
  assert.strictEqual(
    buildMissingIdentifierReviewClues({ media_type: 'movie', title: 'The Thing [1080p]', year: 1982, type_details: {} }).review_lookup_title,
    'The Thing'
  );
  assert.strictEqual(
    buildMissingIdentifierReviewClues({ media_type: 'audio', title: 'Album', owned_formats: ['cd'], type_details: { artist: 'Example Artist' } }).review_lookup_context,
    'Example Artist'
  );
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'movie', type_details: {} }).recommended_identifiers, ['TMDB ID', 'Plex identity']);
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'tv_series', type_details: {} }).recommended_identifiers, ['TMDB ID', 'Plex identity']);
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'comic_book', type_details: {} }).recommended_identifiers, ['UPC/ISBN', 'provider issue identity']);
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'audio', owned_formats: ['cd'], type_details: {} }).recommended_identifiers, ['UPC/EAN']);
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'game', owned_formats: ['disc'], type_details: {} }).recommended_identifiers, ['UPC/EAN']);
  assert.deepStrictEqual(buildMissingIdentifierReviewClues({ media_type: 'book', type_details: { isbn: '9780553572773' } }), {
    review_finding_type: null,
    review_reasons: [],
    recommended_identifiers: []
  });
  assert.strictEqual(buildMissingIdentifierReviewClues({ media_type: 'book', upc: '9780553572773', type_details: {} }).review_finding_type, null);
  assert.strictEqual(buildMissingIdentifierReviewClues({ media_type: 'movie', upc: '0707541997928', type_details: {} }).review_finding_type, null);
  assert.strictEqual(buildMissingIdentifierReviewClues({ media_type: 'tv_series', upc: '012345678905', type_details: {} }).review_finding_type, null);
  assert.strictEqual(buildMissingIdentifierReviewClues({ media_type: 'audio', owned_formats: ['digital'], type_details: {} }).review_finding_type, null);
  assert.deepStrictEqual(buildSparseMetadataReviewClues({ media_type: 'audio', owned_formats: ['digital'], type_details: {} }), {
    review_finding_type: 'sparse_metadata',
    review_reasons: ['Record is missing helpful descriptive metadata'],
    recommended_metadata: ['artist', 'year'],
    review_lookup_title: '',
    review_lookup_context: '',
    review_next_action: 'Search by album title and artist before entering a retail barcode by hand.'
  });
  assert.strictEqual(buildMissingIdentifierReviewClues({ media_type: 'game', owned_formats: ['digital'], type_details: {} }).review_finding_type, null);
  assert.deepStrictEqual(buildMediaHealthReview({ media_type: 'game', owned_formats: ['digital'], type_details: {} }).review_finding_type, 'sparse_metadata');
  assert.strictEqual(buildMediaHealthReview({ media_type: 'comic_book', type_details: { series: 'Alpha Flight', issue_number: '1' } }).review_finding_type, 'sparse_metadata');
}));

results.push(run('dashboard command center frontend owns first-screen attention workflow', () => {
  const removedDashboardTab = ['ho', 'me'].join('');
  assert.ok(dashboardRoutingSource.includes("'dashboard'"));
  assert.ok(dashboardRoutingSource.includes("export const DEFAULT_TAB = 'dashboard';"));
  assert.ok(!dashboardRoutingSource.includes(`'${removedDashboardTab}'`));
  assert.ok(productEditionFrontendSource.includes("export const DEFAULT_PLATFORM_TAB = 'dashboard';"));
  assert.ok(productEditionFrontendSource.includes("'dashboard',"));
  assert.ok(sidebarNavSource.includes('id="dashboard"'));
  assert.ok(sidebarNavSource.includes('label="Dashboard"'));
  assert.ok(sidebarNavSource.includes('<Icons.Gauge />'));
  assert.ok(appPrimitivesSource.includes('Gauge:'));
  assert.ok(dashboardContentSource.includes("case 'dashboard':"));
  assert.ok(dashboardContentSource.includes('DashboardCommandCenterView'));
  assert.ok(dashboardCommandCenterViewSource.includes("apiCall('get', '/dashboard/summary')"));
  assert.ok(dashboardCommandCenterViewSource.includes('>Dashboard<'));
  assert.ok(dashboardCommandCenterViewSource.includes("label: 'Review'"));
  assert.ok(dashboardCommandCenterViewSource.includes('role="tablist"'));
  assert.ok(dashboardCommandCenterViewSource.includes('Review sections'));
  assert.ok(dashboardCommandCenterViewSource.includes('reviewClue'));
  assert.ok(dashboardCommandCenterViewSource.includes('Missing covers'));
  assert.ok(dashboardCommandCenterViewSource.includes('Missing identifiers'));
  assert.ok(dashboardCommandCenterViewSource.includes('Plex conflicts'));
  assert.ok(dashboardCommandCenterViewSource.includes('DASHBOARD_SAMPLE_LIMIT'));
  assert.ok(dashboardCommandCenterViewSource.includes('setLibraryReviewFilter'));
  assert.ok(dashboardCommandCenterViewSource.includes('MediaReviewDrawer'));
  assert.ok(dashboardCommandCenterViewSource.includes('openReviewItem'));
  assert.ok(dashboardCommandCenterViewSource.includes('focusReviewTab'));
  assert.ok(dashboardCommandCenterViewSource.includes("apiCall('patch', `/media/${record.id}`"));
  assert.ok(dashboardContentSource.includes('reviewFilter={activeTab === \'library\' ? libraryReviewFilter : null}'));
  assert.ok(dashboardShellSource.includes('setLibraryReviewFilter?.(null);'));
  assert.ok(libraryViewSource.includes('normalizeReviewFilter'));
  assert.ok(libraryViewSource.includes('review_filter'));
  assert.ok(useMediaApiSource.includes("'review_filter'"));
  assert.ok(!dashboardCommandCenterViewSource.includes('Quick actions'));
  assert.ok(!dashboardCommandCenterViewSource.includes('Import or scan'));
  assert.ok(!dashboardCommandCenterViewSource.includes('Latest failures'));
  assert.ok(dashboardCommandCenterViewSource.includes('Provider health'));
  assert.ok(dashboardCommandCenterViewSource.includes('Recent syncs'));
  assert.ok(dashboardCommandCenterViewSource.includes('Upcoming events'));
  assert.ok(dashboardCommandCenterViewSource.includes('SyncJobDetailDrawer'));
  assert.ok(dashboardCommandCenterViewSource.includes('setSelectedSyncJob'));
  assert.ok(syncJobDetailDrawerSource.includes("/media/sync-jobs/${jobId}/result"));
  assert.ok(syncJobDetailDrawerSource.includes('Technical payload'));
  assert.ok(activityFeedViewSource.includes('Open failure'));
  assert.ok(activityFeedViewSource.includes('syncJobId'));
  assert.ok(activityFeedViewSource.includes('SyncJobDetailDrawer'));
  assert.ok(activityFeedViewSource.includes('ActivitySnapshotDrawer'));
  assert.ok(activityFeedViewSource.includes('View snapshot'));
  assert.ok(activityFeedViewSource.includes('activity-snapshot-drawer'));
  assert.ok(activityFeedViewSource.includes('saved at the time of the change'));
  assert.ok(activityFeedViewSource.includes('buildEventTimelineEntry'));
  assert.ok(activityFeedViewSource.includes("action.startsWith('events.')"));
  assert.ok(activityFeedViewSource.includes('Event attendee ${verb}'));
  assert.ok(activityFeedViewSource.includes('buildPlexTimelineEntry'));
  assert.ok(activityFeedViewSource.includes('Plex import finished'));
  assert.ok(activityFeedViewSource.includes('Plex webhook import queued'));
  assert.ok(activityFeedViewSource.includes('Plex webhook import processed'));
  assert.ok(activityFeedViewSource.includes('Plex webhook processor ran'));
  assert.ok(activityFeedViewSource.includes('Plex ratings read from Plex'));
  assert.ok(activityFeedViewSource.includes('Plex watched state written to Plex'));
  assert.ok(activityFeedViewSource.includes("action.startsWith('plex.webhook.')"));
  assert.ok(activityFeedViewSource.includes("'Rating key'"));
  assert.ok(activityFeedViewSource.includes("'Sections'"));
  assert.ok(activityFeedViewSource.includes('PLATFORM_RUNTIME_SECTIONS'));
  assert.ok(activityFeedViewSource.includes("'Open runtime'"));
  assert.ok(eventsRoutesSource.includes('buildEventActivityDetails'));
  assert.ok(eventsRoutesSource.includes('buildAttendeeActivityDetails'));
  assert.ok(eventsRoutesSource.includes('attendeeName: attendee.display_name'));
  assert.ok(eventsRoutesSource.includes('buildSchedulePlanActivityDetails'));
  assert.ok(eventsRoutesSource.includes('buildScheduleSessionActivityDetails'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/dashboard/summary'));
  assert.ok(adminShellBrowserSpecSource.includes("page.goto('/dashboard')"));
}));

results.push(run('dashboard route helper exposes first-class app destinations', () => {
  assert.ok(dashboardRoutingSource.includes("help: '/help'"));
  assert.ok(dashboardRoutingSource.includes("'library-movies': '/library/movies'"));
  assert.ok(dashboardRoutingSource.includes("'space-manage': '/workspace/settings'"));
  assert.ok(dashboardRoutingSource.includes("'admin-merges': '/workspace/review'"));
  assert.ok(dashboardRoutingSource.includes("'admin-settings': '/platform/settings'"));
  assert.ok(dashboardRoutingSource.includes("'admin-integrations': '/platform/runtime'"));
  assert.ok(dashboardRoutingSource.includes("'admin-settings': '/settings'"));
  assert.ok(dashboardRoutingSource.includes("'admin-integrations': '/integrations'"));
  assert.ok(dashboardRoutingSource.includes("export function readDashboardStateFromLocation(pathname, search = '')"));
  assert.ok(dashboardRoutingSource.includes("export function isDashboardRoutePath(pathname)"));
  assert.ok(dashboardRoutingSource.includes('const hasLegacyDashboardState = path === \'/dashboard\''));
  assert.ok(dashboardRoutingSource.includes('if (directTab && !hasLegacyDashboardState)'));
  assert.ok(dashboardRoutingSource.includes("return `${baseRoute}/${encodeURIComponent(integrationSection)}`;"));
  assert.ok(dashboardRoutingSource.includes("window.history.pushState({}, '', nextUrl);"));
  assert.ok(frontendAppSource.includes('appRouteUrl(nextRoute, activeTab, activeIntegrationSection, dashboardRouteOptions)'));
  assert.ok(frontendAppSource.includes("window.history.replaceState({}, '', nextUrl);"));
  assert.ok(appPrimitivesSource.includes("import { isDashboardRoutePath } from './dashboardRouting';"));
  assert.ok(dashboardRoutingSource.includes('export function legacyDashboardUrl(tab, integrationSection)'));
}));

results.push(run('wishlist acquisition foundation is scoped, routed, and documented', () => {
  assert.ok(migrationsSource.includes('Add scoped wishlist and acquisition tracking'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS wanted_items'));
  assert.ok(migrationsSource.includes("status IN ('wanted', 'watching', 'preordered', 'ordered', 'acquired', 'dismissed')"));
  assert.ok(migrationsSource.includes('idx_wanted_items_library_status'));
  assert.ok(migrationsSource.includes('Add wishlist price history snapshots'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS wanted_item_price_history'));
  assert.ok(migrationsSource.includes('idx_wanted_item_price_history_item_checked'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS wanted_item_price_history'));
  assert.ok(initSqlSource.includes("(105, 'Add wishlist price history snapshots')"));
  assert.ok(wishlistRoutesSource.includes("router.use('/wishlist', authenticateToken);"));
  assert.ok(wishlistRoutesSource.includes("router.use('/wishlist', enforceScopeAccess({ allowedHintRoles: ['admin'] }));"));
  assert.ok(wishlistRoutesSource.includes("router.get('/wishlist'"));
  assert.ok(wishlistRoutesSource.includes("router.post('/wishlist'"));
  assert.ok(wishlistRoutesSource.includes("router.post('/wishlist/:id/convert'"));
  assert.ok(wishlistRoutesSource.includes("import_source, added_by"));
  assert.ok(wishlistRoutesSource.includes("'wishlist'"));
  assert.ok(serverSource.includes("const wishlistRouter = require('./routes/wishlist');"));
  assert.ok(serverSource.includes("app.use('/api', wishlistRouter);"));
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/1/convert', method: 'POST' }), ['media:write']);
  assert.ok(openApiSource.includes('"/api/wishlist"'));
  assert.ok(openApiSource.includes('"/api/wishlist/{id}/convert"'));
  assert.ok(openApiSource.includes('"WantedItem"'));
  assert.ok(openApiSource.includes('"WishlistConvertResponse"'));
  assert.ok(dashboardRoutingSource.includes("'library-wishlist'"));
  assert.ok(productEditionFrontendSource.includes("'library-wishlist'"));
  assert.ok(sidebarNavSource.includes('label="Wishlist"'));
  assert.ok(dashboardContentSource.includes("case 'library-wishlist'"));
  assert.ok(dashboardContentSource.includes('WishlistView'));
  assert.ok(wishlistViewSource.includes("apiCall('get', `/wishlist?${params.toString()}`)"));
  assert.ok(wishlistViewSource.includes("apiCall('post', `/wishlist/${item.id}/convert`, {})"));
  assert.ok(wishlistViewSource.includes('Add to library'));
  assert.ok(adminShellBrowserSpecSource.includes('/dashboard?tab=library-wishlist'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist'));
  assert.ok(adminShellBrowserSpecSource.includes('/convert'));
}));

results.push(run('apple itunes wishlist intake normalizes provider candidates', () => {
  const movie = normalizeAppleItunesResult({
    wrapperType: 'track',
    kind: 'feature-movie',
    trackId: 1001,
    trackName: 'Before the Storm',
    artistName: 'Lucasfilm',
    releaseDate: '1996-01-01T08:00:00Z',
    trackPrice: 4.99,
    currency: 'USD',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Video/100x100bb.jpg',
    trackViewUrl: 'https://itunes.apple.com/us/movie/before-the-storm/id1001'
  }, { media: 'movie' });
  assert.strictEqual(movie.provider, 'apple_itunes');
  assert.strictEqual(movie.provider_key, '1001');
  assert.strictEqual(movie.object_type, 'movie');
  assert.strictEqual(movie.year, 1996);
  assert.strictEqual(movie.price, 4.99);
  assert.ok(movie.artwork_url.includes('600x600bb'));

  const tv = normalizeAppleItunesResult({ kind: 'tv-episode', trackId: 2002, trackName: 'Pilot', collectionName: 'A Show' }, { media: 'tvShow' });
  const ebook = normalizeAppleItunesResult({ kind: 'book', trackId: 3003, trackName: 'Green Mars' }, { media: 'ebook' });
  const audiobook = normalizeAppleItunesResult({ kind: 'audiobook', collectionId: 4004, collectionName: 'Dune' }, { media: 'audiobook' });
  const music = normalizeAppleItunesResult({ kind: 'song', trackId: 5005, trackName: 'Song', trackPrice: 0, currency: 'USD' }, { media: 'music' });
  const software = normalizeAppleItunesResult({ kind: 'software-package', trackId: 6006, trackName: 'Game App', primaryGenreName: 'Games' }, { media: 'software' });
  assert.strictEqual(tv.object_type, 'tv_series');
  assert.strictEqual(ebook.object_type, 'book');
  assert.strictEqual(audiobook.object_type, 'audio');
  assert.strictEqual(music.object_type, 'audio');
  assert.strictEqual(music.price, 0);
  assert.strictEqual(software.object_type, 'game');
  assert.deepStrictEqual(normalizeMediaList('movie,ebook,unknown,tvShow'), ['movie', 'ebook', 'tvShow']);
  assert.strictEqual(dedupeCandidates([movie, { ...movie, id: 'copy' }]).length, 1);
}));

results.push(run('apple itunes wishlist movie search falls back to generic feature-movie results', async () => {
  const requestedUrls = [];
  const matches = await fetchAppleSearch({
    term: 'matrix',
    media: ['movie'],
    country: 'US',
    limit: 5,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const isTypedMovieSearch = url.searchParams.get('media') === 'movie';
      return {
        ok: true,
        async json() {
          if (isTypedMovieSearch) return { resultCount: 0, results: [] };
          return {
            resultCount: 3,
            results: [
              {
                wrapperType: 'track',
                kind: 'feature-movie',
                trackId: 9001,
                trackName: 'The Matrix',
                trackPrice: 14.99,
                currency: 'USD',
                trackViewUrl: 'https://itunes.apple.com/us/movie/the-matrix/id9001'
              },
              {
                wrapperType: 'track',
                kind: 'song',
                trackId: 9002,
                trackName: 'Matrix Theme'
              },
              {
                wrapperType: 'track',
                kind: 'tv-episode',
                trackId: 9003,
                trackName: 'The Matrix Episode'
              }
            ]
          };
        }
      };
    }
  });

  assert.strictEqual(requestedUrls.length, 2);
  assert.ok(requestedUrls[0].includes('media=movie'));
  assert.ok(!requestedUrls[1].includes('media=movie'));
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].title, 'The Matrix');
  assert.strictEqual(matches[0].kind, 'feature-movie');
  assert.strictEqual(matches[0].object_type, 'movie');
  assert.strictEqual(matches[0].match_strength, 'exact');
  assert.strictEqual(matches[0].search_source, 'generic_movie_fallback');
}));

results.push(run('apple itunes wishlist movie relevance marks weak fallback matches', () => {
  assert.deepStrictEqual(
    scoreTitleMatch('avatar', 'Avatar'),
    { score: 100, strength: 'exact', reason: 'Title exactly matches the search.' }
  );
  assert.strictEqual(scoreTitleMatch('avatar', 'Avatar: The Way of Water').strength, 'strong');
  assert.strictEqual(scoreTitleMatch('avatar', 'Christmas Cupcakes').strength, 'weak');
  assert.strictEqual(scoreTitleMatch('the matrix', 'Christmas Cupcakes').strength, 'weak');
}));

results.push(run('apple itunes wishlist search and save are routed, scoped, and documented', () => {
  assert.ok(appleItunesServiceSource.includes("const SEARCH_URL = 'https://itunes.apple.com/search';"));
  assert.ok(appleItunesServiceSource.includes("const LOOKUP_URL = 'https://itunes.apple.com/lookup';"));
  assert.ok(appleItunesServiceSource.includes('SUPPORTED_MEDIA'));
  assert.ok(appleItunesServiceSource.includes('fetchAppleSearch'));
  assert.ok(appleItunesServiceSource.includes('fetchAppleLookup'));
  assert.ok(appleItunesServiceSource.includes('buildAppleSearchUrl'));
  assert.ok(appleItunesServiceSource.includes('scoreTitleMatch'));
  assert.ok(appleItunesServiceSource.includes('match_strength'));
  assert.ok(appleItunesServiceSource.includes('generic_movie_fallback'));
  assert.ok(appleItunesServiceSource.includes("mediaType: 'generic'"));
  assert.ok(appleItunesServiceSource.includes("trimString(result.kind) === 'feature-movie'"));
  assert.ok(appleItunesServiceSource.includes('User-Agent'));
  assert.ok(wishlistRoutesSource.includes("router.get('/wishlist/apple-itunes/search'"));
  assert.ok(wishlistRoutesSource.includes("router.post('/wishlist/apple-itunes/save'"));
  assert.ok(wishlistRoutesSource.includes("router.post('/wishlist/apple-itunes/refresh-prices'"));
  assert.ok(wishlistRoutesSource.includes("router.get('/wishlist/apple-itunes/price-refresh-scheduler'"));
  assert.ok(wishlistRoutesSource.includes("router.post('/wishlist/apple-itunes/price-refresh-scheduler/run'"));
  assert.ok(wishlistRoutesSource.includes("router.get('/wishlist/apple-itunes/target-price-hits'"));
  assert.ok(wishlistRoutesSource.includes("const TARGET_HIT_ACTIONABLE_STATUSES = ['wanted', 'watching', 'preordered'];"));
  assert.ok(wishlistRoutesSource.includes('status = $3::varchar'));
  assert.ok(wishlistRoutesSource.includes('getAppleItunesWishlistPriceRefreshRuntimeConfig'));
  assert.ok(wishlistRoutesSource.includes('startAppleItunesWishlistPriceRefreshScheduler'));
  assert.ok(wishlistRoutesSource.includes("router.get('/wishlist/:id/price-history'"));
  assert.ok(wishlistRoutesSource.includes('INSERT INTO wanted_item_price_history'));
  assert.ok(wishlistRoutesSource.includes('shapePriceHistory'));
  assert.ok(wishlistRoutesSource.includes('shapeAppleTargetPriceHit'));
  assert.ok(wishlistRoutesSource.includes('COALESCE(latest.price'));
  assert.ok(wishlistRoutesSource.includes('markAppleItunesSavedState'));
  assert.ok(wishlistRoutesSource.includes('buildApplePriceReadback'));
  assert.ok(wishlistRoutesSource.includes('findScopedWantedItemByProvider'));
  assert.ok(wishlistRoutesSource.includes('invalid_target_price'));
  assert.ok(wishlistRoutesSource.includes('parsed < 0'));
  assert.ok(wishlistRoutesSource.includes("provider: APPLE_ITUNES_PROVIDER"));
  assert.ok(wishlistRoutesSource.includes('SELECT id, provider_key, status'));
  assert.ok(wishlistRoutesSource.includes('wanted_status'));
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/search', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/save', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/refresh-prices', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/price-refresh-scheduler', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/price-refresh-scheduler/run', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/apple-itunes/target-price-hits', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/wishlist/1/price-history', method: 'GET' }), ['media:read']);
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/search"'));
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/save"'));
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/refresh-prices"'));
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/price-refresh-scheduler"'));
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/price-refresh-scheduler/run"'));
  assert.ok(openApiSource.includes('"/api/wishlist/apple-itunes/target-price-hits"'));
  assert.ok(openApiSource.includes('"/api/wishlist/{id}/price-history"'));
  assert.ok(openApiSource.includes('"wanted_status"'));
  assert.ok(openApiSource.includes('"AppleItunesWishlistCandidate"'));
  assert.ok(openApiSource.includes('"AppleItunesWishlistPriceRefreshResponse"'));
  assert.ok(openApiSource.includes('"AppleItunesWishlistTargetPriceHitsResponse"'));
  assert.ok(openApiSource.includes('"AppleItunesWishlistPriceRefreshSchedulerResponse"'));
  assert.ok(openApiSource.includes('"WishlistPriceHistoryResponse"'));
  assert.ok(serverSource.includes('APPLE_ITUNES_WISHLIST_PRICE_REFRESH_RUNTIME'));
  assert.ok(serverSource.includes('startAppleItunesWishlistPriceRefreshScheduler'));
  assert.ok(wishlistViewSource.includes('Apple/iTunes search'));
  assert.ok(wishlistViewSource.includes('Refresh saved prices'));
  assert.ok(wishlistViewSource.includes("apiCall('get', '/wishlist/apple-itunes/price-refresh-scheduler')"));
  assert.ok(wishlistViewSource.includes("apiCall('post', '/wishlist/apple-itunes/price-refresh-scheduler/run'"));
  assert.ok(wishlistViewSource.includes('Run auto refresh now'));
  assert.ok(wishlistViewSource.includes('Weak match'));
  assert.ok(wishlistViewSource.includes('Apple returned movies, but none closely matched this title.'));
  assert.ok(wishlistViewSource.includes("apiCall('get', `/wishlist/apple-itunes/search?${params.toString()}`)"));
  assert.ok(wishlistViewSource.includes("apiCall('post', '/wishlist/apple-itunes/save'"));
  assert.ok(wishlistViewSource.includes("apiCall('post', '/wishlist/apple-itunes/refresh-prices'"));
  assert.ok(wishlistViewSource.includes("apiCall('get', '/wishlist/apple-itunes/target-price-hits?status=active&limit=5')"));
  assert.ok(wishlistViewSource.includes('Target price hits'));
  assert.ok(wishlistViewSource.includes('updateTargetHitStatus'));
  assert.ok(wishlistViewSource.includes("apiCall('patch', `/wishlist/${hit.id}`, { status: nextStatus })"));
  assert.ok(wishlistViewSource.includes('Mark ordered'));
  assert.ok(wishlistViewSource.includes('already_saved'));
  assert.ok(wishlistViewSource.includes('View saved item'));
  assert.ok(wishlistViewSource.includes('function appleSearchResultMeta(match)'));
  assert.ok(wishlistViewSource.includes('function normalizeTargetPriceValue(value)'));
  assert.ok(wishlistViewSource.includes('Enter a valid target price of 0 or more.'));
  assert.ok(wishlistViewSource.includes('Saved: ${statusLabel(match.wanted_status)}'));
  assert.ok(wishlistViewSource.includes('min="0"'));
  assert.ok(wishlistViewSource.includes('step="0.01"'));
  assert.ok(wishlistViewSource.includes('border-edge/40 bg-transparent'));
  assert.ok(wishlistViewSource.includes('viewSavedAppleMatch'));
  assert.ok(wishlistViewSource.includes('Add a target price from a result row when needed.'));
  assert.ok(wishlistViewSource.includes('max-h-[360px] overflow-y-auto'));
  assert.ok(wishlistViewSource.includes('Set target price for ${match.title}'));
  assert.ok(wishlistViewSource.includes('Store price: ${current}'));
  assert.ok(wishlistViewSource.includes('function priceHistorySummary(history)'));
  assert.ok(wishlistViewSource.includes('Latest ${formatAppleMoney(latest.price, latest.currency)}'));
  assert.ok(wishlistViewSource.includes('Lowest ${formatAppleMoney(lowest.price, lowest.currency)}'));
  assert.ok(wishlistViewSource.includes("entries.length === 1 ? 'snapshot' : 'snapshots'"));
  assert.ok(wishlistViewSource.includes('${sourceLabel} · ${appleType}'));
  assert.ok(wishlistViewSource.includes('${sourceLabel} · ${captureType}'));
  assert.ok(wishlistViewSource.includes("capture: 'Capture Inbox'"));
  assert.ok(wishlistViewSource.includes("ios_scanner_app: 'iOS scanner'"));
  assert.ok(wishlistViewSource.includes('function captureKindLabel(item)'));
  assert.ok(wishlistViewSource.includes('|| item?.object_type'));
  assert.ok(!wishlistViewSource.includes('Source: ${sourceLabel}'));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('Apple/iTunes · Movie')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('Capture Inbox · Barcode')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('iOS scanner · ISBN')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('Latest $7.99')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('Lowest $5.99')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('2 snapshots')"));
  assert.ok(adminShellBrowserSpecSource.includes("page.getByText('Apple current: $7.99')).toHaveCount(0)"));
  assert.ok(wishlistViewSource.includes("apiCall('get', `/wishlist/${item.id}/price-history?limit=8`)"));
  assert.ok(wishlistViewSource.includes('Price history'));
  assert.ok(wishlistViewSource.includes('function providerLabel(provider)'));
  assert.ok(wishlistViewSource.includes('function wishlistSourceSummary(item)'));
  assert.ok(wishlistViewSource.includes('function wishlistStoreUrl(item)'));
  assert.ok(wishlistViewSource.includes("apple_itunes: 'Apple/iTunes'"));
  assert.ok(wishlistViewSource.includes('TECHNICAL_IDENTIFIER_KEYS'));
  assert.ok(wishlistViewSource.includes('Open store'));
  assert.ok(wishlistViewSource.includes("['http:', 'https:'].includes(parsed.protocol)"));
  assert.ok(!wishlistViewSource.includes("[item.provider, item.provider_key].filter(Boolean).join(' ')"));
  assert.ok(adminShellBrowserSpecSource.includes('wishlist apple itunes search presents candidates and saves a selected result'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/apple-itunes/search'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/apple-itunes/save'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/apple-itunes/refresh-prices'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/apple-itunes/price-refresh-scheduler'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/apple-itunes/target-price-hits'));
  assert.ok(adminShellBrowserSpecSource.includes("targetHitPatchPayload?.status).toBe('ordered'"));
  assert.ok(adminShellBrowserSpecSource.includes('/api/wishlist/9001/price-history'));
  assert.ok(adminShellBrowserSpecSource.includes("expect(savePayload).toBeNull()"));
}));

results.push(run('mobile capture inbox foundation is scoped, routed, and reviewable', () => {
  assert.ok(migrationsSource.includes('Add mobile capture inbox foundation'));
  assert.ok(migrationsSource.includes('CREATE TABLE IF NOT EXISTS capture_items'));
  assert.ok(migrationsSource.includes("capture_type IN ('barcode', 'photo', 'ocr_text', 'manual_note')"));
  assert.ok(migrationsSource.includes("status IN ('new', 'reviewed', 'converted', 'discarded')"));
  assert.ok(migrationsSource.includes('idx_capture_items_library_status'));
  assert.ok(initSqlSource.includes('CREATE TABLE IF NOT EXISTS capture_items'));
  assert.ok(initSqlSource.includes("(104, 'Add mobile capture inbox foundation')"));
  assert.ok(captureItemsRoutesSource.includes("router.use('/capture-items', authenticateToken);"));
  assert.ok(captureItemsRoutesSource.includes("router.get('/capture-items'"));
  assert.ok(captureItemsRoutesSource.includes('const REVIEW_FILTERS'));
  assert.ok(captureItemsRoutesSource.includes('function captureReviewFilterCondition'));
  assert.ok(captureItemsRoutesSource.includes('review_filter: reviewFilter'));
  assert.ok(captureItemsRoutesSource.includes('review_counts'));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/upload-image'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/ocr-text'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/ocr-image'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/apply-ocr-candidate'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/lookup-matches'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/import-match'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/resolve-replay-conflict'"));
  assert.ok(captureItemsRoutesSource.includes('findStoredLookupMatch'));
  assert.ok(captureItemsRoutesSource.includes('function extractClientCaptureId'));
  assert.ok(captureItemsRoutesSource.includes('fetchCaptureItemByClientCaptureId'));
  assert.ok(captureItemsRoutesSource.includes('function buildReplayConflicts'));
  assert.ok(captureItemsRoutesSource.includes('function resolveReplayConflictReview'));
  assert.ok(captureItemsRoutesSource.includes('capture.replay_conflict.resolve'));
  assert.ok(captureItemsRoutesSource.includes('capture_replay_conflicts'));
  assert.ok(captureItemsRoutesSource.includes('replay_conflicts'));
  assert.ok(captureItemsRoutesSource.includes("'capture.idempotent_replay'"));
  assert.ok(captureItemsRoutesSource.includes("'capture.image.idempotent_replay'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.ocr.extract'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.ocr.image_extract'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.ocr.apply_candidate'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.lookup_matches'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.import_match'"));
  assert.ok(captureItemsRoutesSource.includes('capture_lookup_matches'));
  assert.ok(captureItemsRoutesSource.includes('selected_capture_lookup_match'));
  assert.ok(mediaRoutesSource.includes('router.lookupScannerBarcodeCandidates'));
  assert.ok(mediaRoutesSource.includes('async function importBarcodeMatchForRequest'));
  assert.ok(mediaRoutesSource.includes('router.importBarcodeMatchForRequest = importBarcodeMatchForRequest'));
  assert.ok(captureItemsRoutesSource.includes('readLocalUploadBuffer(shapedCurrent.image_path)'));
  assert.ok(captureItemsRoutesSource.includes('extractTextFromImageBuffer(imageBuffer'));
  assert.ok(captureItemsRoutesSource.includes("memoryUpload.single('image')"));
  assert.ok(captureItemsRoutesSource.includes("await uploadBuffer(req.file.buffer"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.image.upload'"));
  assert.ok(captureItemsRoutesSource.includes("router.post('/capture-items/:id/convert-wishlist'"));
  assert.ok(captureItemsRoutesSource.includes("await logActivity(req, 'capture.create'"));
  assert.ok(serverSource.includes("const captureItemsRouter = require('./routes/captureItems');"));
  assert.ok(serverSource.includes("app.use('/api', captureItemsRouter);"));
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items', method: 'GET' }), ['media:read']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/upload-image', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/ocr-text', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/ocr-image', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/apply-ocr-candidate', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/lookup-matches', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/import-match', method: 'POST' }), ['media:write']);
  assert.deepStrictEqual(getRequiredPatScopesForRequest({ originalUrl: '/api/capture-items/123/resolve-replay-conflict', method: 'POST' }), ['media:write']);
  assert.ok(openApiSource.includes('"/api/capture-items"'));
  assert.ok(openApiSource.includes('"review_filter"'));
  assert.ok(openApiSource.includes('"review_counts"'));
  assert.ok(openApiSource.includes('"/api/capture-items/upload-image"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/ocr-text"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/ocr-image"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/apply-ocr-candidate"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/lookup-matches"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/import-match"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/resolve-replay-conflict"'));
  assert.ok(openApiSource.includes('"CaptureReplayConflictResolveResponse"'));
  assert.ok(openApiSource.includes('"multipart/form-data"'));
  assert.ok(openApiSource.includes('"CaptureImageUploadResponse"'));
  assert.ok(openApiSource.includes('"CaptureOcrTextResponse"'));
  assert.ok(openApiSource.includes('"CaptureOcrImageResponse"'));
  assert.ok(openApiSource.includes('"CaptureOcrCandidateApplyResponse"'));
  assert.ok(openApiSource.includes('"CaptureLookupMatchesResponse"'));
  assert.ok(openApiSource.includes('"CaptureImportMatchResponse"'));
  assert.ok(openApiSource.includes('"client_capture_id"'));
  assert.ok(openApiSource.includes('"clientCaptureId"'));
  assert.ok(openApiSource.includes('"idempotency"'));
  assert.ok(openApiSource.includes('Existing capture item reused for a repeated client_capture_id'));
  assert.ok(openApiSource.includes('"replay_conflicts"'));
  assert.ok(openApiSource.includes('"/api/capture-items/{id}/convert-wishlist"'));
  assert.ok(openApiSource.includes('"CaptureItem"'));
  assert.ok(dashboardRoutingSource.includes("'library-capture'"));
  assert.ok(productEditionFrontendSource.includes("'library-capture'"));
  assert.ok(importViewSource.includes("{ id: 'capture', label: 'Capture Inbox'"));
  assert.ok(importViewSource.includes("onOpenCaptureInbox?.()"));
  assert.ok(sidebarNavSource.includes("activeWhen={['library-capture']}"));
  assert.ok(dashboardContentSource.includes("case 'library-capture'"));
  assert.ok(dashboardContentSource.includes('CaptureInboxView'));
  assert.ok(captureInboxViewSource.includes("apiCall('get', `/capture-items?${params.toString()}`)"));
  assert.ok(captureInboxViewSource.includes('const REVIEW_TABS'));
  assert.ok(captureInboxViewSource.includes("params.set('review_filter', reviewFilter)"));
  assert.ok(captureInboxViewSource.includes('reviewCounts'));
  assert.ok(captureInboxViewSource.includes('Capture review filter'));
  assert.ok(captureInboxViewSource.includes('Needs choice'));
  assert.ok(captureInboxViewSource.includes('Ready to add'));
  assert.ok(captureInboxViewSource.includes('No match'));
  assert.ok(captureInboxViewSource.includes('Missing details'));
  assert.ok(captureInboxViewSource.includes('Problems'));
  assert.ok(captureInboxViewSource.includes("apiCall('post', '/capture-items/upload-image'"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/ocr-text`"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/ocr-image`"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/apply-ocr-candidate`"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/lookup-matches`"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/import-match`"));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/resolve-replay-conflict`"));
  assert.ok(captureInboxViewSource.includes('Replay conflict'));
  assert.ok(captureInboxViewSource.includes('Use replayed values'));
  assert.ok(captureInboxViewSource.includes('OCR candidates'));
  assert.ok(captureInboxViewSource.includes('Read image text'));
  assert.ok(captureInboxViewSource.includes('Find matches'));
  assert.ok(captureInboxViewSource.includes('importLookupMatch'));
  assert.ok(captureInboxViewSource.includes('Capture lookup matches'));
  assert.ok(captureInboxViewSource.includes("apiCall('post', '/media/lookup/barcode'"));
  assert.ok(captureInboxViewSource.includes('reviewDecisionFromFormLookup'));
  assert.ok(captureInboxViewSource.includes('importFormLookupMatch'));
  assert.ok(captureInboxViewSource.includes('Scan results'));
  assert.ok(captureInboxViewSource.includes('Save and scan next'));
  assert.ok(captureInboxViewSource.includes('Batch scan'));
  assert.ok(captureInboxViewSource.includes('aria-label="Batch scan session"'));
  assert.ok(captureInboxViewSource.includes('batchStats'));
  assert.ok(captureInboxViewSource.includes('requestNextScan'));
  assert.ok(captureInboxViewSource.includes('startBatchScan'));
  assert.ok(captureInboxViewSource.includes('stopBatchScan'));
  assert.ok(captureInboxViewSource.includes('Batch scan stopped.'));
  assert.ok(captureInboxViewSource.includes('Add to library'));
  assert.ok(captureInboxViewSource.includes('findSafeExactIsbnMatch'));
  assert.ok(captureInboxViewSource.includes('Add exact ISBN'));
  assert.ok(captureInboxViewSource.includes('Exact ISBN match found. Adding it to the library.'));
  assert.ok(captureInboxViewSource.includes('Batch summary'));
  assert.ok(captureInboxViewSource.includes('lastBatchSummary'));
  assert.ok(captureInboxViewSource.includes('Review choices'));
  assert.ok(captureInboxViewSource.includes('Review no matches'));
  assert.ok(captureInboxViewSource.includes('Review scanner captures'));
  assert.ok(captureInboxViewSource.includes('SOURCE_FILTERS'));
  assert.ok(captureInboxViewSource.includes('isScannerCapture'));
  assert.ok(captureInboxViewSource.includes('Capture review reasons'));
  assert.ok(captureInboxViewSource.includes('item.review_reasons'));
  assert.ok(captureItemsRoutesSource.includes('source_filter'));
  assert.ok(captureItemsRoutesSource.includes('scannerSourceSql'));
  assert.ok(captureItemsRoutesSource.includes('buildCaptureReviewReasons'));
  assert.ok(captureItemsRoutesSource.includes('review_reasons'));
  assert.ok(captureInboxViewSource.includes('type="file"'));
  assert.ok(captureInboxViewSource.includes('detectBarcodeCapturePayloadFromFile'));
  assert.ok(captureInboxViewSource.includes('extractIdentifierCandidatesFromFile'));
  assert.ok(captureInboxViewSource.includes('inferBookBarcodeIdentifier'));
  assert.ok(captureInboxViewSource.includes('ISBN captured'));
  assert.ok(captureInboxViewSource.includes('aria-label="Scan barcode with camera"'));
  assert.ok(captureInboxViewSource.includes('capture="environment"'));
  assert.ok(captureInboxViewSource.includes('FixedPageShell'));
  assert.ok(captureInboxViewSource.includes('capture-page-body'));
  assert.ok(captureInboxViewSource.includes('scrollIntoView'));
  assert.ok(captureInboxViewSource.includes('posterUrl(item.image_path)'));
  assert.ok(captureInboxViewSource.includes("apiCall('post', `/capture-items/${item.id}/convert-wishlist`, {})"));
  assert.ok(captureInboxViewSource.includes('Capture Inbox'));
  assert.ok(activityFeedViewSource.includes("action.startsWith('capture.')"));
  assert.ok(activityFeedViewSource.includes('Capture added to Wishlist'));
  assert.ok(adminShellBrowserSpecSource.includes('/dashboard?tab=library-capture'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/capture-items'));
  assert.ok(adminShellBrowserSpecSource.includes('/api/media/lookup/barcode'));
  assert.ok(adminShellBrowserSpecSource.includes('Scan lookup results'));
  assert.ok(adminShellBrowserSpecSource.includes('Save and scan next'));
  assert.ok(adminShellBrowserSpecSource.includes('Batch scan'));
  assert.ok(adminShellBrowserSpecSource.includes('client_capture_id: clientCaptureId'));
  assert.ok(adminShellBrowserSpecSource.includes('retryPayload?.idempotent'));
  assert.ok(adminShellBrowserSpecSource.includes("conflictRetryPayload?.idempotency?.status"));
  assert.ok(captureImageOcrServiceSource.includes("form.append('file'"));
  assert.ok(captureImageOcrServiceSource.includes('extractOcrSpaceText'));
  assert.ok(integrationsServiceSource.includes('visionApiKey'));
}));

results.push(run('capture OCR candidate extraction normalizes reviewable ISBN UPC and ASIN values', () => {
  const parsed = buildCaptureOcrCandidates(`
    Back cover scan
    ISBN 0-553-57239-3
    UPC 0076783005990
    ASIN B000123456
  `);

  assert.ok(parsed.isbnCandidates.includes('9780553572391'));
  assert.ok(parsed.upcCandidates.includes('0076783005990'));
  assert.ok(parsed.asinCandidates.includes('B000123456'));
  assert.ok(parsed.candidates.some((candidate) => candidate.match_type === 'isbn' && candidate.barcode === '9780553572391' && candidate.media_type === 'book'));
  assert.ok(parsed.candidates.some((candidate) => candidate.match_type === 'ean' && candidate.barcode === '0076783005990'));
  assert.ok(parsed.candidates.some((candidate) => candidate.match_type === 'asin' && candidate.barcode === 'B000123456'));
}));

results.push(run('capture image OCR provider parsing preserves backend-owned OCR text', () => {
  assert.strictEqual(extractOcrSpaceText({
    ParsedResults: [
      { ParsedText: 'ISBN 0-553-57239-3' },
      { ParsedText: 'UPC 0076783005990' }
    ]
  }), 'ISBN 0-553-57239-3\nUPC 0076783005990');
  const fixtureConfig = buildOcrProviderConfig({ visionProvider: 'fixture', visionApiKey: '', visionApiUrl: '' });
  assert.strictEqual(fixtureConfig.preset, 'fixture');
  assert.strictEqual(fixtureConfig.provider, 'fixture');
  assert.strictEqual(typeof fixtureConfig.apiUrl, 'string');
}));

results.push(run('platform admin users view is no longer carried by Core frontend', () => {
  assert.ok(!dashboardContentSource.includes('AdminUsersView'));
  assert.ok(!dashboardContentSource.includes("case 'admin-users'"));
  assert.ok(!dashboardRoutingSource.includes("'admin-users'"));
  assert.ok(!sidebarNavSource.includes('All Members'));
}));

results.push(run('phase5 smoke scripts avoid tenant admin invite bootstrapping and cover platform boundary checks', () => {
  const platformBoundarySmokeSource = require('fs').readFileSync(require.resolve('./tenancy-platform-boundary-smoke'), 'utf8');
  const supportSessionSmokeSource = require('fs').readFileSync(require.resolve('./support-session-smoke'), 'utf8');
  const rbacRegressionSource = require('fs').readFileSync(require.resolve('./rbac-regression-check'), 'utf8');
  const backendPackageSource = require('fs').readFileSync(require.resolve('../package.json'), 'utf8');
  assert.ok(!fs.existsSync(path.resolve(__dirname, 'admin-space-control-smoke.js')));
  assert.ok(!backendPackageSource.includes('test:admin-space-control'));
  assert.ok(platformBoundarySmokeSource.includes('/api/admin/spaces'));
  assert.ok(platformBoundarySmokeSource.includes('blockedPlatformCreate'));
  assert.ok(platformBoundarySmokeSource.includes('createDirectSpace'));
  assert.ok(platformBoundarySmokeSource.includes('/api/spaces/${spaceId}/members'));
  assert.ok(platformBoundarySmokeSource.includes('/api/spaces/${spaceId}/invites'));
  assert.ok(platformBoundarySmokeSource.includes("expectStatus: 404"));
  assert.ok(!supportSessionSmokeSource.includes("admin.request('/api/admin/spaces'"));
  assert.ok(supportSessionSmokeSource.includes('createDetachedSpace'));
  assert.ok(supportSessionSmokeSource.includes('addSpaceMembership'));
  assert.ok(!rbacRegressionSource.includes('/api/admin/invites'));
  assert.ok(rbacRegressionSource.includes('/api/auth/scope'));
  assert.ok(!rbacRegressionSource.includes('/api/spaces/${targetSpaceId}/invites'));
  assert.ok(rbacRegressionSource.includes('Core admin activity route should stay outside the app boundary'));
  assert.ok(backendPackageSource.includes('"test:tenancy-platform-boundary": "node scripts/tenancy-platform-boundary-smoke.js"'));
  assert.ok(backendPackageSource.includes('"test:homelab-edition-boundary": "node scripts/homelab-edition-boundary-smoke.js"'));
  assert.ok(backendPackageSource.includes('"test:platform-edition-boundary": "node scripts/platform-edition-boundary-smoke.js"'));
}));

results.push(run('admin activity route is moved out of the Core platform control plane', () => {
  assert.ok(serverSource.includes("app.use('/api/admin/activity'"));
  assert.ok(serverSource.includes("app.use('/api/admin/loan-reminder-operations'"));
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/activity'"));
  assert.ok(!adminRoutesSource.includes("platformRouter.get('/loan-reminder-operations'"));
  assert.ok(!openApiSource.includes('"/api/admin/activity"'));
  assert.ok(!openApiSource.includes('"/api/admin/loan-reminder-operations"'));
}));

results.push(run('workspace-facing activity hides request-level diagnostics', () => {
  assert.ok(spacesRoutesSource.includes("al.action NOT LIKE 'request.%'"));
  assert.ok(spacesRoutesSource.includes("COALESCE(al.entity_type, '') <> 'http_request'"));
  assert.ok(dashboardRoutesSource.includes("al.action NOT LIKE 'request.%'"));
  assert.ok(dashboardRoutesSource.includes("COALESCE(al.entity_type, '') <> 'http_request'"));
  assert.ok(!adminRoutesSource.includes("al.action IN ('invite.claimed', 'request.validation.failed')"));
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
  assert.ok(structuredLogSmokeSharedSource.includes("STRUCTURED_LOG_SMOKE_FEATURE_KEY || 'metrics_enabled'"));
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
  assert.ok(!integrationsRoutesSource.includes("platformRouter.post('/admin/settings/integrations/test-logs'"));
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
  assert.ok(!dockerComposeSource.includes('LOG_EXPORT_SETTINGS_READ_ONLY'));
  assert.ok(ciComposeWriterSource.includes('LOG_EXPORT_BACKEND:'));
  assert.ok(ciComposeWriterSource.includes('LOG_EXPORT_SETTINGS_READ_ONLY:'));
  if (ciBuildComposeSource) {
    assert.ok(ciBuildComposeSource.includes('LOG_EXPORT_BACKEND: ${LOG_EXPORT_BACKEND:-off}'));
    assert.ok(ciBuildComposeSource.includes('LOG_EXPORT_SETTINGS_READ_ONLY: ${LOG_EXPORT_SETTINGS_READ_ONLY:-false}'));
  }
  assert.ok(logExportSource.includes('LOG_EXPORT_SETTINGS_READ_ONLY'));
}));

results.push(run('feature flags source includes external log export flag', () => {
  const featureFlagsSource = require('fs').readFileSync(require.resolve('../services/featureFlags'), 'utf8');
  assert.ok(featureFlagsSource.includes('external_log_export_enabled'));
}));

results.push(run('portability status source keeps readback redacted and restore guidance explicit', async () => {
  const parsed = parseDatabaseUrl('postgresql://collectz:super-secret@example-db:5432/library');
  assert.deepStrictEqual(parsed, {
    configured: true,
    host: 'example-db',
    port: '5432',
    database: 'library',
    user: 'collectz'
  });
  assert.ok(!JSON.stringify(parsed).includes('super-secret'));
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.ok(portabilityServiceSource.includes('restore_guidance'));
  assert.ok(portabilityServiceSource.includes('docs/wiki/08-Backup-and-Restore.md'));
  assert.ok(portabilityServiceSource.includes('provider_metadata'));
  assert.ok(portabilityServiceSource.includes('Uploaded images live in the configured uploads volume.'));
  assert.ok(portabilityServiceSource.includes('collectz.portability.export.v1'));
  assert.ok(portabilityServiceSource.includes('collectz.portability.csv.v1'));
  assert.ok(portabilityServiceSource.includes('upload_file_binaries: false'));
  assert.ok(portabilityServiceSource.includes('COLLECTZ_BACKUP_STATUS_PATH'));
  assert.ok(portabilityServiceSource.includes('backup_freshness'));
  assert.ok(portabilityServiceSource.includes('restore_rehearsal'));
  assert.ok(portabilityServiceSource.includes('Restore dry run'));
  assert.ok(portabilityServiceSource.includes('SECRET_URL_PARAM_PATTERN'));
  assert.ok(portabilityServiceSource.includes("formats: ['json', 'csv']"));
  assert.ok(portabilityServiceSource.includes('DIRECT_SPACE_TABLES'));
  assert.ok(portabilityServiceSource.includes('scopedTableClause'));
  assert.ok(portabilityServiceSource.includes('collectz-workspace-${scope.space_id'));
  const platformScope = normalizePortabilityScope();
  assert.deepStrictEqual(platformScope, { type: 'platform', space_id: null, label: 'Platform' });
  const workspaceScope = normalizePortabilityScope({ scope: 'workspace', spaceId: 42, spaceName: 'Main Space' });
  assert.deepStrictEqual(workspaceScope, { type: 'workspace', space_id: 42, label: 'Main Space' });
  const rehearsal = buildRestoreRehearsalReadback({
    databaseOk: true,
    storage: { configured: true },
    backupFreshness: {
      status: 'fresh',
      detail: 'Last successful backup was 1 hour ago.'
    },
    counts: [{ count: 2 }]
  });
  assert.strictEqual(rehearsal.destructive, false);
  assert.strictEqual(rehearsal.status, 'ready_for_manual_rehearsal');
  assert.ok(rehearsal.steps.some((step) => step.key === 'restore_dry_run' && step.status === 'manual'));
  const rehearsalNeedsAttention = buildRestoreRehearsalReadback({
    databaseOk: true,
    storage: { configured: true },
    backupFreshness: {
      status: 'not_configured',
      detail: 'No marker.'
    },
    counts: [{ count: 2 }]
  });
  assert.strictEqual(rehearsalNeedsAttention.status, 'needs_attention');
  const notConfigured = await getBackupFreshnessReadback({
    markerPath: '',
    now: new Date('2026-06-06T12:00:00.000Z')
  });
  assert.strictEqual(notConfigured.status, 'not_configured');
  assert.strictEqual(notConfigured.configured, false);
  const markerPath = path.join(os.tmpdir(), `collectz-backup-freshness-marker-${process.pid}.json`);
  try {
    await fs.promises.writeFile(markerPath, JSON.stringify({
      status: 'ok',
      last_success_at: '2026-06-06T06:00:00.000Z',
      backup_file: 'collectz_20260606T060000Z.sql.gz',
      size_bytes: 2048
    }));
    const fresh = await getBackupFreshnessReadback({
      markerPath,
      maxAgeHours: 24,
      now: new Date('2026-06-06T12:00:00.000Z')
    });
    assert.strictEqual(fresh.status, 'fresh');
    assert.strictEqual(fresh.backup_size, '2.0 KB');
    assert.strictEqual(fresh.age_hours, 6);
    const stale = await getBackupFreshnessReadback({
      markerPath,
      maxAgeHours: 4,
      now: new Date('2026-06-06T12:00:00.000Z')
    });
    assert.strictEqual(stale.status, 'stale');
    assert.ok(stale.detail.includes('4-hour freshness target'));
  } finally {
    await fs.promises.rm(markerPath, { force: true });
  }
  const redactionStats = { redacted: 0 };
  const redacted = redactPortableValue({
    title: 'Safe title',
    api_key: 'secret-key',
    nested: {
      launch_url: 'https://example.test/read?token=secret-token&id=1',
      checked_at: new Date('2026-06-01T12:00:00.000Z'),
      provider_item_id: 'safe-provider-id'
    }
  }, redactionStats);
  assert.strictEqual(redacted.title, 'Safe title');
  assert.strictEqual(redacted.api_key, '[redacted]');
  assert.strictEqual(redacted.nested.provider_item_id, 'safe-provider-id');
  assert.strictEqual(redacted.nested.launch_url, 'https://example.test/read?token=[redacted]&id=1');
  assert.strictEqual(redacted.nested.checked_at, '2026-06-01T12:00:00.000Z');
  assert.strictEqual(redactionStats.redacted, 2);
  const csvFiles = buildPortabilityCsvFiles({
    manifest: {
      format: 'collectz.portability.export.v1',
      generated_at: '2026-06-06T00:00:00.000Z',
      version: '3.15.2'
    },
    restore_guidance: ['Restore the database before copying uploaded files.'],
    uploads: {
      files: [{ path: 'covers/example.jpg', size: 1234, modified_at: '2026-06-06T00:00:00.000Z' }]
    },
    database: {
      tables: [
        {
          key: 'media',
          label: 'Library items',
          count: 1,
          rows: [{ id: 1, title: 'Example title' }]
        }
      ]
    }
  });
  assert.ok(csvFiles.some((file) => file.key === 'manifest' && file.filename.endsWith('-manifest.csv')));
  assert.ok(csvFiles.some((file) => file.key === 'uploads_manifest' && file.data.includes('covers/example.jpg')));
  const mediaCsv = csvFiles.find((file) => file.key === 'table:media');
  assert.ok(mediaCsv);
  assert.strictEqual(mediaCsv.row_count, 1);
  assert.ok(mediaCsv.data.includes('id,title'));
  assert.ok(mediaCsv.data.includes('1,Example title'));
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
