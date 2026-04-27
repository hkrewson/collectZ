const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = String(env.VITE_PROXY_TARGET || env.REACT_APP_PROXY_TARGET || 'http://localhost:3001').trim() || 'http://localhost:3001';
  const apiUrl = env.VITE_API_URL || env.REACT_APP_API_URL || '/api';
  const appVersion = env.VITE_APP_VERSION || env.REACT_APP_VERSION || '';
  const debug = env.VITE_DEBUG || env.REACT_APP_DEBUG || '0';
  const csrfCookieName = env.VITE_CSRF_COOKIE_NAME || env.REACT_APP_CSRF_COOKIE_NAME || 'csrf_token';
  const reactAppEnv = {
    REACT_APP_API_URL: apiUrl,
    REACT_APP_VERSION: appVersion,
    REACT_APP_DEBUG: debug,
    REACT_APP_CSRF_COOKIE_NAME: csrfCookieName,
    NODE_ENV: mode === 'production' ? 'production' : 'development'
  };

  return {
    plugins: [react()],
    optimizeDeps: {
      noDiscovery: true
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: Number(env.VITE_PREVIEW_PORT || 4173)
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    },
    define: Object.fromEntries(
      Object.entries(reactAppEnv).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])
    )
  };
});
