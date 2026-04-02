import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import appMeta from './app-meta.json';
import AuthPageView from './components/AuthPage';
import SidebarNav from './components/SidebarNav';
import CollectzMark from './components/CollectzMark';
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
const SUPPORT_ADMIN_ALLOWED_TABS = new Set(['help', 'support-inbox', 'profile']);

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
    events_enabled: false,
    collectibles_enabled: false
  });
  const [supportSummary, setSupportSummary] = useState({ open: 0, answered: 0, closed: 0, bugs: 0, features: 0 });
  const [toast, setToast] = useState(null);
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
    if (!['admin', 'support_admin'].includes(String(user?.role || ''))) {
      setSupportSummary({ open: 0, answered: 0, closed: 0, bugs: 0, features: 0 });
      return null;
    }
    try {
      const payload = await apiCall('get', '/support/staff/summary');
      const nextQueue = payload?.queue || {};
      const normalized = {
        open: Number(nextQueue.open || 0),
        answered: Number(nextQueue.answered || 0),
        closed: Number(nextQueue.closed || 0),
        bugs: Number(nextQueue.bugs || 0),
        features: Number(nextQueue.features || 0)
      };
      setSupportSummary(normalized);
      return normalized;
    } catch (error) {
      if (!silent) {
        showToast(error.response?.data?.error || 'Failed to load support summary', 'error');
      }
      return null;
    }
  }, [apiCall, showToast, user?.role]);

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
      setSupportSession(payload?.support_session?.active ? payload.support_session : null);
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
      if (!silent) showToast(error.response?.data?.error || 'Failed to load session context', 'error');
      return null;
    }
  }, [apiCall, showToast, user, setUser]);

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
      showToast(user?.role === 'admin' && supportSession?.active ? 'Support library updated' : 'Active library updated');
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to switch libraries', 'error');
    }
  }, [activeLibraryId, activeSpaceId, apiCall, clearImportJobs, loadAuthScope, setMediaItems, setUser, showToast, supportSession?.active, user?.role]);

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
    try {
      await apiCall('post', '/auth/support-session/start', {
        space_id: spaceId,
        reason: reason || undefined,
        library_id: libraryId || undefined
      });
      await loadAuthScope({ silent: true });
      clearImportJobs();
      setMediaItems([]);
      setActiveTab('space-manage');
      showToast(`Support session started for ${space?.name || 'space'}`);
      return true;
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to start support session', 'error');
      return false;
    }
  }, [apiCall, clearImportJobs, loadAuthScope, setMediaItems, showToast]);

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
    if (!(route === 'dashboard' && authChecked && user)) return undefined;
    loadSupportSummary({ silent: true });
    if (!['admin', 'support_admin'].includes(String(user?.role || ''))) return undefined;
    const intervalId = window.setInterval(() => {
      loadSupportSummary({ silent: true });
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [route, authChecked, user, loadSupportSummary]);

  useEffect(() => {
    if (activeTab === 'library-import-review') {
      setActiveTab('library-import');
    }
  }, [activeTab]);

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
  const canManageActiveSpace = user?.role === 'admin'
    ? Boolean(supportSession?.active) || ['owner', 'admin'].includes(activeMembershipRole)
    : ['owner', 'admin'].includes(activeMembershipRole);
  const scopeKey = `${activeSpaceId || 'none'}:${activeLibraryId || 'none'}`;
  const collapsed = !pinnedExpanded;
  const desktopNavExpanded = !collapsed;

  useEffect(() => {
    if (user?.role === 'support_admin' && !SUPPORT_ADMIN_ALLOWED_TABS.has(String(activeTab || ''))) {
      setActiveTab('help');
    }
  }, [activeTab, user?.role]);

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
        collapsed={collapsed}
        pinnedExpanded={pinnedExpanded}
        onToggle={() => setPinnedExpanded((prev) => !prev)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        appVersion={APP_VERSION}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibrarySelect={handleLibrarySelect}
        canManageActiveSpace={canManageActiveSpace}
        activeMembershipRole={activeMembershipRole}
        showCollectibles={featureFlags.collectibles_enabled}
        showEvents={featureFlags.events_enabled}
        supportBadgeCount={['admin', 'support_admin'].includes(String(user?.role || '')) ? supportSummary.open : null}
      />

      <div className={cx('flex-1 flex flex-col min-w-0 transition-all duration-300', desktopNavExpanded ? 'lg:ml-56' : 'lg:ml-16')}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge shrink-0 bg-void/95 backdrop-blur lg:hidden">
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
              {user?.role === 'admin' && !supportSession?.active
                ? 'Platform control plane'
                : user?.role === 'support_admin'
                  ? 'Support control plane'
                : `${activeSpace?.name || 'No current space'}${activeLibrary ? ` / ${activeLibrary.name}` : ''}`}
            </div>
          </div>
        </div>

        {user?.role === 'admin' && supportSession?.active ? (
          <div className="border-b border-amber-300/25 bg-[linear-gradient(90deg,rgba(245,158,11,0.18),rgba(217,119,6,0.12),rgba(10,14,20,0.96))] shadow-[inset_0_1px_0_rgba(252,211,77,0.12)]">
            <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-400/15 text-amber-100">
                  <Icons.Activity />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-amber-100/80">Support Session Active</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium text-amber-50 truncate">{supportSession.space_name || 'Scoped tenant access'}</p>
                    {activeLibrary ? (
                      <span className="text-xs text-amber-100/70">Library: {activeLibrary.name}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-amber-100/70 max-w-3xl">
                    You are operating inside tenant context through explicit support access. End the session when the support task is complete.
                  </p>
                  {supportSession.reason ? (
                    <p className="text-xs text-amber-100/80 truncate">Reason: {supportSession.reason}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-end gap-2 shrink-0">
                {libraries.length > 1 ? (
                  <label className="field min-w-[220px]">
                    <span className="label text-amber-100/75">Support Library</span>
                    <select
                      className="select border-amber-300/30 bg-amber-950/20 text-amber-50"
                      value={activeLibraryId || ''}
                      onChange={(e) => handleLibrarySelect(e.target.value)}
                    >
                      {libraries.map((library) => (
                        <option key={library.id} value={library.id}>
                          {library.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button type="button" className="btn-secondary btn-sm shrink-0 border-amber-300/30 bg-amber-950/20 text-amber-50 hover:bg-amber-900/30" onClick={endSupportSession}>
                  End Session
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
            bulkDeleteMedia={bulkDeleteMedia}
            rateMedia={rateMedia}
            upsertImportJob={upsertImportJob}
            importJobs={importJobs}
            apiUrl={API_URL}
            Icons={Icons}
            Spinner={Spinner}
            cx={cx}
            activeLibrary={activeLibrary}
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
            supportSession={supportSession}
            onStartSupportSession={startSupportSession}
            onEndSupportSession={endSupportSession}
            scopeKey={scopeKey}
            supportSummary={supportSummary}
            onSupportSummaryRefresh={loadSupportSummary}
          />
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
