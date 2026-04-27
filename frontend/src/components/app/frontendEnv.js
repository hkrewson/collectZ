const viteEnv = import.meta.env || {};
const legacyEnv = typeof process !== 'undefined' && process.env ? process.env : {};

export function readFrontendEnv(viteKey, legacyKey, fallback = '') {
  const viteValue = viteEnv[viteKey];
  if (viteValue !== undefined && viteValue !== '') return viteValue;

  const legacyValue = legacyKey ? legacyEnv[legacyKey] : undefined;
  if (legacyValue !== undefined && legacyValue !== '') return legacyValue;

  return fallback;
}
