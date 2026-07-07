import { useCallback, useEffect, useMemo, useState } from 'react';
import appMeta from './app-meta.json';
import AuthPageView from './components/AuthPage';
import DashboardShell from './components/app/DashboardShell';
import NowPlayingView from './components/NowPlayingView';
import { routeFromPath, Spinner, Icons, cx } from './components/app/AppPrimitives';
import {
  appRouteUrl,
  dashboardUrl,
  readDashboardStateFromUrl,
  selectDashboardTabValue
} from './components/app/dashboardRouting';
import useApiClient from './components/app/hooks/useApiClient';
import useImportJobPolling from './components/app/hooks/useImportJobPolling';
import useSessionBootstrap from './components/app/hooks/useSessionBootstrap';
import useMediaApi from './components/app/hooks/useMediaApi';
import useRootAppearance from './components/app/hooks/useRootAppearance';
import { readFrontendEnv } from './components/app/frontendEnv';
import {
  getSafeDashboardTab,
  isLocalProductEdition,
  isSupportHelpEnabled,
  LEGACY_PRODUCT_FIELD,
  normalizeProductEdition,
  SUPPORT_STAFF_ROLE
} from './components/app/productEdition';

const APP_VERSION = readFrontendEnv('VITE_APP_VERSION', appMeta.frontend || appMeta.version || 'unknown');

