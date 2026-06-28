import React from 'react';
import ImportViewComponent from '../ImportView';
import ProfileViewComponent from '../ProfileView';
import AdminMergeReviewView from '../AdminMergeReviewView';
import AdminSettingsView from '../AdminSettingsView';
import AdminIntegrationsView from '../AdminIntegrationsView';
import DashboardCommandCenterView from '../DashboardCommandCenterView';
import LibraryView from '../LibraryView';
import LibraryLoansView from '../LibraryLoansView';
import WishlistView from '../WishlistView';
import CaptureInboxView from '../CaptureInboxView';
import EventsView from '../EventsView';
import CollectiblesView from '../CollectiblesView';
import ArtView from '../ArtView';
import ForbiddenView from '../ForbiddenView';
import SpaceManagerView from '../SpaceManagerView';
import HelpView from '../HelpView';
import { getSafeHelpTab, isLocalProductEdition, isSupportHelpEnabled, SUPPORT_STAFF_ROLE } from './productEdition';

const forcedMediaTypeByTab = {
  'library-movies': 'movie',
  'library-tv': 'tv',
  'library-books': 'book',
  'library-audio': 'audio',
  'library-games': 'game',
  'library-comics': 'comic_book'
};

const libraryTitleByTab = {
  library: 'Library',
  'library-movies': 'Movies',
  'library-tv': 'TV',
  'library-books': 'Books',
  'library-audio': 'Audio',
  'library-games': 'Games',
  'library-comics': 'Comics'
};

const savedViewLibraryTabByMediaType = {
  movie: 'library-movies',
  tv: 'library-tv',
  tv_series: 'library-tv',
  book: 'library-books',
  audio: 'library-audio',
  game: 'library-games',
  comic_book: 'library-comics'
};

const savedViewMediaLabel = {
  movie: 'Movies',
  tv: 'TV',
  tv_series: 'TV',
  book: 'Books',
  audio: 'Audio',
  game: 'Games',
  comic_book: 'Comics'
};

