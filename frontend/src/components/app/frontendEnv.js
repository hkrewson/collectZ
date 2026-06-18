const viteEnv = import.meta.env || {};

export function readFrontendEnv(viteKey, fallback = '') {
  const runtimeConfig = typeof window === 'undefined' ? {} : window.__COLLECTZ_RUNTIME_CONFIG__ || {};
  if (Object.prototype.hasOwnProperty.call(runtimeConfig, viteKey)) {
    return runtimeConfig[viteKey];
  }

  const viteValue = viteEnv[viteKey];
  if (viteValue !== undefined && viteValue !== '') return viteValue;

  return fallback;
}

export function hasFrontendEnv(viteKey) {
  return String(readFrontendEnv(viteKey, '') || '').trim() !== '';
}
