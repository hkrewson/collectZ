import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import appMeta from './app-meta.json';
import AuthPageView from './components/AuthPage';
import SidebarNav from './components/SidebarNav';
import DashboardContent from './components/app/DashboardContent';
import { routeFromPath, readCookie, Spinner, Toast, ImportStatusDock, Icons, cx } from './components/app/AppPrimitives';
import {
  DEFAULT_INTEGRATION_SECTION,
  dashboardUrl,
  readDashboardStateFromUrl
} from './components/app/dashboardRouting';
import useImportJobPolling from './components/app/hooks/useImportJobPolling';
import useSessionBootstrap from './components/app/hooks/useSessionBootstrap';
import useMediaApi from './components/app/hooks/useMediaApi';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const APP_VERSION = process.env.REACT_APP_VERSION || appMeta.frontend || appMeta.version || 'unknown';
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.REACT_APP_DEBUG || 0) || 0));
const isDebugAt = (level) => DEBUG_LEVEL >= level;

export default function App() {
  const initialDashboardState = readDashboardStateFromUrl();
  const [route, setRoute] = useState(routeFromPath(window.location.pathname));
  const [activeTab, setActiveTab] = useState(initialDashboardState.tab);
  const [activeIntegrationSection, setActiveIntegrationSection] = useState(initialDashboardState.integrationSection);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  const [uiSettings, setUiSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [featureFlags, setFeatureFlags] = useState({
    events_enabled: false,
    collectibles_enabled: false
  });
  const [toast, setToast] = useState(null);
  const [importReviewPendingCount, setImportReviewPendingCount] = useState(0);
  const importReviewEnabled = isDebugAt(2);
  const showToast = useCallback((message, type = 'ok') => setToast({ message, type }), []);
  const apiCall = useCallback(async (method, path, data, config = {}) => {
    const methodUpper = String(method || 'GET').toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
    const headers = { ...(config.headers || {}) };

    if (needsCsrf && !headers['x-csrf-token']) {
      let csrfToken = readCookie('csrf_token');
      if (!csrfToken) {
        try {
          const csrfResp = await axios.get(`${API_URL}/auth/csrf-token`, { withCredentials: true });
          csrfToken = csrfResp.data?.csrfToken || readCookie('csrf_token');
        } catch (_) {
          csrfToken = readCookie('csrf_token');
        }
      }
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }

    const response = await axios({ method, url: `${API_URL}${path}`, data, ...config, headers, withCredentials: true });
    return response.data;
  }, []);
  const { user, setUser, authChecked, setAuthChecked } = useSessionBootstrap({ route, apiCall, setRoute });

  const navigate = useCallback((nextRoute) => {
    window.history.pushState(
      {},
      '',
      nextRoute === 'register' ? '/register'
        : nextRoute === 'dashboard' ? dashboardUrl(activeTab, activeIntegrationSection)
          : nextRoute === 'reset' ? '/reset-password'
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
    setMediaItems([]);
    clearImportJobs();
    navigate('login');
  }, [apiCall, clearImportJobs, navigate, setMediaItems, setUser, setAuthChecked]);

  const loadImportReviewPendingCount = useCallback(async () => {
    if (!user) return;
    try {
      const payload = await apiCall('get', '/media/import-reviews/unresolved-count');
      setImportReviewPendingCount(Number(payload?.count || 0));
    } catch (_) {}
  }, [apiCall, user]);

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
      return nextActiveLibraryId;
    } catch (error) {
      if (!silent) showToast(error.response?.data?.error || 'Failed to load active scope', 'error');
      return null;
    }
  }, [apiCall, showToast, user, setUser]);

  const handleSpaceSelect = useCallback(async (spaceIdRaw) => {
    const spaceId = Number(spaceIdRaw || 0);
    if (!Number.isFinite(spaceId) || spaceId <= 0 || spaceId === Number(activeSpaceId || 0)) return;
    try {
      const payload = await apiCall('post', '/spaces/select', { space_id: spaceId });
      const nextLibraries = Array.isArray(payload?.libraries) ? payload.libraries : [];
      const nextActiveSpaceId = Number(payload?.active_space_id || 0) || null;
      const nextActiveLibraryId = Number(payload?.active_library_id || 0) || null;
      setActiveSpaceId(nextActiveSpaceId);
      setActiveLibraryId(nextActiveLibraryId);
      setLibraries(nextLibraries);
      setMediaItems([]);
      clearImportJobs();
      setUser((prev) => (
        prev
          ? { ...prev, active_space_id: nextActiveSpaceId, active_library_id: nextActiveLibraryId }
          : prev
      ));
      await loadAuthScope({ silent: true });
      showToast('Active space updated');
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to switch spaces', 'error');
    }
  }, [activeSpaceId, apiCall, clearImportJobs, loadAuthScope, setMediaItems, setUser, showToast]);

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
  }, [route, authChecked, user, apiCall]);

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
  }, [route, authChecked, user, loadClientFeatureFlags]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    if (!importReviewEnabled) {
      setImportReviewPendingCount(0);
      return;
    }
    loadImportReviewPendingCount();
    const timer = setInterval(loadImportReviewPendingCount, 30000);
    return () => clearInterval(timer);
  }, [route, authChecked, user, loadImportReviewPendingCount, importReviewEnabled]);

  useEffect(() => {
    if (!importReviewEnabled && activeTab === 'library-import-review') {
      setActiveTab('library-import');
    }
  }, [activeTab, importReviewEnabled]);

  useEffect(() => {
    if (!featureFlags.collectibles_enabled && activeTab === 'library-collectibles') {
      setActiveTab('library-movies');
    }
    if (!featureFlags.events_enabled && activeTab === 'library-events') {
      setActiveTab('library-movies');
    }
  }, [activeTab, featureFlags.collectibles_enabled, featureFlags.events_enabled]);

  const activeSpace = spaces.find((space) => Number(space.id) === Number(activeSpaceId)) || null;
  const activeMembershipRole = activeSpace?.membership_role || null;
  const canManageActiveSpace = ['owner', 'admin'].includes(activeMembershipRole);
  const scopeKey = `${activeSpaceId || 'none'}:${activeLibraryId || 'none'}`;

  useEffect(() => {
    if (activeTab === 'space-manage' && !canManageActiveSpace) {
      setActiveTab('library-movies');
    }
  }, [activeTab, canManageActiveSpace]);

  if (route !== 'dashboard') {
    return (
      <AuthPageView
        route={route}
        onNavigate={navigate}
        onAuth={handleAuth}
        apiUrl={API_URL}
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
        apiUrl={API_URL}
        appVersion={APP_VERSION}
        Icons={Icons}
        Spinner={Spinner}
        cx={cx}
      />
    );
  }

  const activeLibrary = libraries.find((library) => Number(library.id) === Number(activeLibraryId)) || null;

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <SidebarNav
        user={user}
        activeTab={activeTab}
        onSelect={(nextTab) => {
          setActiveTab(nextTab);
          if (nextTab !== 'admin-integrations') setActiveIntegrationSection(DEFAULT_INTEGRATION_SECTION);
        }}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        appVersion={APP_VERSION}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSpaceSelect={handleSpaceSelect}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibrarySelect={handleLibrarySelect}
        canManageActiveSpace={canManageActiveSpace}
        activeMembershipRole={activeMembershipRole}
        importReviewPendingCount={importReviewPendingCount}
        showImportReview={importReviewEnabled}
        showCollectibles={featureFlags.collectibles_enabled}
        showEvents={featureFlags.events_enabled}
      />

      <div className={cx('flex-1 flex flex-col min-w-0 transition-all duration-300', sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56')}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge lg:hidden shrink-0">
          <button onClick={() => setMobileNavOpen(true)} className="btn-icon"><Icons.Menu /></button>
          <span className="font-display text-lg tracking-wider text-gold">COLLECTZ</span>
        </div>

        <div className="flex-1 overflow-hidden">
          <DashboardContent
            activeTab={activeTab}
            user={user}
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
            rateMedia={rateMedia}
            upsertImportJob={upsertImportJob}
            importJobs={importJobs}
            apiUrl={API_URL}
            Icons={Icons}
            Spinner={Spinner}
            cx={cx}
            activeLibrary={activeLibrary}
            importReviewEnabled={importReviewEnabled}
            loadImportReviewPendingCount={loadImportReviewPendingCount}
            setUiSettings={setUiSettings}
            activeIntegrationSection={activeIntegrationSection}
            setActiveIntegrationSection={setActiveIntegrationSection}
            spaces={spaces}
            activeSpace={activeSpace}
            activeSpaceId={activeSpaceId}
            activeMembershipRole={activeMembershipRole}
            canManageActiveSpace={canManageActiveSpace}
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onScopeRefresh={loadAuthScope}
            onSpaceSelect={handleSpaceSelect}
            scopeKey={scopeKey}
          />
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
