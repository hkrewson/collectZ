const path = require('path');
const { defineConfig, loadEnv, transformWithEsbuild } = require('vite');
const react = require('@vitejs/plugin-react');

function jsxInJsPlugin() {
  const srcRoot = `${path.resolve(process.cwd(), 'src')}${path.sep}`;
  return {
    name: 'collectz-jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.startsWith(srcRoot) || !id.endsWith('.js')) {
        return null;
      }
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic'
      });
    }
  };
}

module.exports = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = String(env.VITE_PROXY_TARGET || env.REACT_APP_PROXY_TARGET || 'http://localhost:3001').trim() || 'http://localhost:3001';
  const reactAppEnv = {
    REACT_APP_API_URL: env.REACT_APP_API_URL || env.VITE_API_URL || '/api',
    REACT_APP_VERSION: env.REACT_APP_VERSION || env.VITE_APP_VERSION || '',
    REACT_APP_DEBUG: env.REACT_APP_DEBUG || env.VITE_DEBUG || '0',
    NODE_ENV: mode === 'production' ? 'production' : 'development'
  };

  return {
    plugins: [jsxInJsPlugin(), react()],
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
