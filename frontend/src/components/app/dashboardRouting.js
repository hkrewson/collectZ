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
  return tab;
}

export function readDashboardStateFromUrl() {
  const path = String(window.location.pathname || '');
  const libMatch = path.match(/^\/library\/(movies|tv|books|audio|art|games|comics|wishlist|capture|loans|collectibles|events|other|import|import-review)\/?$/);
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
  const normalizedTab = normalizeDashboardTab(tab);
  return {
    tab: VALID_DASHBOARD_TABS.has(normalizedTab) ? normalizedTab : DEFAULT_TAB,
    integrationSection: VALID_INTEGRATION_SECTIONS.has(integration) ? integration : DEFAULT_INTEGRATION_SECTION
  };
}

export function dashboardUrl(tab, integrationSection) {
  const params = new URLSearchParams();
  if (tab && tab !== DEFAULT_TAB) params.set('tab', tab);
  if (tab === 'admin-integrations' && integrationSection && integrationSection !== DEFAULT_INTEGRATION_SECTION) {
    params.set('integration', integrationSection);
  }
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ''}`;
}
