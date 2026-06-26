export const VALID_DASHBOARD_TABS = new Set([
  'dashboard',
  'help',
  'support-inbox',
  'library',
  'library-movies',
  'library-tv',
  'library-books',
  'library-audio',
  'library-art',
  'library-games',
  'library-comics',
  'library-saved-views',
  'library-wishlist',
  'library-capture',
  'library-loans',
  'library-collectibles',
  'library-events',
  'library-other',
  'library-import',
  'space-manage',
  'admin-spaces',
  'profile',
  'admin-users',
  'admin-merges',
  'admin-activity',
  'admin-settings',
  'admin-flags',
  'admin-integrations'
]);

export const VALID_INTEGRATION_SECTIONS = new Set([
  'audio',
  'barcode',
  'books',
  'comics',
  'ebay',
  'games',
  'logs',
  'metrics',
  'plex',
  'pricecharting',
  'tmdb'
]);
export const DEFAULT_TAB = 'dashboard';
export const DEFAULT_INTEGRATION_SECTION = 'audio';

function normalizeDashboardTab(tab) {
  if (tab === 'library-other') return 'library-comics';
  if (tab === 'library-import-review') return 'library-import';
  if (tab === 'admin-feature-flags') return 'admin-flags';
  return tab;
}

const CANONICAL_TAB_ROUTES = {
  dashboard: '/dashboard',
  help: '/help',
  'support-inbox': '/platform/support',
  library: '/library',
  'library-movies': '/library/movies',
  'library-tv': '/library/tv',
  'library-books': '/library/books',
  'library-audio': '/library/audio',
  'library-art': '/library/art',
  'library-games': '/library/games',
  'library-comics': '/library/comics',
  'library-saved-views': '/library/saved-views',
  'library-wishlist': '/library/wishlist',
  'library-capture': '/library/capture',
  'library-loans': '/library/loans',
  'library-collectibles': '/library/collectibles',
  'library-events': '/library/events',
  'library-import': '/library/import',
  profile: '/profile',
  'space-manage': '/workspace/settings',
  'admin-merges': '/workspace/review',
  'admin-spaces': '/platform/workspaces',
  'admin-users': '/platform/users',
  'admin-activity': '/platform/activity',
  'admin-settings': '/platform/settings',
  'admin-flags': '/platform/feature-flags',
  'admin-integrations': '/platform/runtime'
};

const LOCAL_ADMIN_TAB_ROUTES = {
  'admin-settings': '/settings',
  'admin-integrations': '/integrations'
};

const DIRECT_TAB_ROUTES = new Map(Object.entries({
  '/dashboard': 'dashboard',
  '/help': 'help',
  '/support': 'support-inbox',
  '/platform/support': 'support-inbox',
  '/library': 'library',
  '/profile': 'profile',
  '/workspace': 'space-manage',
  '/workspace/settings': 'space-manage',
  '/workspace/review': 'admin-merges',
  '/review': 'admin-merges',
  '/platform/workspaces': 'admin-spaces',
  '/platform/users': 'admin-users',
  '/platform/activity': 'admin-activity',
  '/platform/settings': 'admin-settings',
  '/platform/feature-flags': 'admin-flags',
  '/settings': 'admin-settings'
}));

function normalizePathname(pathname) {
  const rawPath = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  if (rawPath.length > 1 && rawPath.endsWith('/')) return rawPath.slice(0, -1);
  return rawPath;
}

function isLocalRouteContext(options = {}) {
  return !options?.platformBridgeEnabled || String(options?.productEdition || '').toLowerCase() === 'local';
}

function routeForTab(tab, options = {}) {
  const normalizedTab = normalizeDashboardTab(tab);
  if (isLocalRouteContext(options) && LOCAL_ADMIN_TAB_ROUTES[normalizedTab]) {
    return LOCAL_ADMIN_TAB_ROUTES[normalizedTab];
  }
  return CANONICAL_TAB_ROUTES[normalizedTab] || CANONICAL_TAB_ROUTES[DEFAULT_TAB];
}