export default function App() {
  const initialDashboardState = readDashboardStateFromUrl();
  const [route, setRoute] = useState(routeFromPath(window.location.pathname));
  const [activeTab, setActiveTab] = useState(initialDashboardState.tab);
  const [activeIntegrationSection, setActiveIntegrationSection] = useState(initialDashboardState.integrationSection);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  const [uiSettings, setUiSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [libraryReviewFilter, setLibraryReviewFilter] = useState(null);
  const [featureFlags, setFeatureFlags] = useState({
    events_enabled: null,
    collectibles_enabled: null
  });
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'ok') => setToast({ message, type }), []);
  const { apiCall, apiUrl } = useApiClient();
  const { user, setUser, authChecked, setAuthChecked } = useSessionBootstrap({ route, apiCall, setRoute });
  const applyScopePayload = useCallback((payload) => {
    const nextSpaces = Array.isArray(payload?.spaces) ? payload.spaces : [];
    const nextLibraries = Array.isArray(payload?.libraries) ? payload.libraries : [];
    const nextActiveSpaceId = Number(payload?.active_space_id || 0) || null;
    let nextActiveLibraryId = Number(payload?.active_library_id || 0) || null;
    if (!nextActiveLibraryId && nextLibraries.length > 0) {
      nextActiveLibraryId = Number(nextLibraries[0].id);
    }

    setSpaces(nextSpaces);
    setLibraries(nextLibraries);
    setActiveSpaceId(nextActiveSpaceId);
    setActiveLibraryId(nextActiveLibraryId);
    setUser((prev) => {
      if (!prev) return prev;
      const prevActive = Number(prev.active_library_id || 0) || null;
      const prevActiveSpace = Number(prev.active_space_id || 0) || null;
      return prevActive === nextActiveLibraryId && prevActiveSpace === nextActiveSpaceId
        ? prev
        : { ...prev, active_space_id: nextActiveSpaceId, active_library_id: nextActiveLibraryId };
    });
    return {
      nextSpaces,
      nextLibraries,
      nextActiveSpaceId,
      nextActiveLibraryId
    };
  }, [setUser]);
  const productEdition = normalizeProductEdition(user?.runtime_mode || user?.[LEGACY_PRODUCT_FIELD]);
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const platformBridgeEnabled = !isLocalProductEdition(productEdition);
  const dashboardRouteOptions = useMemo(() => ({ productEdition, platformBridgeEnabled }), [productEdition, platformBridgeEnabled]);
  const supportStaffInEdition = supportHelpEnabled && ['admin', SUPPORT_STAFF_ROLE].includes(String(user?.role || ''));
  const nowPlayingDisplayToken = route === 'now-playing'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';
  const navigate = useCallback((nextRoute) => {
    window.history.pushState({}, '', appRouteUrl(nextRoute, activeTab, activeIntegrationSection, dashboardRouteOptions));
    setRoute(nextRoute);
  }, [activeIntegrationSection, activeTab, dashboardRouteOptions]);

  useEffect(() => {
    const sync = () => {
      setRoute(routeFromPath(window.location.pathname));
      if (routeFromPath(window.location.pathname) === 'dashboard') {
        const nextState = readDashboardStateFromUrl();
        setActiveTab(nextState.tab);
        setActiveIntegrationSection(nextState.integrationSection);
      }
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (route !== 'dashboard' && route !== 'now-playing' && user) {
      window.history.replaceState({}, '', dashboardUrl(activeTab, activeIntegrationSection, dashboardRouteOptions));
      // Authenticated users who land on legacy auth routes are normalized back to the dashboard shell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoute('dashboard');
    }
  }, [route, user, activeTab, activeIntegrationSection, dashboardRouteOptions]);

  useEffect(() => {
    if (route !== 'dashboard') return;
    const nextUrl = dashboardUrl(activeTab, activeIntegrationSection, dashboardRouteOptions);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) window.history.replaceState({}, '', nextUrl);
  }, [route, activeTab, activeIntegrationSection, dashboardRouteOptions]);

  const {
    importJobs,
    upsertImportJob,
    dismissImportJob,
    clearImportJobs
  } = useImportJobPolling({ user, apiCall });

  const {
    mediaItems,
    setMediaItems,
    mediaLoading,
    mediaError,
    mediaPagination,
    loadMedia,
    addMedia,
    editMedia,
    deleteMedia,
    bulkDeleteMedia,
    rateMedia
  } = useMediaApi({ apiCall, showToast });

  const handleAuth = useCallback((usr) => {
    setUser(usr || null);
    setAuthChecked(true);
    const nextProductEdition = normalizeProductEdition(usr?.runtime_mode || usr?.[LEGACY_PRODUCT_FIELD]);
    window.history.replaceState({}, '', dashboardUrl(activeTab, activeIntegrationSection, {
      productEdition: nextProductEdition,
      platformBridgeEnabled
    }));
    setRoute('dashboard');
  }, [activeIntegrationSection, activeTab, platformBridgeEnabled, setAuthChecked, setUser]);

  const selectDashboardTab = useCallback((nextValue) => {
    selectDashboardTabValue(nextValue, { activeIntegrationSection, dashboardRouteOptions, setActiveTab, setActiveIntegrationSection, setRoute });
  }, [activeIntegrationSection, dashboardRouteOptions]);

  const logout = useCallback(async () => {
    try { await apiCall('post', '/auth/logout'); } catch (_) {
      // Local session cleanup should still run if the server-side logout has already expired.
    }
    setUser(null);
    setAuthChecked(true);
    setSpaces([]);
    setLibraries([]);
    setActiveSpaceId(null);
    setActiveLibraryId(null);
    setMediaItems([]);
    clearImportJobs();
    navigate('login');
  }, [apiCall, clearImportJobs, navigate, setMediaItems, setUser, setAuthChecked]);

  const handleUserUpdate = useCallback((nextUser) => {
    if (!nextUser) return;
    setUser((prev) => (
      prev
        ? { ...prev, ...nextUser }
        : nextUser
    ));
  }, [setUser]);

  const loadClientFeatureFlags = useCallback(async () => {
    if (!user) return;
    try {
      const payload = await apiCall('get', '/media/feature-flags');
      setFeatureFlags((prev) => ({
        ...prev,
        events_enabled: Boolean(payload?.flags?.events_enabled),
        collectibles_enabled: Boolean(payload?.flags?.collectibles_enabled)
      }));
    } catch (_) {
      setFeatureFlags((prev) => ({
        ...prev,
        events_enabled: false,
        collectibles_enabled: false
      }));
    }
  }, [apiCall, user]);

  const loadAuthScope = useCallback(async ({ silent = false } = {}) => {
    if (!user) return null;
    try {
      const payload = await apiCall('get', '/auth/scope');
      const nextScope = applyScopePayload(payload);
      return nextScope?.nextActiveLibraryId || null;
    } catch (error) {
      if (!silent) showToast(error.response?.data?.error || 'Failed to load session context', 'error');
      return null;
    }
  }, [apiCall, applyScopePayload, showToast, user]);

  const handleSpaceSelect = useCallback(async (spaceIdRaw, options = {}) => {
    const nextSpaceId = Number(spaceIdRaw || 0) || null;
    if (!nextSpaceId) return null;
    if (nextSpaceId === Number(activeSpaceId || 0) && !options.force) return null;
    try {
      const payload = await apiCall('post', '/auth/scope', { space_id: nextSpaceId });
      const nextScope = applyScopePayload(payload);
      setMediaItems([]);
      clearImportJobs();
      if (!options.silent) {
        const targetSpace = nextScope?.nextSpaces?.find((space) => Number(space.id) === Number(nextScope.nextActiveSpaceId || 0));
        showToast(`Switched to ${targetSpace?.name || 'workspace'}`);
      }
      return payload;
    } catch (error) {
      if (!options.silent) {
        showToast(error.response?.data?.error || 'Failed to switch workspace', 'error');
      }
      return null;
    }
  }, [activeSpaceId, apiCall, applyScopePayload, clearImportJobs, setMediaItems, showToast]);

  const handleLibrarySelect = useCallback(async (libraryIdRaw) => {
    const libraryId = Number(libraryIdRaw || 0);
    if (!Number.isFinite(libraryId) || libraryId <= 0 || libraryId === Number(activeLibraryId || 0)) return;
    try {
      const payload = await apiCall('post', '/libraries/select', { library_id: libraryId });
      const nextActiveSpaceId = Number(payload?.active_space_id || 0) || null;
      const nextActiveLibraryId = Number(payload?.active_library_id || 0) || null;
      setActiveSpaceId(nextActiveSpaceId);
      setActiveLibraryId(nextActiveLibraryId);
      setMediaItems([]);
      clearImportJobs();
      setUser((prev) => (
        prev
          ? { ...prev, active_space_id: nextActiveSpaceId, active_library_id: nextActiveLibraryId }
          : prev
      ));
      if (nextActiveSpaceId !== Number(activeSpaceId || 0)) {
        await loadAuthScope({ silent: true });
      }
      showToast('Active library updated');
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to switch libraries', 'error');
    }
  }, [activeLibraryId, activeSpaceId, apiCall, clearImportJobs, loadAuthScope, setMediaItems, setUser, showToast]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    apiCall('get', '/settings/general').then((data) => setUiSettings(data)).catch(() => {});
  }, [route, authChecked, user, activeSpaceId, apiCall]);

  useRootAppearance(uiSettings);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    // Dashboard scope is backend-owned session state and must refresh after auth/route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAuthScope({ silent: true });
  }, [route, authChecked, user, loadAuthScope]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    // Feature flags are runtime state scoped to the active workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadClientFeatureFlags();
  }, [route, authChecked, user, activeSpaceId, loadClientFeatureFlags]);

  useEffect(() => {
    if (activeTab === 'library-import-review') {
      // The retired standalone import-review route now resolves into the import dashboard tab.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('library-import');
    }
  }, [activeTab]);

  useEffect(() => {
    if (featureFlags.collectibles_enabled === false && (activeTab === 'library-collectibles' || activeTab === 'library-art')) {
      // Feature flags can remove dashboard destinations after the URL state has already been read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('library-movies');
    }
    if (featureFlags.events_enabled === false && activeTab === 'library-events') {
      // Feature flags can remove dashboard destinations after the URL state has already been read.
      setActiveTab('library-movies');
    }
  }, [activeTab, featureFlags.collectibles_enabled, featureFlags.events_enabled]);

  const activeSpace = spaces.find((space) => Number(space.id) === Number(activeSpaceId)) || null;
  const activeMembershipRole = activeSpace?.membership_role || null;
  const canManageActiveSpace = user?.role === 'admin'
    ? ['owner', 'admin'].includes(activeMembershipRole)
    : user?.role === SUPPORT_STAFF_ROLE
      ? false
      : ['owner', 'admin'].includes(activeMembershipRole);
  const fallbackManageableSpace = spaces.find((space) => ['owner', 'admin'].includes(String(space?.membership_role || ''))) || null;
  const scopeKey = `${activeSpaceId || 'none'}:${activeLibraryId || 'none'}`;
  const collapsed = !pinnedExpanded;

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    if (
      activeTab !== 'space-manage'
      || canManageActiveSpace
      || supportStaffInEdition
      || !fallbackManageableSpace
      || Number(fallbackManageableSpace.id) === Number(activeSpaceId || 0)
    ) {
      return;
    }
    // Space management requires a manageable workspace; switch silently when the current one is read-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleSpaceSelect(fallbackManageableSpace.id, { silent: true });
  }, [
    activeSpaceId,
    activeTab,
    authChecked,
    canManageActiveSpace,
    fallbackManageableSpace,
    handleSpaceSelect,
    route,
    supportStaffInEdition,
    user
  ]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    const waitingForSpaceScope = activeTab === 'space-manage'
      && !activeMembershipRole
      && !canManageActiveSpace
      && spaces.length === 0;
    if (waitingForSpaceScope) return;
    if (
      activeTab === 'space-manage'
      && !canManageActiveSpace
      && !supportStaffInEdition
      && fallbackManageableSpace
      && Number(fallbackManageableSpace.id) !== Number(activeSpaceId || 0)
    ) {
      return;
    }
    const nextTab = getSafeDashboardTab(productEdition, activeTab, {
      userRole: user?.role,
      canManageActiveSpace,
      showCollectibles: featureFlags.collectibles_enabled !== false,
      showEvents: featureFlags.events_enabled !== false,
      platformBridgeEnabled
    });
    if (nextTab !== activeTab) {
      // Dashboard availability is derived from edition, flags, role, and active-space permissions.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(nextTab);
    }
  }, [
    activeTab,
    activeMembershipRole,
    activeSpaceId,
    authChecked,
    canManageActiveSpace,
    fallbackManageableSpace,
    featureFlags.collectibles_enabled,
    featureFlags.events_enabled,
    productEdition,
    platformBridgeEnabled,
    route,
    spaces.length,
    supportStaffInEdition,
    user,
    user?.role
  ]);

  if (route === 'now-playing') {
    if (!authChecked) {
      return (
        <div className="min-h-screen bg-void flex items-center justify-center text-dim">
          <div className="flex items-center gap-3"><Spinner size={18} />Checking session...</div>
        </div>
      );
    }

    if (!user && !nowPlayingDisplayToken) {
      return (
        <AuthPageView
          route="login"
          onNavigate={navigate}
          onAuth={handleAuth}
          apiUrl={apiUrl}
          appVersion={APP_VERSION}
          Icons={Icons}
          Spinner={Spinner}
          cx={cx}
        />
      );
    }

    return (
      <NowPlayingView
        apiCall={apiCall}
        apiUrl={apiUrl}
        displayToken={nowPlayingDisplayToken}
        onBack={user ? () => navigate('dashboard') : null}
      />
    );
  }

  if (route !== 'dashboard') {
    return (
      <AuthPageView
        route={route}
        onNavigate={navigate}
        onAuth={handleAuth}
        apiUrl={apiUrl}
        appVersion={APP_VERSION}
        Icons={Icons}
        Spinner={Spinner}
        cx={cx}
      />
    );
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center text-dim">
        <div className="flex items-center gap-3"><Spinner size={18} />Checking session...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPageView
        route="login"
        onNavigate={navigate}
        onAuth={handleAuth}
        apiUrl={apiUrl}
        appVersion={APP_VERSION}
        Icons={Icons}
        Spinner={Spinner}
        cx={cx}
      />
    );
  }

  const activeLibrary = libraries.find((library) => Number(library.id) === Number(activeLibraryId)) || null;

  return (
    <DashboardShell
      user={user}
      onUserUpdate={handleUserUpdate}
      activeTab={activeTab}
      setActiveTab={selectDashboardTab}
      canManageActiveSpace={canManageActiveSpace}
      spaces={spaces}
      activeSpaceId={activeSpaceId}
      handleSpaceSelect={handleSpaceSelect}
      productEdition={productEdition}
      platformBridgeEnabled={platformBridgeEnabled}
      featureFlags={featureFlags}
      setActiveIntegrationSection={setActiveIntegrationSection}
      logout={logout}
      collapsed={collapsed}
      pinnedExpanded={pinnedExpanded}
      setPinnedExpanded={setPinnedExpanded}
      mobileNavOpen={mobileNavOpen}
      setMobileNavOpen={setMobileNavOpen}
      appVersion={APP_VERSION}
      libraries={libraries}
      activeLibraryId={activeLibraryId}
      handleLibrarySelect={handleLibrarySelect}
      activeMembershipRole={activeMembershipRole}
      activeSpace={activeSpace}
      activeLibrary={activeLibrary}
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
      setUiSettings={setUiSettings}
      activeIntegrationSection={activeIntegrationSection}
      libraryReviewFilter={libraryReviewFilter}
      setLibraryReviewFilter={setLibraryReviewFilter}
      scopeKey={scopeKey}
      loadAuthScope={loadAuthScope}
      dismissImportJob={dismissImportJob}
      toast={toast}
      setToast={setToast}
    />
  );
}
