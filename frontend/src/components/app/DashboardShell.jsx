import React from 'react';
import SidebarNav from '../SidebarNav';
import CollectzMark from '../CollectzMark';
import DashboardContent from './DashboardContent';
import SupportSessionBanner from './SupportSessionBanner';
import { DEFAULT_INTEGRATION_SECTION } from './dashboardRouting';
import { ImportStatusDock, Toast, Icons, Spinner, cx } from './AppPrimitives';
import { getSafeDashboardTab, isLocalProductEdition, isSupportHelpEnabled, SUPPORT_STAFF_ROLE } from './productEdition';

const MOBILE_HEADER_TITLES = {
  dashboard: 'Dashboard',
  help: 'Help',
  'support-inbox': 'Support Inbox',
  library: 'Library',
  'library-movies': 'Movies',
  'library-tv': 'TV',
  'library-books': 'Books',
  'library-audio': 'Audio',
  'library-games': 'Games',
  'library-comics': 'Comics',
  'library-saved-views': 'Saved Views',
  'library-wishlist': 'Wishlist',
  'library-capture': 'Capture Inbox',
  'library-loans': 'Loans',
  'library-art': 'Art',
  'library-collectibles': 'Collectibles',
  'library-events': 'Events',
  'library-import': 'Import',
  'library-import-review': 'Import',
  profile: 'Profile',
  'space-manage': 'Workspace',
  'admin-merge-review': 'Merge Review',
  'admin-settings': 'Platform Settings',
  'admin-integrations': 'Platform Runtime',
  'admin-activity': 'Platform Activity',
  'admin-spaces': 'All Workspaces',
  'admin-users': 'All Members',
  'admin-feature-flags': 'Feature Flags'
};

const MOBILE_HEADER_ICONS = {
  dashboard: Icons.Gauge,
  library: Icons.Library,
  'library-movies': Icons.Clapper,
  'library-tv': Icons.Tv,
  'library-books': Icons.BookOpen,
  'library-audio': Icons.MusicNote,
  'library-games': Icons.Gamepad,
  'library-comics': Icons.Speech,
  'library-saved-views': Icons.Star,
  'library-wishlist': Icons.Star,
  'library-capture': Icons.InboxTray,
  'library-loans': Icons.Handoff,
  'library-art': Icons.Palette,
  'library-collectibles': Icons.BoxOpen,
  'library-events': Icons.Calendar,
  'library-import': Icons.Upload,
  'library-import-review': Icons.Upload,
  help: Icons.Library,
  'support-inbox': Icons.Users,
  profile: Icons.Profile,
  'space-manage': Icons.Users,
  'admin-merge-review': Icons.List,
  'admin-settings': Icons.Settings,
  'admin-integrations': Icons.Integrations,
  'admin-activity': Icons.Activity,
  'admin-spaces': Icons.Users,
  'admin-users': Icons.Users,
  'admin-feature-flags': Icons.Settings
};

function getMobileHeaderTitle(activeTab, productEdition) {
  const tab = String(activeTab || '');
  if (isLocalProductEdition(productEdition) && tab === 'admin-settings') return 'Settings';
  if (isLocalProductEdition(productEdition) && tab === 'admin-integrations') return 'Integrations';
  return MOBILE_HEADER_TITLES[tab] || 'Dashboard';
}

function getMobileHeaderIcon(activeTab) {
  return MOBILE_HEADER_ICONS[String(activeTab || '')] || CollectzMark;
}

