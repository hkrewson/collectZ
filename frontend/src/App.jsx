import React, { useCallback, useEffect, useState } from 'react';
import appMeta from './app-meta.json';
import AuthPageView from './components/AuthPage';
import DashboardShell from './components/app/DashboardShell';
import { routeFromPath, Spinner, Icons, cx } from './components/app/AppPrimitives';
import {
  dashboardUrl,
  readDashboardStateFromUrl
} from './components/app/dashboardRouting';
import useApiClient from './components/app/hooks/useApiClient';
import useImportJobPolling from './components/app/hooks/useImportJobPolling';
import useSessionBootstrap from './components/app/hooks/useSessionBootstrap';
import useMediaApi from './components/app/hooks/useMediaApi';
import { readFrontendEnv } from './components/app/frontendEnv';
import {
  getSafeDashboardTab,
  isSupportHelpEnabled,
  normalizeProductEdition
} from './components/app/productEdition';

const APP_VERSION = readFrontendEnv('VITE_APP_VERSION', 'REACT_APP_VERSION', appMeta.frontend || appMeta.version || 'unknown');
const SUPPORT_SUMMARY_POLL_MS = 60000;

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
  const [supportSession, setSupportSession] = useState(null);
  const [uiSettings, setUiSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [featureFlags, setFeatureFlags] = useState({
    events_enabled: null,
    collectibles_enabled: null
  });
  const [supportSummary, setSupportSummary] = useState({
    open: 0,
    answered: 0,
    closed: 0,
    bugs: 0,
    features: 0,
    metrics: {
      time_to_open_seconds: 0,
      time_to_close_seconds: 0,
      closed_this_month: 0
    }
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
    setSupportSession(payload?.support_session?.active ? payload.support_session : null);
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
  const productEdition = normalizeProductEdition(user?.product_edition);
  const supportHelpEnabled = isSupportHelpEnabled(productEdition);
  const supportStaffInEdition = supportHelpEnabled && ['admin', 'support_admin'].includes(String(user?.role || ''));
  const supportSessionActiveInEdition = supportHelpEnabled && Boolean(supportSession?.active);
  const navigate = useCallback((nextRoute) => {
    window.history.pushState(
      {},
      '',
      nextRoute === 'register' ? '/register'
        : nextRoute === 'forgot' ? '/forgot-password'
        : nextRoute === 'dashboard' ? dashboardUrl(activeTab, activeIntegrationSection)
          : nextRoute === 'reset' ? '/reset-password'
            : nextRoute === 'verify' ? '/verify-email'
            : '/login'
    );
    setRoute(nextRoute);
  }, [activeIntegrationSection, activeTab]);

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
    if (route !== 'dashboard' && user) {
      window.history.replaceState({}, '', dashboardUrl(activeTab, activeIntegrationSection));
      setRoute('dashboard');
    }
  }, [route, user, activeTab, activeIntegrationSection]);

  useEffect(() => {
    if (route !== 'dashboard') return;
    const nextUrl = dashboardUrl(activeTab, activeIntegrationSection);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) window.history.replaceState({}, '', nextUrl);
  }, [route, activeTab, activeIntegrationSection]);

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
    window.history.replaceState({}, '', dashboardUrl(activeTab, activeIntegrationSection));
    setRoute('dashboard');
  }, [activeIntegrationSection, activeTab, setAuthChecked, setUser]);

  const logout = useCallback(async () => {
    try { await apiCall('post', '/auth/logout'); } catch (_) {}
    setUser(null);
    setAuthChecked(true);
    setSpaces([]);
    setLibraries([]);
    setActiveSpaceId(null);
    setActiveLibraryId(null);
    setSupportSession(null);
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

  const loadSupportSummary = useCallback(async ({ silent = false } = {}) => {
    if (!supportStaffInEdition) {
      setSupportSummary({
        open: 0,
        answered: 0,
        closed: 0,
        bugs: 0,
        features: 0,
        metrics: {
          time_to_open_seconds: 0,
          time_to_close_seconds: 0,
          closed_this_month: 0
        }
      });
      return null;
    }
    try {
      const payload = await apiCall('get', '/support/staff/summary');
      const nextQueue = payload?.queue || {};
      const nextMetrics = payload?.metrics || {};
      const normalized = {
        open: Number(nextQueue.open || 0),
        answered: Number(nextQueue.answered || 0),
        closed: Number(nextQueue.closed || 0),
        bugs: Number(nextQueue.bugs || 0),
        features: Number(nextQueue.features || 0),
        metrics: {
          time_to_open_seconds: Number(nextMetrics.time_to_open_seconds || 0),
          time_to_close_seconds: Number(nextMetrics.time_to_close_seconds || 0),
          closed_this_month: Number(nextMetrics.closed_this_month || 0)
        }
      };
      setSupportSummary(normalized);
      return normalized;
    } catch (error) {
      if (!silent) {
        showToast(error.response?.data?.error || 'Failed to load support summary', 'error');
      }
      return null;
    }
  }, [apiCall, showToast, supportStaffInEdition]);

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
      showToast(supportSessionActiveInEdition ? 'Support library updated' : 'Active library updated');
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to switch libraries', 'error');
    }
  }, [activeLibraryId, activeSpaceId, apiCall, clearImportJobs, loadAuthScope, setMediaItems, setUser, showToast, supportSessionActiveInEdition]);

  const endSupportSession = useCallback(async () => {
    try {
      await apiCall('delete', '/auth/support-session');
      await loadAuthScope({ silent: true });
      clearImportJobs();
      setMediaItems([]);
      if (!String(activeTab || '').startsWith('admin-') || activeTab === 'space-manage') {
        setActiveTab('admin-spaces');
      }
      showToast('Support session ended');
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to end support session', 'error');
    }
  }, [activeTab, apiCall, clearImportJobs, loadAuthScope, setMediaItems, showToast]);

  const startSupportSession = useCallback(async (space, options = {}) => {
    const spaceId = Number(space?.id || 0);
    if (!Number.isFinite(spaceId) || spaceId <= 0) return false;
    const reason = String(options?.reason || '').trim();
    const libraryId = Number(options?.libraryId || 0) || null;
    const requestId = Number(options?.requestId || 0) || null;
    try {
      await apiCall('post', '/auth/support-session/start', {
        space_id: spaceId,
        reason: reason || undefined,
        library_id: libraryId || undefined,
        request_id: requestId || undefined
      });
      await loadAuthScope({ silent: true });
      clearImportJobs();
      setMediaItems([]);
      setActiveTab('space-manage');
      showToast(`Support session started for ${space?.name || 'workspace'}`);
      return true;
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to start support session', 'error');
      return false;
    }
  }, [apiCall, clearImportJobs, loadAuthScope, setMediaItems, showToast]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    apiCall('get', '/settings/general').then((data) => setUiSettings(data)).catch(() => {});
  }, [route, authChecked, user, activeSpaceId, apiCall]);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolveTheme = () => (uiSettings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : uiSettings.theme);

    const apply = () => {
      const theme = resolveTheme();
      root.classList.remove('theme-light', 'theme-dark', 'density-compact', 'density-comfortable');
      root.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
      root.classList.add(uiSettings.density === 'compact' ? 'density-compact' : 'density-comfortable');
      root.style.colorScheme = theme;
    };

    apply();
    const onSystemThemeChange = () => {
      if (uiSettings.theme === 'system') apply();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else mq.addListener(onSystemThemeChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onSystemThemeChange);
      else mq.removeListener(onSystemThemeChange);
    };
  }, [uiSettings.theme, uiSettings.density]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    loadAuthScope({ silent: true });
  }, [route, authChecked, user, loadAuthScope]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    loadClientFeatureFlags();
  }, [route, authChecked, user, activeSpaceId, loadClientFeatureFlags]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return undefined;
    loadSupportSummary({ silent: true });
    if (!supportStaffInEdition) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadSupportSummary({ silent: true });
    }, SUPPORT_SUMMARY_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [route, authChecked, user, loadSupportSummary, supportStaffInEdition]);

  useEffect(() => {
    if (activeTab === 'library-import-review') {
      setActiveTab('library-import');
    }
  }, [activeTab]);

  useEffect(() => {
    if (featureFlags.collectibles_enabled === false && (activeTab === 'library-collectibles' || activeTab === 'library-art')) {
      setActiveTab('library-movies');
    }
    if (featureFlags.events_enabled === false && activeTab === 'library-events') {
      setActiveTab('library-movies');
    }
  }, [activeTab, featureFlags.collectibles_enabled, featureFlags.events_enabled]);

  const activeSpace = spaces.find((space) => Number(space.id) === Number(activeSpaceId)) || null;
  const activeMembershipRole = activeSpace?.membership_role || null;
  const canManageActiveSpace = user?.role === 'admin'
    ? supportSessionActiveInEdition || ['owner', 'admin'].includes(activeMembershipRole)
    : user?.role === 'support_admin'
      ? supportSessionActiveInEdition
      : ['owner', 'admin'].includes(activeMembershipRole);
  const scopeKey = `${activeSpaceId || 'none'}:${activeLibraryId || 'none'}`;
  const collapsed = !pinnedExpanded;

  useEffect(() => {
    const nextTab = getSafeDashboardTab(productEdition, activeTab, {
      userRole: user?.role,
      supportSessionActive: supportSessionActiveInEdition,
      canManageActiveSpace,
      showCollectibles: featureFlags.collectibles_enabled,
      showEvents: featureFlags.events_enabled
    });
    if (nextTab !== activeTab) setActiveTab(nextTab);
  }, [
    activeTab,
    canManageActiveSpace,
    featureFlags.collectibles_enabled,
    featureFlags.events_enabled,
    productEdition,
    supportSessionActiveInEdition,
    user?.role
  ]);

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
      setActiveTab={setActiveTab}
      supportSession={supportSession}
      canManageActiveSpace={canManageActiveSpace}
      spaces={spaces}
      activeSpaceId={activeSpaceId}
      handleSpaceSelect={handleSpaceSelect}
      productEdition={productEdition}
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
      supportSummary={supportSummary}
      activeSpace={activeSpace}
      activeLibrary={activeLibrary}
      endSupportSession={endSupportSession}
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
      scopeKey={scopeKey}
      loadAuthScope={loadAuthScope}
      startSupportSession={startSupportSession}
      loadSupportSummary={loadSupportSummary}
      dismissImportJob={dismissImportJob}
      toast={toast}
      setToast={setToast}
    />
  );
}
