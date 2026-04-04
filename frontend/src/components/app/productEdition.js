export const PLATFORM_PRODUCT_EDITION = 'platform';
export const HOMELAB_PRODUCT_EDITION = 'homelab';

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