export default function DashboardShell({
  user,
  onUserUpdate,
  activeTab,
  setActiveTab,
  supportSession,
  canManageActiveSpace,
  spaces,
  activeSpaceId,
  handleSpaceSelect,
  productEdition,
  platformBridgeEnabled = false,
  featureFlags,
  setActiveIntegrationSection,
  logout,
  collapsed,
  pinnedExpanded,
  setPinnedExpanded,
  mobileNavOpen,
  setMobileNavOpen,
  appVersion,
  libraries,
  activeLibraryId,
  handleLibrarySelect,
  activeMembershipRole,
  supportSummary,
  activeSpace,
  activeLibrary,
  endSupportSession,
  apiCall,
  showToast,
  mediaItems,
  mediaLoading,
  mediaError,
  mediaPagination,
  loadMedia,
  addMedia,
  editMedia,
  deleteMedia,
  bulkDeleteMedia,
  rateMedia,
  upsertImportJob,
  importJobs,
  apiUrl,
  setUiSettings,
  activeIntegrationSection,
  libraryReviewFilter,
  setLibraryReviewFilter,
  scopeKey,
  loadAuthScope,
  startSupportSession,
  loadSupportSummary,
  dismissImportJob,
  toast,
  setToast
}) {
  const desktopNavExpanded = !collapsed;
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const supportStaffInEdition = supportHelpEnabled && platformBridgeEnabled && ['admin', SUPPORT_STAFF_ROLE].includes(String(user?.role || ''));
  const supportSessionActiveInEdition = supportHelpEnabled && platformBridgeEnabled && Boolean(supportSession?.active);
  const mobileHeaderTitle = getMobileHeaderTitle(activeTab, productEdition);
  const MobileHeaderIcon = getMobileHeaderIcon(activeTab);

  return (
    <div className="flex h-dvh overflow-hidden bg-void">
      <SidebarNav
        user={user}
        activeTab={activeTab}
        onSelect={async (nextTab) => {
          if (
            nextTab === 'space-manage'
            && !supportSessionActiveInEdition
            && !supportStaffInEdition
            && !canManageActiveSpace
          ) {
            const fallbackManageableSpace = spaces.find((space) => ['owner', 'admin'].includes(String(space?.membership_role || '')));
            if (fallbackManageableSpace && Number(fallbackManageableSpace.id) !== Number(activeSpaceId || 0)) {
              await handleSpaceSelect(fallbackManageableSpace.id, { silent: true });
            }
          }
          setLibraryReviewFilter?.(null);
          setActiveTab(getSafeDashboardTab(productEdition, nextTab, {
            userRole: user?.role,
            supportSessionActive: supportSessionActiveInEdition,
            canManageActiveSpace,
            showCollectibles: featureFlags.collectibles_enabled,
            showEvents: featureFlags.events_enabled,
            platformBridgeEnabled
          }));
          if (nextTab !== 'admin-integrations') setActiveIntegrationSection(DEFAULT_INTEGRATION_SECTION);
        }}
        onLogout={logout}
        collapsed={collapsed}
        pinnedExpanded={pinnedExpanded}
        onToggle={() => setPinnedExpanded((prev) => !prev)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        appVersion={appVersion}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibrarySelect={handleLibrarySelect}
        canManageActiveSpace={canManageActiveSpace}
        activeMembershipRole={activeMembershipRole}
        supportSessionActive={supportSessionActiveInEdition}
        showCollectibles={featureFlags.collectibles_enabled}
        showEvents={featureFlags.events_enabled}
        supportBadgeCount={supportStaffInEdition ? supportSummary.open : null}
        productEdition={productEdition}
        platformBridgeEnabled={platformBridgeEnabled}
      />

      <div className={cx('flex-1 flex min-h-0 flex-col min-w-0 transition-all duration-300', desktopNavExpanded ? 'lg:ml-56' : 'lg:ml-16')}>
        <div
          className="sticky top-0 z-30 flex items-center gap-3 border-b border-edge bg-void/95 px-4 py-2.5 backdrop-blur lg:hidden"
          data-testid="mobile-app-header"
        >
          <button
            onClick={() => setMobileNavOpen(true)}
            className="btn-icon h-10 w-10 shrink-0"
            aria-label={`Open navigation, ${mobileHeaderTitle}`}
            aria-expanded={mobileNavOpen}
            data-testid="mobile-nav-toggle"
          >
            <MobileHeaderIcon className="h-6 w-6 text-gold" title="" />
          </button>
          <div id="mobile-shell-toolbar-slot" className="min-w-0 flex-1" />
          <p className="sr-only" data-testid="mobile-app-title">{mobileHeaderTitle}</p>
        </div>

        <SupportSessionBanner
          user={user}
          productEdition={productEdition}
          supportSession={supportSession}
          libraries={libraries}
          activeLibrary={activeLibrary}
          activeLibraryId={activeLibraryId}
          handleLibrarySelect={handleLibrarySelect}
          endSupportSession={endSupportSession}
          Icons={Icons}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <DashboardContent
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            user={user}
            onUserUpdate={onUserUpdate}
            featureFlags={featureFlags}
            apiCall={apiCall}
            showToast={showToast}
            mediaItems={mediaItems}
            mediaLoading={mediaLoading}
            mediaError={mediaError}
            mediaPagination={mediaPagination}
            loadMedia={loadMedia}
            addMedia={addMedia}
            editMedia={editMedia}
            deleteMedia={deleteMedia}
            bulkDeleteMedia={bulkDeleteMedia}
            rateMedia={rateMedia}
            upsertImportJob={upsertImportJob}
            importJobs={importJobs}
            apiUrl={apiUrl}
            Icons={Icons}
            Spinner={Spinner}
            cx={cx}
            activeLibrary={activeLibrary}
            setUiSettings={setUiSettings}
            activeIntegrationSection={activeIntegrationSection}
            setActiveIntegrationSection={setActiveIntegrationSection}
            libraryReviewFilter={libraryReviewFilter}
            setLibraryReviewFilter={setLibraryReviewFilter}
            spaces={spaces}
            activeSpace={activeSpace}
            activeSpaceId={activeSpaceId}
            activeMembershipRole={activeMembershipRole}
            canManageActiveSpace={canManageActiveSpace}
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onSpaceSelect={handleSpaceSelect}
            onScopeRefresh={loadAuthScope}
            supportSession={supportSession}
            onStartSupportSession={startSupportSession}
            onEndSupportSession={endSupportSession}
            scopeKey={scopeKey}
            supportSummary={supportSummary}
            onSupportSummaryRefresh={loadSupportSummary}
            productEdition={productEdition}
            platformBridgeEnabled={platformBridgeEnabled}
          />
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
