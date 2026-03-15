import React from 'react';
import AdminActivityView from '../AdminActivityView';
import ImportViewComponent from '../ImportView';
import AdminFeatureFlagsView from '../AdminFeatureFlagsView';
import ProfileViewComponent from '../ProfileView';
import AdminUsersView from '../AdminUsersView';
import AdminSettingsView from '../AdminSettingsView';
import AdminIntegrationsView from '../AdminIntegrationsView';
import ImportReviewView from '../ImportReviewView';
import LibraryView from '../LibraryView';
import EventsView from '../EventsView';
import CollectiblesView from '../CollectiblesView';
import ForbiddenView from '../ForbiddenView';
import SpaceManagerView from '../SpaceManagerView';

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
  user,
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
  rateMedia,
  upsertImportJob,
  importJobs,
  apiUrl,
  Icons,
  Spinner,
  cx,
  activeLibrary,
  importReviewEnabled,
  loadImportReviewPendingCount,
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
  onScopeRefresh,
  onSpaceSelect,
  scopeKey
}) {
  const isAdminTab = String(activeTab || '').startsWith('admin-');

  if (isAdminTab && user?.role !== 'admin') {
    return <ForbiddenView detail="Admin permissions are required to access this view." />;
  }

  switch (activeTab) {
    case 'library':
    case 'library-movies':
    case 'library-tv':
    case 'library-books':
    case 'library-audio':
    case 'library-games':
    case 'library-comics':
    case 'library-collectibles':
    case 'library-events': {
      if (activeTab === 'library-collectibles' && !featureFlags.collectibles_enabled) {
        return <ForbiddenView detail="Collectibles is currently disabled by feature flag." />;
      }
      if (activeTab === 'library-events' && !featureFlags.events_enabled) {
        return <ForbiddenView detail="Events is currently disabled by feature flag." />;
      }
      if (activeTab === 'library-collectibles') {
        return <CollectiblesView key={`collectibles:${scopeKey}`} apiCall={apiCall} onToast={showToast} />;
      }
      if (activeTab === 'library-events') {
        return <EventsView key={`events:${scopeKey}`} apiCall={apiCall} onToast={showToast} />;
      }
      return (
        <LibraryView
          key={`library:${activeTab}:${scopeKey}`}
          mediaItems={mediaItems}
          loading={mediaLoading}
          error={mediaError}
          pagination={mediaPagination}
          onRefresh={loadMedia}
          onOpen={addMedia}
          onEdit={editMedia}
          onDelete={deleteMedia}
          onRating={rateMedia}
          apiCall={apiCall}
          forcedMediaType={forcedMediaTypeByTab[activeTab] || 'movie'}
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
      if (!importReviewEnabled) {
        return (
          <ImportViewComponent
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
      }
      return (
        <ImportReviewView
          key={`import-review:${scopeKey}`}
          apiCall={apiCall}
          onToast={(message, type = 'ok') => {
            showToast(message, type);
            loadImportReviewPendingCount();
          }}
        />
      );
    case 'profile':
      return <ProfileViewComponent user={user} apiCall={apiCall} onToast={showToast} Spinner={Spinner} />;
    case 'space-manage':
      if (!canManageActiveSpace) {
        return <ForbiddenView detail="Space owner, space admin, or global admin permissions are required to manage the active space." />;
      }
      return (
        <SpaceManagerView
          user={user}
          apiCall={apiCall}
          onToast={showToast}
          spaces={spaces}
          activeSpace={activeSpace}
          activeSpaceId={activeSpaceId}
          activeMembershipRole={activeMembershipRole}
          libraries={libraries}
          activeLibraryId={activeLibraryId}
          onScopeRefresh={onScopeRefresh}
          onSpaceSelect={onSpaceSelect}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
        />
      );
    case 'admin-users':
      return <AdminUsersView apiCall={apiCall} onToast={showToast} currentUserId={user?.id} Icons={Icons} Spinner={Spinner} cx={cx} />;
    case 'admin-activity':
      return <AdminActivityView apiCall={apiCall} Spinner={Spinner} />;
    case 'admin-settings':
      return <AdminSettingsView apiCall={apiCall} onToast={showToast} onSettingsChange={setUiSettings} Spinner={Spinner} />;
    case 'admin-flags':
      return <AdminFeatureFlagsView apiCall={apiCall} onToast={showToast} Spinner={Spinner} cx={cx} />;
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
        />
      );
    default:
      return null;
  }
}
