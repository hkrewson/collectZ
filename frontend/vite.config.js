const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');
const tailwindcssPlugin = require('@tailwindcss/vite');
const tailwindcss = tailwindcssPlugin.default || tailwindcssPlugin;

module.exports = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = String(env.VITE_PROXY_TARGET || 'http://localhost:3001').trim() || 'http://localhost:3001';

  return {
    plugins: [react(), tailwindcss()],
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
    }
  };
});
