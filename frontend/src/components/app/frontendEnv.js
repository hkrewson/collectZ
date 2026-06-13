const viteEnv = import.meta.env || {};

export function readFrontendEnv(viteKey, fallback = '') {
  const viteValue = viteEnv[viteKey];
  if (viteValue !== undefined && viteValue !== '') return viteValue;

  return fallback;
}