export function readDashboardStateFromLocation(pathname, search = '') {
  const path = normalizePathname(pathname);
  const params = new URLSearchParams(search);
  const hasLegacyDashboardState = path === '/dashboard' && (
    params.has('tab') || params.has('integration')
  );
  const directTab = DIRECT_TAB_ROUTES.get(path);
  if (directTab && !hasLegacyDashboardState) {
    return {
      tab: directTab,
      integrationSection: DEFAULT_INTEGRATION_SECTION
    };
  }

  const libMatch = path.match(/^\/library\/(movies|tv|books|audio|art|games|comics|saved-views|wishlist|capture|loans|collectibles|events|other|import|import-review)$/);
  if (libMatch) {
    const slug = libMatch[1];
    return {
      tab: slug === 'import'
        ? 'library-import'
        : slug === 'import-review'
          ? 'library-import'
          : slug === 'other'
            ? 'library-comics'
            : `library-${slug}`,
      integrationSection: DEFAULT_INTEGRATION_SECTION
    };
  }

  const integrationMatch = path.match(/^\/(?:admin\/integrations|integrations|platform\/runtime)\/?([^/]+)?$/);
  if (integrationMatch) {
    const sec = String(integrationMatch[1] || '').toLowerCase();
    return {
      tab: 'admin-integrations',
      integrationSection: VALID_INTEGRATION_SECTIONS.has(sec) ? sec : DEFAULT_INTEGRATION_SECTION
    };
  }

  const tab = params.get('tab');
  const integration = params.get('integration');
  const normalizedTab = normalizeDashboardTab(tab);
  return {
    tab: VALID_DASHBOARD_TABS.has(normalizedTab) ? normalizedTab : DEFAULT_TAB,
    integrationSection: VALID_INTEGRATION_SECTIONS.has(integration) ? integration : DEFAULT_INTEGRATION_SECTION
  };
}

export function readDashboardStateFromUrl() {
  return readDashboardStateFromLocation(window.location.pathname, window.location.search);
}

export function isDashboardRoutePath(pathname) {
  const path = normalizePathname(pathname);
  if (DIRECT_TAB_ROUTES.has(path)) return true;
  if (path.startsWith('/dashboard/')) return true;
  if (/^\/library\/(movies|tv|books|audio|art|games|comics|saved-views|wishlist|capture|loans|collectibles|events|other|import|import-review)$/.test(path)) return true;
  if (/^\/(?:admin\/integrations|integrations|platform\/runtime)\/?([^/]+)?$/.test(path)) return true;
  return false;
}

export function dashboardUrl(tab, integrationSection, options = {}) {
  const normalizedTab = normalizeDashboardTab(tab);
  const baseRoute = routeForTab(normalizedTab, options);
  if (normalizedTab === 'admin-integrations' && integrationSection && integrationSection !== DEFAULT_INTEGRATION_SECTION) {
    return `${baseRoute}/${encodeURIComponent(integrationSection)}`;
  }
  return baseRoute;
}

export function appRouteUrl(nextRoute, tab, integrationSection, options = {}) {
  if (nextRoute === 'register') return '/register';
  if (nextRoute === 'forgot') return '/forgot-password';
  if (nextRoute === 'dashboard') return dashboardUrl(tab, integrationSection, options);
  if (nextRoute === 'reset') return '/reset-password';
  if (nextRoute === 'verify') return '/verify-email';
  return '/login';
}

export function legacyDashboardUrl(tab, integrationSection) {
  const params = new URLSearchParams();
  if (tab && tab !== DEFAULT_TAB) params.set('tab', tab);
  if (tab === 'admin-integrations' && integrationSection && integrationSection !== DEFAULT_INTEGRATION_SECTION) {
    params.set('integration', integrationSection);
  }
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ''}`;
}

export function selectDashboardTabValue(nextValue, {
  activeIntegrationSection,
  dashboardRouteOptions,
  setActiveTab,
  setActiveIntegrationSection,
  setRoute
}) {
  if (typeof nextValue === 'function') {
    setActiveTab(nextValue);
    return;
  }
  const nextTab = String(nextValue || DEFAULT_TAB);
  const nextIntegrationSection = nextTab === 'admin-integrations'
    ? activeIntegrationSection
    : DEFAULT_INTEGRATION_SECTION;
  setActiveTab(nextTab);
  if (nextTab !== 'admin-integrations') setActiveIntegrationSection(DEFAULT_INTEGRATION_SECTION);
  const nextUrl = dashboardUrl(nextTab, nextIntegrationSection, dashboardRouteOptions);
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) window.history.pushState({}, '', nextUrl);
  setRoute('dashboard');
}
