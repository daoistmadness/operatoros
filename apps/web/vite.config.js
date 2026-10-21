import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const rawFrontendPort = process.env.FRONTEND_PORT ?? 5173;
const rawBackendPort = process.env.BACKEND_PORT ?? 8000;
const frontendPort = Number(rawFrontendPort);
const backendPort = Number(rawBackendPort);

if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
  throw new Error(`Invalid FRONTEND_PORT: ${rawFrontendPort}`);
}
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
  throw new Error(`Invalid BACKEND_PORT: ${rawBackendPort}`);
}

const hmrHost = process.env.VITE_HMR_HOST?.trim() || '127.0.0.1';
const hmrProtocol = process.env.VITE_HMR_PROTOCOL?.trim() || undefined;
const rawHmrClientPort = process.env.VITE_HMR_CLIENT_PORT?.trim();
const hmrClientPort = rawHmrClientPort ? Number(rawHmrClientPort) : undefined;
const frontendHost = process.env.FRONTEND_HOST || '127.0.0.1';
if (hmrProtocol && !['ws', 'wss'].includes(hmrProtocol)) {
  throw new Error('VITE_HMR_PROTOCOL must be ws or wss');
}
if (hmrClientPort !== undefined && (!Number.isInteger(hmrClientPort) || hmrClientPort < 1 || hmrClientPort > 65535)) {
  throw new Error('VITE_HMR_CLIENT_PORT must be an integer from 1 to 65535');
}

const devApiProxyTarget = process.env.DEV_API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`;
const apiProxy = {
  '/api': {
    target: devApiProxyTarget,
    changeOrigin: true,
    secure: false,
  },
};

// vite.config.js
// Vite development server with API proxy, Vitest configuration, and JSX-in-JS transform support.
// Tech Stack: Vite / React 19 / Vitest

export default defineConfig({
  envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  plugins: [
    react(),
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        return transformWithOxc(code, id, {
          lang: 'jsx',
          jsx: { runtime: 'automatic' },
        });
      },
    },
  ],
  server: {
    host: frontendHost,
    port: frontendPort,
    strictPort: true,
    clearScreen: false,
    hmr: {
      host: hmrHost,
      port: frontendPort,
      protocol: hmrProtocol,
      clientPort: hmrClientPort,
    },
    proxy: apiProxy,
  },
  preview: {
    host: frontendHost,
    port: frontendPort,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    proxy: apiProxy,
  },
  optimizeDeps: {
    rolldownOptions: {
      moduleTypes: { '.js': 'jsx' },
    },
  },
  build: {
    outDir: 'build',
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './vitest.setup.js',
  },
});
