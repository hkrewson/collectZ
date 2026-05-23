import React from 'react';
import SidebarNav from '../SidebarNav';
import CollectzMark from '../CollectzMark';
import DashboardContent from './DashboardContent';
import SupportSessionBanner from './SupportSessionBanner';
import { DEFAULT_INTEGRATION_SECTION } from './dashboardRouting';
import { ImportStatusDock, Toast, Icons, Spinner, cx } from './AppPrimitives';
import { getSafeDashboardTab, isSupportHelpEnabled } from './productEdition';

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
  const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes(String(user?.role || ''));
  const supportSessionActiveInEdition = supportHelpEnabled && Boolean(supportSession?.active);
  const adminWithoutSupportLane = user?.role === 'admin' && !supportSessionActiveInEdition;

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
            showEvents: featureFlags.events_enabled
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
      />

      <div className={cx('flex-1 flex min-h-0 flex-col min-w-0 transition-all duration-300', desktopNavExpanded ? 'lg:ml-56' : 'lg:ml-16')}>
        <div
          className="sticky top-0 z-30 flex items-center gap-3 border-b border-edge bg-void/95 px-4 py-3 backdrop-blur lg:hidden"
          data-testid="mobile-app-header"
        >
          <button
            onClick={() => setMobileNavOpen(true)}
            className="btn-icon"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
          >
            <Icons.Menu />
          </button>
          <CollectzMark className="h-6 w-6 shrink-0 text-gold" title="" />
          <div className="min-w-0">
            <div className="font-display text-lg tracking-wider text-gold leading-none">COLLECTZ</div>
            <div className="text-[11px] text-ghost mt-1 truncate">
              {adminWithoutSupportLane
                ? 'Admin'
                : supportStaffInEdition
                  ? 'Support'
                  : `${activeSpace?.name || 'No current workspace'}${activeLibrary ? ` / ${activeLibrary.name}` : ''}`}
            </div>
          </div>
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
          />
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