function SavedLibraryViewsView({ apiCall, onToast, onOpenView, Spinner }) {
  const [views, setViews] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    const loadViews = async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await apiCall('get', '/libraries/saved-views');
        const nextViews = Array.isArray(payload?.views) ? payload.views : [];
        if (!cancelled) setViews(nextViews);
      } catch (err) {
        const message = err?.response?.data?.error || 'Failed to load saved views';
        if (!cancelled) {
          setError(message);
          onToast?.(message, 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadViews();
    return () => {
      cancelled = true;
    };
  }, [apiCall, onToast]);

  const groupedViews = React.useMemo(() => {
    const groups = new Map();
    for (const view of views) {
      const mediaType = String(view.media_type || view.scope || 'movie');
      const label = savedViewMediaLabel[mediaType] || mediaType;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(view);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [views]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-abyss">
      <div className="shrink-0 border-b border-edge bg-abyss px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="section-title">Saved Views</h1>
            <p className="mt-1 text-sm text-ghost">Reusable Library filters for this workspace and library.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => onOpenView?.({ media_type: 'movie' })}>
            Open Movies
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-ghost"><Spinner size={18} /></div>
        ) : error ? (
          <div className="rounded-lg border border-err/30 bg-err/10 p-4 text-sm text-err">{error}</div>
        ) : groupedViews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-edge bg-raised/40 p-6 text-sm text-ghost">
            No saved views yet. Save one from a Library header to make it available here.
          </div>
        ) : (
          <div className="space-y-5">
            {groupedViews.map(([label, group]) => (
              <section key={label} className="space-y-2">
                <h2 className="text-sm font-semibold text-dim">{label}</h2>
                <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-raised/50">
                  {group.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/40"
                      onClick={() => onOpenView?.(view)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{view.name}</p>
                        <p className="mt-1 text-xs text-ghost">
                          {view.updated_at || view.updatedAt ? `Updated ${new Date(view.updated_at || view.updatedAt).toLocaleDateString()}` : 'Saved view'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-accent">Open</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
  libraryReviewFilter,
  setLibraryReviewFilter,
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
  productEdition = 'platform',
  platformBridgeEnabled = false
}) {
  const [mergeReviewSeed, setMergeReviewSeed] = React.useState(null);
  const [timelineFocus, setTimelineFocus] = React.useState(null);
  const [pendingLibrarySavedViewId, setPendingLibrarySavedViewId] = React.useState('');
  const [plexWritebackSettings, setPlexWritebackSettings] = React.useState({ ratingEnabled: false, watchStateEnabled: false });
  const isAdminTab = String(activeTab || '').startsWith('admin-');
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const localRuntime = isLocalProductEdition(productEdition);
  const coreRuntime = localRuntime || !platformBridgeEnabled;
  const bridgeSupportEnabled = false;
  const supportStaffInEdition = supportHelpEnabled && ['admin', SUPPORT_STAFF_ROLE].includes(String(user?.role || ''));
  const supportAdminAllowedTabs = new Set([
    'help',
    'profile',
    ...(bridgeSupportEnabled && supportSession?.active ? ['space-manage'] : [])
  ]);

  React.useEffect(() => {
    let active = true;
    if (user?.role !== 'admin') {
      setPlexWritebackSettings({ ratingEnabled: false, watchStateEnabled: false });
      return () => {
        active = false;
      };
    }
    apiCall('get', '/admin/settings/integrations')
      .then((data) => {
        if (!active) return;
        setPlexWritebackSettings({
          ratingEnabled: Boolean(data?.plexWritebackSettings?.ratingEnabled),
          watchStateEnabled: Boolean(data?.plexWritebackSettings?.watchStateEnabled)
        });
      })
      .catch(() => {
        if (active) setPlexWritebackSettings({ ratingEnabled: false, watchStateEnabled: false });
      });
    return () => {
      active = false;
    };
  }, [apiCall, scopeKey, user?.role]);

  if (isAdminTab && user?.role !== 'admin') {
    return <ForbiddenView detail="Admin permissions are required to access this view." />;
  }

  if (user?.role === SUPPORT_STAFF_ROLE && !supportAdminAllowedTabs.has(String(activeTab || ''))) {
    return <ForbiddenView detail="Support admins stay in the support surface by default and cannot browse tenant library data without a later approved support workflow." />;
  }

  const handleTimelineNavigate = (target = {}) => {
    if (target.integrationSection) setActiveIntegrationSection?.(target.integrationSection);
    if (target.focus) {
      setTimelineFocus({
        ...target.focus,
        createdAt: Date.now()
      });
    }
    if (target.tab) setActiveTab(target.tab);
  };

  switch (activeTab) {
    case 'dashboard':
      return (
        <DashboardCommandCenterView
          key={`dashboard:${scopeKey}`}
          apiCall={apiCall}
          onToast={showToast}
          setActiveTab={setActiveTab}
          setActiveIntegrationSection={setActiveIntegrationSection}
          setLibraryReviewFilter={setLibraryReviewFilter}
          activeSpace={activeSpace}
          activeLibrary={activeLibrary}
          Icons={Icons}
          Spinner={Spinner}
        />
      );
    case 'help':
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
          initialTab={getSafeHelpTab(productEdition, supportStaffInEdition, 'guidance')}
          productEdition={productEdition}
          supportRequestsEnabled={false}
        />
      );
    case 'library':
    case 'library-movies':
    case 'library-tv':
    case 'library-books':
    case 'library-audio':
    case 'library-games':
    case 'library-comics':
    case 'library-saved-views':
    case 'library-wishlist':
    case 'library-capture':
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
        return <ArtView key={`art:${scopeKey}`} apiCall={apiCall} onToast={showToast} focusTarget={timelineFocus?.entityType === 'art' ? timelineFocus : null} />;
      }
      if (activeTab === 'library-collectibles') {
        return <CollectiblesView key={`collectibles:${scopeKey}`} apiCall={apiCall} onToast={showToast} focusTarget={timelineFocus?.entityType === 'collectible' ? timelineFocus : null} />;
      }
      if (activeTab === 'library-events') {
        return <EventsView key={`events:${scopeKey}`} apiCall={apiCall} onToast={showToast} currentUser={user} focusTarget={timelineFocus?.entityType === 'event' ? timelineFocus : null} />;
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
      if (activeTab === 'library-wishlist') {
        return (
          <WishlistView
            key={`library-wishlist:${scopeKey}`}
            apiCall={apiCall}
            onToast={showToast}
            activeLibrary={activeLibrary}
            Icons={Icons}
            Spinner={Spinner}
          />
        );
      }
      if (activeTab === 'library-capture') {
        return (
          <CaptureInboxView
            key={`library-capture:${scopeKey}`}
            apiCall={apiCall}
            onToast={showToast}
            activeLibrary={activeLibrary}
            Icons={Icons}
            Spinner={Spinner}
          />
        );
      }
      if (activeTab === 'library-saved-views') {
        return (
          <SavedLibraryViewsView
            key={`library-saved-views:${scopeKey}`}
            apiCall={apiCall}
            onToast={showToast}
            Spinner={Spinner}
            onOpenView={(view) => {
              const targetTab = savedViewLibraryTabByMediaType[String(view?.media_type || view?.scope || 'movie')] || 'library-movies';
              setPendingLibrarySavedViewId(view?.id ? String(view.id) : '');
              setActiveTab(targetTab);
            }}
          />
        );
      }
      return (
        <LibraryView
          key={`library:${activeTab}:${scopeKey}:${libraryReviewFilter?.type || 'none'}:${libraryReviewFilter?.createdAt || 0}:${pendingLibrarySavedViewId || 'none'}`}
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
          forcedMediaType={activeTab === 'library' ? 'all' : forcedMediaTypeByTab[activeTab] || 'movie'}
          title={libraryTitleByTab[activeTab] || 'Library'}
          reviewFilter={activeTab === 'library' ? libraryReviewFilter : null}
          onClearReviewFilter={() => setLibraryReviewFilter?.(null)}
          focusTarget={timelineFocus?.entityType === 'media' ? timelineFocus : null}
          initialSavedViewId={pendingLibrarySavedViewId}
          onSavedViewApplied={() => setPendingLibrarySavedViewId('')}
          onFindPossibleDuplicates={user?.role === 'admin'
            ? (item) => {
                setMergeReviewSeed({
                  mediaId: Number(item?.id || 0) || null,
                  title: item?.title || 'Selected record'
                });
                setActiveTab('admin-merges');
              }
            : null}
          canWritePlex={user?.role === 'admin' ? plexWritebackSettings : false}
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
          onOpenCaptureInbox={() => setActiveTab('library-capture')}
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
          onOpenCaptureInbox={() => setActiveTab('library-capture')}
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
          onTimelineNavigate={handleTimelineNavigate}
        />
      );
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
    case 'admin-settings':
      return (
        <AdminSettingsView
          apiCall={apiCall}
          onToast={showToast}
          onSettingsChange={setUiSettings}
          Spinner={Spinner}
          title="Settings"
          description="Configure local app defaults, available library features, and backup/export readback for this install."
          themeLabel="Theme"
          themeDescription="Choose the default appearance for this install."
          visibleFlagKeys={coreRuntime ? undefined : ['self_registration_enabled']}
          emptyFeatureFlagsMessage={null}
          emailDeliveryEndpoint={null}
          analyticsEndpoint={null}
          portabilityEndpoint="/admin/settings/portability"
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
          includeRuntimeSections={!coreRuntime}
          includeValuationSections={false}
          visibleSections={coreRuntime
            ? ['audio', 'barcode', 'books', 'cwa', 'comics', 'games', 'kavita', 'plex', 'tmdb']
            : ['logs', 'metrics']}
        />
      );
    default:
      return null;
  }
}
