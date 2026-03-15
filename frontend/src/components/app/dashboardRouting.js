export const VALID_DASHBOARD_TABS = new Set([
  'library',
  'library-movies',
  'library-tv',
  'library-books',
  'library-audio',
  'library-games',
  'library-comics',
  'library-collectibles',
  'library-events',
  'library-other',
  'library-import',
  'library-import-review',
  'space-manage',
  'profile',
  'admin-users',
  'admin-activity',
  'admin-settings',
  'admin-flags',
  'admin-integrations'
]);

export const VALID_INTEGRATION_SECTIONS = new Set(['audio', 'barcode', 'books', 'comics', 'games', 'plex', 'tmdb', 'vision']);
export const DEFAULT_TAB = 'library-movies';
export const DEFAULT_INTEGRATION_SECTION = 'audio';

export function readDashboardStateFromUrl() {
  const path = String(window.location.pathname || '');
  const libMatch = path.match(/^\/library\/(movies|tv|books|audio|games|comics|collectibles|events|other|import|import-review)\/?$/);
  if (libMatch) {
    const slug = libMatch[1];
    return {
      tab: slug === 'import'
        ? 'library-import'
        : slug === 'import-review'
          ? 'library-import-review'
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

export function dashboardUrl(tab, integrationSection) {
  const params = new URLSearchParams();
  if (tab && tab !== DEFAULT_TAB) params.set('tab', tab);
  if (tab === 'admin-integrations' && integrationSection && integrationSection !== DEFAULT_INTEGRATION_SECTION) {
    params.set('integration', integrationSection);
  }
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ''}`;
}
