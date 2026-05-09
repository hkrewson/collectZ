import React from 'react';
import AdminActivityView from '../AdminActivityView';
import ImportViewComponent from '../ImportView';
import ProfileViewComponent from '../ProfileView';
import AdminUsersView from '../AdminUsersView';
import AdminMergeReviewView from '../AdminMergeReviewView';
import AdminSettingsView from '../AdminSettingsView';
import AdminIntegrationsView from '../AdminIntegrationsView';
import AdminSpacesView from '../AdminSpacesView';
import LibraryView from '../LibraryView';
import LibraryLoansView from '../LibraryLoansView';
import EventsView from '../EventsView';
import CollectiblesView from '../CollectiblesView';
import ArtView from '../ArtView';
import ForbiddenView from '../ForbiddenView';
import SpaceManagerView from '../SpaceManagerView';
import HelpView from '../HelpView';
import { getSafeHelpTab, isSupportHelpEnabled } from './productEdition';

const forcedMediaTypeByTab = {
  'library-movies': 'movie',
  'library-tv': 'tv',
  'library-books': 'book',
  'library-audio': 'audio',
  'library-games': 'game',
  'library-comics': 'comic_book'
};

export default function DashboardContent({
  activeTab,
  setActiveTab,
  user,
  onUserUpdate,
  featureFlags,
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
  Icons,
  Spinner,
  cx,
  activeLibrary,
  setUiSettings,
  activeIntegrationSection,
  setActiveIntegrationSection,
  spaces,
  activeSpace,
  activeSpaceId,
  activeMembershipRole,
  canManageActiveSpace,
  libraries,
  activeLibraryId,
  onSpaceSelect,
  onScopeRefresh,
  supportSession,
  onStartSupportSession,
  onEndSupportSession,
  scopeKey,
  supportSummary,
  onSupportSummaryRefresh,
  productEdition = 'platform'
}) {
  const [mergeReviewSeed, setMergeReviewSeed] = React.useState(null);
  const isAdminTab = String(activeTab || '').startsWith('admin-');
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes(String(user?.role || ''));
  const supportAdminAllowedTabs = new Set([
    'help',
    'profile',
    ...(supportHelpEnabled ? ['support-inbox'] : []),
    ...(supportSession?.active ? ['space-manage'] : [])
  ]);
  if (isAdminTab && user?.role !== 'admin') {
    return <ForbiddenView detail="Admin permissions are required to access this view." />;
  }

  if (user?.role === 'support_admin' && !supportAdminAllowedTabs.has(String(activeTab || ''))) {
    return <ForbiddenView detail="Support admins stay in the support surface by default and cannot browse tenant library data without a later approved support workflow." />;
  }

  switch (activeTab) {
    case 'help':
    case 'support-inbox':
      return (
        <HelpView
          apiCall={apiCall}
          onToast={showToast}
          user={user}
          activeSpace={activeSpace}
          activeLibrary={activeLibrary}
          supportSession={supportSession}
          onStartSupportSession={onStartSupportSession}
          onEndSupportSession={onEndSupportSession}
          Spinner={Spinner}
          Icons={Icons}
          supportSummary={supportSummary}
          onSupportSummaryRefresh={onSupportSummaryRefresh}
          initialTab={getSafeHelpTab(productEdition, supportStaffInEdition, activeTab === 'support-inbox' ? 'support' : 'guidance')}
          productEdition={productEdition}
        />
      );
    case 'library':
    case 'library-movies':
    case 'library-tv':
    case 'library-books':
    case 'library-audio':
    case 'library-games':
    case 'library-comics':
    case 'library-loans':
    case 'library-art':
    case 'library-collectibles':
    case 'library-events': {
      if ((activeTab === 'library-collectibles' || activeTab === 'library-art') && !featureFlags.collectibles_enabled) {
        return <ForbiddenView detail="Collectibles is currently disabled by feature flag." />;
      }
      if (activeTab === 'library-events' && !featureFlags.events_enabled) {
        return <ForbiddenView detail="Events is currently disabled by feature flag." />;
      }
      if (activeTab === 'library-art') {
        return <ArtView key={`art:${scopeKey}`} apiCall={apiCall} onToast={showToast} />;
      }
      if (activeTab === 'library-collectibles') {
        return <CollectiblesView key={`collectibles:${scopeKey}`} apiCall={apiCall} onToast={showToast} />;
      }
      if (activeTab === 'library-events') {
        return <EventsView key={`events:${scopeKey}`} apiCall={apiCall} onToast={showToast} currentUser={user} />;
      }
      if (activeTab === 'library-loans') {
        return (
          <LibraryLoansView
            key={`library-loans:${scopeKey}`}
            apiCall={apiCall}
            onToast={showToast}
            activeLibrary={activeLibrary}
            Icons={Icons}
            Spinner={Spinner}
          />
        );
      }
      return (
        <LibraryView
          key={`library:${activeTab}:${scopeKey}`}
          mediaItems={mediaItems}
          loading={mediaLoading}
          error={mediaError}
          pagination={mediaPagination}
          onRefresh={loadMedia}
          onToast={showToast}
          onOpen={addMedia}
          onEdit={editMedia}
          onDelete={deleteMedia}
          onBulkDelete={bulkDeleteMedia}
          onRating={rateMedia}
          apiCall={apiCall}
          forcedMediaType={forcedMediaTypeByTab[activeTab] || 'movie'}
          onFindPossibleDuplicates={user?.role === 'admin'
            ? (item) => {
                setMergeReviewSeed({
                  mediaId: Number(item?.id || 0) || null,
                  title: item?.title || 'Selected record'
                });
                setActiveTab('admin-merges');
              }
            : null}
          canWritePlex={user?.role === 'admin'}
        />
      );
    }
    case 'library-import':
      return (
        <ImportViewComponent
          key={`import:${scopeKey}`}
          apiCall={apiCall}
          onToast={showToast}
          onImported={() => loadMedia()}
          canImportPlex={user?.role === 'admin'}
          onQueueJob={upsertImportJob}
          importJobs={importJobs}
          apiUrl={apiUrl}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
          activeLibrary={activeLibrary}
        />
      );
    case 'library-import-review':
      return (
        <ImportViewComponent
          key={`import:${scopeKey}:legacy-review`}
          apiCall={apiCall}
          onToast={showToast}
          onImported={() => loadMedia()}
          canImportPlex={user?.role === 'admin'}
          onQueueJob={upsertImportJob}
          importJobs={importJobs}
          apiUrl={apiUrl}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
          activeLibrary={activeLibrary}
        />
      );
    case 'profile':
      return <ProfileViewComponent user={user} apiCall={apiCall} onToast={showToast} Spinner={Spinner} onUserUpdate={onUserUpdate} />;
    case 'space-manage':
      if (!activeMembershipRole && !canManageActiveSpace) {
        return <ForbiddenView detail="An active workspace membership or approved support session is required to open this workspace surface." />;
      }
      return (
        <SpaceManagerView
          key={`space-manage:${scopeKey}`}
          user={user}
          apiCall={apiCall}
          onToast={showToast}
          spaces={spaces}
          activeSpace={activeSpace}
          activeSpaceId={activeSpaceId}
          activeMembershipRole={activeMembershipRole}
          libraries={libraries}
          activeLibraryId={activeLibraryId}
          onSpaceSelect={onSpaceSelect}
          onScopeRefresh={onScopeRefresh}
          onSettingsChange={setUiSettings}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
        />
      );
    case 'admin-users':
      return <AdminUsersView apiCall={apiCall} onToast={showToast} currentUserId={user?.id} Icons={Icons} Spinner={Spinner} />;
    case 'admin-merges':
      return (
        <AdminMergeReviewView
          apiCall={apiCall}
          onToast={showToast}
          Spinner={Spinner}
          activeSpace={activeSpace}
          activeLibrary={activeLibrary}
          seededDiscovery={mergeReviewSeed}
          onDiscoverySeedConsumed={() => setMergeReviewSeed(null)}
        />
      );
    case 'admin-spaces':
      return (
        <AdminSpacesView
          apiCall={apiCall}
          onToast={showToast}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
          supportSession={supportSession}
          onStartSupportSession={onStartSupportSession}
          onEndSupportSession={onEndSupportSession}
        />
      );
    case 'admin-activity':
      return <AdminActivityView apiCall={apiCall} Spinner={Spinner} />;
    case 'admin-settings':
      return (
        <AdminSettingsView
          apiCall={apiCall}
          onToast={showToast}
          onSettingsChange={setUiSettings}
          Spinner={Spinner}
          title="Settings"
          description="Set shell defaults for this installation. Where workspace settings exist, they can override these choices."
          themeLabel="Theme"
          themeDescription="Choose whether collectZ follows your system appearance or stays fixed to a light or dark theme."
          visibleFlagKeys={productEdition === 'homelab' ? undefined : ['self_registration_enabled']}
          emptyFeatureFlagsMessage={null}
          emailDeliveryEndpoint={productEdition === 'homelab' ? null : '/admin/settings/email-delivery'}
        />
      );
    case 'admin-flags':
      return <AdminSettingsView apiCall={apiCall} onToast={showToast} onSettingsChange={setUiSettings} Spinner={Spinner} />;
    case 'admin-integrations':
      return (
        <AdminIntegrationsView
          apiCall={apiCall}
          onToast={showToast}
          onQueueJob={upsertImportJob}
          Spinner={Spinner}
          cx={cx}
          section={activeIntegrationSection}
          onSectionChange={setActiveIntegrationSection}
          title="Integrations"
          includeRuntimeSections={productEdition !== 'homelab'}
          includeValuationSections={productEdition !== 'homelab'}
          visibleSections={productEdition === 'homelab'
            ? ['audio', 'barcode', 'books', 'cwa', 'comics', 'games', 'kavita', 'plex', 'tmdb']
            : ['audio', 'barcode', 'books', 'cwa', 'comics', 'pricecharting', 'ebay', 'games', 'kavita', 'plex', 'tmdb', 'logs', 'metrics']}
        />
      );
    default:
      return null;
  }
}
