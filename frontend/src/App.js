import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import appMeta from './app-meta.json';
import AdminActivityView from './components/AdminActivityView';
import AuthPageView from './components/AuthPage';
import ImportViewComponent from './components/ImportView';
import AdminFeatureFlagsView from './components/AdminFeatureFlagsView';
import ProfileViewComponent from './components/ProfileView';
import AdminUsersView from './components/AdminUsersView';
import AdminSettingsView from './components/AdminSettingsView';
import AdminIntegrationsView from './components/AdminIntegrationsView';
import SidebarNav from './components/SidebarNav';
import LibraryView from './components/LibraryView';
import { routeFromPath, readCookie, Spinner, Toast, ImportStatusDock, Icons, cx } from './components/app/AppPrimitives';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const APP_VERSION = process.env.REACT_APP_VERSION || appMeta.version || '2.0.0-beta.5r1';
const BUILD_SHA = process.env.REACT_APP_GIT_SHA || appMeta?.build?.gitShaDefault || 'dev';
const IMPORT_JOBS_KEY = 'collectz_import_jobs';
const IMPORT_POLL_LEADER_KEY = 'collectz_import_poll_leader';
const IMPORT_POLL_LAST_TS_KEY = 'collectz_import_poll_last_ts';
const IMPORT_POLL_HEARTBEAT_MS = 8000;
const IMPORT_POLL_STALE_MS = 25000;
const IMPORT_POLL_INTERVAL_MS = 10000;
const VALID_DASHBOARD_TABS = new Set([
  'library',
  'library-movies',
  'library-tv',
  'library-books',
  'library-audio',
  'library-games',
  'library-comics',
  'library-other',
  'library-import',
  'profile',
  'admin-users',
  'admin-activity',
  'admin-settings',
  'admin-flags',
  'admin-integrations'
]);
const VALID_INTEGRATION_SECTIONS = new Set(['audio', 'barcode', 'books', 'comics', 'games', 'plex', 'tmdb', 'vision']);
const DEFAULT_TAB = 'library-movies';
const DEFAULT_INTEGRATION_SECTION = 'audio';

function readDashboardStateFromUrl() {
  const path = String(window.location.pathname || '');
  const libMatch = path.match(/^\/library\/(movies|tv|books|audio|games|comics|other|import)\/?$/);
  if (libMatch) {
    const slug = libMatch[1];
    return {
      tab: slug === 'import'
        ? 'library-import'
        : slug === 'other'
          ? 'library-comics'
          : `library-${slug}`,
      integrationSection: DEFAULT_INTEGRATION_SECTION
    };
  }
  const adminIntegrationMatch = path.match(/^\/admin\/integrations\/?([^/]+)?\/?$/);
  if (adminIntegrationMatch) {
    const sec = String(adminIntegrationMatch[1] || '').toLowerCase();
    return {
      tab: 'admin-integrations',
      integrationSection: VALID_INTEGRATION_SECTIONS.has(sec) ? sec : DEFAULT_INTEGRATION_SECTION
    };
  }

  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const integration = params.get('integration');
  const normalizedTab = tab === 'library-other' ? 'library-comics' : tab;
  return {
    tab: VALID_DASHBOARD_TABS.has(normalizedTab) ? normalizedTab : DEFAULT_TAB,
    integrationSection: VALID_INTEGRATION_SECTIONS.has(integration) ? integration : DEFAULT_INTEGRATION_SECTION
  };
}

