export const PLATFORM_PRODUCT_EDITION = 'platform';
export const HOMELAB_PRODUCT_EDITION = 'homelab';
export const DEFAULT_PLATFORM_TAB = 'library-movies';

export function normalizeProductEdition(value) {
  return String(value || '').trim().toLowerCase() === HOMELAB_PRODUCT_EDITION
    ? HOMELAB_PRODUCT_EDITION
    : PLATFORM_PRODUCT_EDITION;
}

export function isHomelabEdition(value) {
  return normalizeProductEdition(value) === HOMELAB_PRODUCT_EDITION;
}

export function getHelpSurfaceTitle(productEdition, isSupportStaff) {
  if (isHomelabEdition(productEdition)) return 'Help';
  return isSupportStaff ? 'Help Admin' : 'Help Center';
}

export function getHelpNavLabel(productEdition, isSupportStaff) {
  if (isHomelabEdition(productEdition)) return 'Help';
  return isSupportStaff ? 'Help Admin' : 'Help';
}

export function getHelpTabDefinitions(productEdition, isSupportStaff) {
  if (isHomelabEdition(productEdition)) {
    return [
      { id: 'guidance', label: 'Guidance' },
      { id: 'releases', label: 'Releases' }
    ];
  }
  return [
    { id: 'guidance', label: 'Guidance' },
    { id: 'releases', label: 'Releases' },
    ...(isSupportStaff ? [{ id: 'metrics', label: 'Metrics' }] : []),
    { id: 'support', label: 'Support' }
  ];
}

export function getSafeHelpTab(productEdition, isSupportStaff, requestedTab) {
  const tabs = getHelpTabDefinitions(productEdition, isSupportStaff);
  const requested = String(requestedTab || '').trim().toLowerCase();
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id || 'guidance';
}

export function isSupportHelpEnabled(productEdition) {
  return !isHomelabEdition(productEdition);
}

export function getHomelabAllowedTabs({
  userRole,
  supportSessionActive = false,
  canManageActiveSpace = false,
  showCollectibles = true,
  showEvents = true
} = {}) {
  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const allowed = new Set([
    'help',
    'profile',
    'library',
    'library-movies',
    'library-tv',
    'library-books',
    'library-audio',
    'library-games',
    'library-comics',
    'library-import'
  ]);

  if (showCollectibles) allowed.add('library-collectibles');
  if (showEvents) allowed.add('library-events');

  if (normalizedRole === 'admin') {
    allowed.add('admin-settings');
    allowed.add('admin-integrations');
  }

  if (normalizedRole === 'support_admin') {
    allowed.add('help');
    allowed.add('profile');
    if (supportSessionActive && canManageActiveSpace) {
      allowed.add('space-manage');
    }
  }

  return allowed;
}

export function getSupportAdminAllowedTabs(productEdition, {
  supportSessionActive = false,
  canManageActiveSpace = false
} = {}) {
  const allowed = new Set([
    'help',
    'profile'
  ]);

  if (!isHomelabEdition(productEdition)) {
    allowed.add('support-inbox');
  }

  if (supportSessionActive && canManageActiveSpace) {
    allowed.add('space-manage');
  }

  return allowed;
}

export function getAllowedDashboardTabs(productEdition, options = {}) {
  if (String(options?.userRole || '').trim().toLowerCase() === 'support_admin') {
    return getSupportAdminAllowedTabs(productEdition, options);
  }
  if (isHomelabEdition(productEdition)) return getHomelabAllowedTabs(options);
  return null;
}

export function getDefaultDashboardTab(productEdition, { userRole } = {}) {
  const normalizedRole = String(userRole || '').trim().toLowerCase();
  if (normalizedRole === 'support_admin') return 'help';
  if (isHomelabEdition(productEdition)) {
    if (normalizedRole === 'admin') return 'admin-settings';
  }
  return DEFAULT_PLATFORM_TAB;
}

export function getSafeDashboardTab(productEdition, requestedTab, options = {}) {
  const allowed = getAllowedDashboardTabs(productEdition, options);
  const normalizedRequested = String(requestedTab || '').trim();
  if (isHomelabEdition(productEdition) && normalizedRequested === 'support-inbox') {
    return 'help';
  }
  if (!allowed) return normalizedRequested || getDefaultDashboardTab(productEdition, options);
  return allowed.has(normalizedRequested)
    ? normalizedRequested
    : getDefaultDashboardTab(productEdition, options);
}
