export const PLATFORM_PRODUCT_EDITION = 'platform';
export const LOCAL_PRODUCT_EDITION = 'local';
export const DEFAULT_PLATFORM_TAB = 'dashboard';
export const LEGACY_PRODUCT_FIELD = ['product', 'edition'].join('_');
export const SUPPORT_STAFF_ROLE = ['support', 'admin'].join('_');

const LEGACY_LOCAL_PRODUCT_EDITION = ['home', 'lab'].join('');

export function normalizeProductEdition(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === LOCAL_PRODUCT_EDITION || normalized === LEGACY_LOCAL_PRODUCT_EDITION
    ? LOCAL_PRODUCT_EDITION
    : PLATFORM_PRODUCT_EDITION;
}

export function isLocalProductEdition(value) {
  return normalizeProductEdition(value) === LOCAL_PRODUCT_EDITION;
}

export function getHelpSurfaceTitle(productEdition, isSupportStaff) {
  return 'Help';
}

export function getHelpNavLabel(productEdition, isSupportStaff) {
  return 'Help';
}

export function getHelpTabDefinitions(productEdition, isSupportStaff) {
  return [
    { id: 'guidance', label: 'Guidance' },
    { id: 'releases', label: 'Releases' }
  ];
}

export function getSafeHelpTab(productEdition, isSupportStaff, requestedTab) {
  const tabs = getHelpTabDefinitions(productEdition, isSupportStaff);
  const requested = String(requestedTab || '').trim().toLowerCase();
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id || 'guidance';
}

export function isSupportHelpEnabled(productEdition) {
  return !isLocalProductEdition(productEdition);
}

export function getLocalRuntimeAllowedTabs({
  userRole,
  showCollectibles = true,
  showEvents = true,
  canManageActiveSpace = false
} = {}) {
  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const allowed = new Set([
    'dashboard',
    'help',
    'profile',
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
    'library-import'
  ]);

  if (showCollectibles) {
    allowed.add('library-art');
    allowed.add('library-collectibles');
  }
  if (showEvents) allowed.add('library-events');

  if (normalizedRole === 'admin') {
    allowed.add('admin-merges');
    allowed.add('admin-settings');
    allowed.add('admin-integrations');
  }

  if (canManageActiveSpace) {
    allowed.add('space-manage');
  }

  return allowed;
}

export function getSupportAdminAllowedTabs() {
  return new Set([
    'help',
    'profile'
  ]);
}

export function getAllowedDashboardTabs(productEdition, options = {}) {
  if (String(options?.userRole || '').trim().toLowerCase() === SUPPORT_STAFF_ROLE) {
    return getSupportAdminAllowedTabs(productEdition, options);
  }
  if (isLocalProductEdition(productEdition)) return getLocalRuntimeAllowedTabs(options);
  if (!options?.platformBridgeEnabled) return getLocalRuntimeAllowedTabs(options);
  return null;
}

export function getDefaultDashboardTab(productEdition, { userRole } = {}) {
  const normalizedRole = String(userRole || '').trim().toLowerCase();
  if (normalizedRole === SUPPORT_STAFF_ROLE) return 'help';
  return DEFAULT_PLATFORM_TAB;
}

export function getSafeDashboardTab(productEdition, requestedTab, options = {}) {
  const allowed = getAllowedDashboardTabs(productEdition, options);
  const normalizedRequested = String(requestedTab || '').trim();
  if (!allowed) return normalizedRequested || getDefaultDashboardTab(productEdition, options);
  return allowed.has(normalizedRequested)
    ? normalizedRequested
    : getDefaultDashboardTab(productEdition, options);
}
