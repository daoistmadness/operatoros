import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as vite from 'vite';
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

const devApiProxyTarget = process.env.DEV_API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`;

// vite.config.js
// Vite development server with API proxy, Vitest configuration, and JSX-in-JS transform support.
// Tech Stack: Vite / React 19 / Vitest

export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  plugins: [
    react(),
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        return vite.transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    strictPort: true,
    clearScreen: false,
    hmr: {
      host: '127.0.0.1',
      port: frontendPort,
    },
    proxy: {
      '/api': {
        target: devApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
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