function dashboardUrl(tab, integrationSection) {
  const params = new URLSearchParams();
  if (tab && tab !== DEFAULT_TAB) params.set('tab', tab);
  if (tab === 'admin-integrations' && integrationSection && integrationSection !== DEFAULT_INTEGRATION_SECTION) {
    params.set('integration', integrationSection);
  }
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ''}`;
}

function ForbiddenView({ title = 'Access Restricted', detail = 'You do not have permission to view this section.' }) {
  return (
    <div className="h-full overflow-y-auto p-6 max-w-xl">
      <div className="card p-6 space-y-3">
        <h1 className="section-title">{title}</h1>
        <p className="text-sm text-dim">{detail}</p>
      </div>
    </div>
  );
}

export default function App() {
  const initialDashboardState = readDashboardStateFromUrl();
  const [route, setRoute] = useState(routeFromPath(window.location.pathname));
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState(initialDashboardState.tab);
  const [activeIntegrationSection, setActiveIntegrationSection] = useState(initialDashboardState.integrationSection);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaPagination, setMediaPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  const [uiSettings, setUiSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [toast, setToast] = useState(null);
  const [importJobs, setImportJobs] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMPORT_JOBS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const tabIdRef = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const mediaRequestSeqRef = useRef(0);
  const [isImportPollLeader, setIsImportPollLeader] = useState(false);

  const isForegroundTab = useCallback(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus(),
    []
  );

  const releaseImportPollLeader = useCallback(() => {
    try {
      const raw = localStorage.getItem(IMPORT_POLL_LEADER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.tabId === tabIdRef.current) localStorage.removeItem(IMPORT_POLL_LEADER_KEY);
    } catch (_) {}
    setIsImportPollLeader(false);
  }, []);

  const claimImportPollLeader = useCallback(() => {
    if (!isForegroundTab()) {
      setIsImportPollLeader(false);
      return false;
    }
    try {
      const now = Date.now();
      const raw = localStorage.getItem(IMPORT_POLL_LEADER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const stale = !parsed?.tabId || !parsed?.ts || (now - Number(parsed.ts)) > IMPORT_POLL_STALE_MS;
      if (stale || parsed.tabId === tabIdRef.current) {
        localStorage.setItem(IMPORT_POLL_LEADER_KEY, JSON.stringify({ tabId: tabIdRef.current, ts: now }));
        setIsImportPollLeader(true);
        return true;
      }
    } catch (_) {}
    setIsImportPollLeader(false);
    return false;
  }, [isForegroundTab]);

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

  useEffect(() => {
    const onVisibilityChange = () => {
      if (isForegroundTab()) claimImportPollLeader();
      else releaseImportPollLeader();
    };
    const onFocus = () => claimImportPollLeader();
    const onBlur = () => releaseImportPollLeader();
    const onBeforeUnload = () => releaseImportPollLeader();
    const onStorage = (event) => {
      if (event.key !== IMPORT_POLL_LEADER_KEY) return;
      if (isForegroundTab()) claimImportPollLeader();
      else setIsImportPollLeader(false);
    };

    claimImportPollLeader();
    const heartbeat = setInterval(() => {
      if (isForegroundTab()) claimImportPollLeader();
    }, IMPORT_POLL_HEARTBEAT_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('storage', onStorage);
      releaseImportPollLeader();
    };
  }, [claimImportPollLeader, isForegroundTab, releaseImportPollLeader]);

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

  const upsertImportJob = useCallback((job) => {
    if (!job?.id) return;
    setImportJobs((prev) => {
      const next = [...prev];
      const idx = next.findIndex((j) => Number(j.id) === Number(job.id));
      if (idx >= 0) next[idx] = { ...next[idx], ...job };
      else next.unshift(job);
      return next.slice(0, 30);
    });
  }, []);

  const dismissImportJob = useCallback((jobId) => {
    setImportJobs((prev) => prev.filter((j) => Number(j.id) !== Number(jobId)));
  }, []);

  const hasActiveImportJobs = useMemo(
    () => importJobs.some((job) => job.status === 'queued' || job.status === 'running'),
    [importJobs]
  );

  const handleAuth = useCallback((usr) => {
    setUser(usr || null);
    setAuthChecked(true);
    window.history.replaceState({}, '', dashboardUrl(activeTab, activeIntegrationSection));
    setRoute('dashboard');
  }, [activeIntegrationSection, activeTab]);

  const logout = useCallback(async () => {
    try { await apiCall('post', '/auth/logout'); } catch (_) {}
    localStorage.removeItem('mediavault_token');
    setUser(null);
    setAuthChecked(true);
    setMediaItems([]);
    setImportJobs([]);
    localStorage.removeItem(IMPORT_JOBS_KEY);
    navigate('login');
  }, [apiCall, navigate]);

  const loadMedia = useCallback(async (opts = {}) => {
    const requestSeq = ++mediaRequestSeqRef.current;
    const params = new URLSearchParams();
    const passthrough = [
      'page', 'limit', 'search', 'format', 'media_type', 'sortBy', 'sortDir',
      'director', 'genre', 'resolution', 'yearMin', 'yearMax',
      'ratingMin', 'ratingMax', 'userRatingMin', 'userRatingMax'
    ];

    passthrough.forEach((key) => {
      const value = opts[key];
      if (value === undefined || value === null || value === '') return;
      if (key === 'format' && value === 'all') return;
      if (key === 'resolution' && value === 'all') return;
      params.set(key, String(value));
    });

    const query = params.toString();
    setMediaLoading(true);
    setMediaError('');
    try {
      const payload = await apiCall('get', `/media${query ? `?${query}` : ''}`);
      if (requestSeq !== mediaRequestSeqRef.current) return;
      if (Array.isArray(payload)) {
        setMediaItems(payload);
        setMediaPagination({ page: 1, limit: payload.length, total: payload.length, totalPages: 1, hasMore: false });
      } else {
        setMediaItems(payload?.items || []);
        setMediaPagination(payload?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
      }
    } catch (err) {
      if (requestSeq !== mediaRequestSeqRef.current) return;
      setMediaError(err.response?.data?.error || 'Failed to load media');
    } finally {
      if (requestSeq === mediaRequestSeqRef.current) setMediaLoading(false);
    }
  }, [apiCall]);

  const showToast = useCallback((message, type = 'ok') => setToast({ message, type }), []);

  const syncLibraryContext = useCallback(async ({ silent = false } = {}) => {
    if (!user) return null;
    try {
      const payload = await apiCall('get', '/libraries');
      const nextLibraries = Array.isArray(payload?.libraries) ? payload.libraries : [];
      let nextActiveLibraryId = Number(payload?.active_library_id || 0) || null;
      if (!nextActiveLibraryId && nextLibraries.length > 0) {
        nextActiveLibraryId = Number(nextLibraries[0].id);
      }

      setLibraries(nextLibraries);
      setActiveLibraryId(nextActiveLibraryId);
      setUser((prev) => {
        if (!prev) return prev;
        const prevActive = Number(prev.active_library_id || 0) || null;
        return prevActive === nextActiveLibraryId
          ? prev
          : { ...prev, active_library_id: nextActiveLibraryId };
      });
      return nextActiveLibraryId;
    } catch (error) {
      if (!silent) showToast(error.response?.data?.error || 'Failed to load libraries', 'error');
      return null;
    }
  }, [apiCall, showToast, user]);

  const addMedia = useCallback(async (payload) => {
    const created = await apiCall('post', '/media', payload);
    setMediaItems((m) => [created, ...m]);
    showToast('Added to library');
    return created;
  }, [apiCall, showToast]);

  const editMedia = useCallback(async (id, payload) => {
    const updated = await apiCall('patch', `/media/${id}`, payload);
    setMediaItems((m) => m.map((i) => (i.id === id ? updated : i)));
    showToast('Saved');
    return updated;
  }, [apiCall, showToast]);

  const deleteMedia = useCallback(async (id) => {
    await apiCall('delete', `/media/${id}`);
    setMediaItems((m) => m.filter((i) => i.id !== id));
    showToast('Deleted');
  }, [apiCall, showToast]);

  const rateMedia = useCallback(async (id, rating) => {
    const updated = await apiCall('patch', `/media/${id}`, { user_rating: rating });
    setMediaItems((m) => m.map((i) => (i.id === id ? updated : i)));
  }, [apiCall]);

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
    if (route !== 'dashboard') {
      setAuthChecked(true);
      return;
    }
    let active = true;
    (async () => {
      try {
        const me = await apiCall('get', '/auth/me');
        if (!active) return;
        setUser(me);
      } catch (_) {
        if (!active) return;
        setUser(null);
        window.history.replaceState({}, '', '/login');
        setRoute('login');
      } finally {
        if (active) setAuthChecked(true);
      }
    })();
    return () => { active = false; };
  }, [route, apiCall]);

  useEffect(() => {
    if (route === 'dashboard' && authChecked && user) loadMedia();
  }, [route, authChecked, user, loadMedia]);

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    syncLibraryContext({ silent: true });
  }, [route, authChecked, user, syncLibraryContext]);

  useEffect(() => {
    localStorage.setItem(IMPORT_JOBS_KEY, JSON.stringify(importJobs));
  }, [importJobs]);

  useEffect(() => {
    if (!user || !hasActiveImportJobs || !isImportPollLeader) return undefined;
    let cancelled = false;
    const poll = async () => {
      if (!claimImportPollLeader()) return;
      const now = Date.now();
      try {
        const lastPollTs = Number(localStorage.getItem(IMPORT_POLL_LAST_TS_KEY) || 0);
        if (Number.isFinite(lastPollTs) && lastPollTs > 0 && now - lastPollTs < 6000) return;
        localStorage.setItem(IMPORT_POLL_LAST_TS_KEY, String(now));
      } catch (_) {}

      try {
        const rows = await apiCall('get', '/media/sync-jobs?limit=50');
        if (cancelled || !Array.isArray(rows)) return;
        const byId = new Map(rows.map((r) => [Number(r.id), r]));
        setImportJobs((prev) => prev.map((job) => {
          const fresh = byId.get(Number(job.id));
          return fresh ? { ...job, ...fresh } : job;
        }));
      } catch (err) {
        if (err?.response?.status === 401 || err?.response?.status === 429) return;
      }
    };

    poll();
    const t = setInterval(poll, IMPORT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiCall, claimImportPollLeader, user, hasActiveImportJobs, isImportPollLeader]);

  if (route !== 'dashboard') {
    return (
      <AuthPageView
        route={route}
        onNavigate={navigate}
        onAuth={handleAuth}
        apiUrl={API_URL}
        appVersion={APP_VERSION}
        buildSha={BUILD_SHA}
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
        buildSha={BUILD_SHA}
        Icons={Icons}
        Spinner={Spinner}
        cx={cx}
      />
    );
  }

  const isAdminTab = String(activeTab || '').startsWith('admin-');
  const forcedMediaTypeByTab = {
    'library-movies': 'movie',
    'library-tv': 'tv',
    'library-books': 'book',
    'library-audio': 'audio',
    'library-games': 'game',
    'library-comics': 'comic_book'
  };
  const forcedMediaType = forcedMediaTypeByTab[activeTab] || 'movie';
  const activeLibrary = libraries.find((library) => Number(library.id) === Number(activeLibraryId)) || null;

  const renderTab = () => {
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
        return (
          <LibraryView
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
            forcedMediaType={forcedMediaType}
          />
        );
      case 'library-import':
        return (
          <ImportViewComponent
            apiCall={apiCall}
            onToast={showToast}
            onImported={() => loadMedia()}
            canImportPlex={user?.role === 'admin'}
            onQueueJob={upsertImportJob}
            importJobs={importJobs}
            apiUrl={API_URL}
            Icons={Icons}
            Spinner={Spinner}
            cx={cx}
            activeLibrary={activeLibrary}
          />
        );
      case 'profile':
        return <ProfileViewComponent user={user} apiCall={apiCall} onToast={showToast} Spinner={Spinner} />;
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
  };

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
      />

      <div className={cx('flex-1 flex flex-col min-w-0 transition-all duration-300', sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56')}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge lg:hidden shrink-0">
          <button onClick={() => setMobileNavOpen(true)} className="btn-icon"><Icons.Menu /></button>
          <span className="font-display text-lg tracking-wider text-gold">COLLECTZ</span>
        </div>

        <div className="flex-1 overflow-hidden">{renderTab()}</div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
