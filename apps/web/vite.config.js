import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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

const loopback = '127.0.0.1';
const frontendHost = process.env.FRONTEND_HOST || loopback;
const backendHost = process.env.BACKEND_HOST || loopback;
for (const [name, value] of [['FRONTEND_HOST', frontendHost], ['BACKEND_HOST', backendHost], ['HOST', process.env.HOST || loopback]]) {
  if (value !== loopback) throw new Error(`${name} must be ${loopback} for development`);
}
if (process.env.PORT && Number(process.env.PORT) !== frontendPort) {
  throw new Error(`PORT must match FRONTEND_PORT (${frontendPort}) for Vite`);
}

const hmrHost = process.env.VITE_HMR_HOST?.trim() || loopback;
const hmrProtocol = process.env.VITE_HMR_PROTOCOL?.trim() || 'ws';
const rawHmrClientPort = process.env.VITE_HMR_CLIENT_PORT?.trim();
const hmrClientPort = rawHmrClientPort ? Number(rawHmrClientPort) : frontendPort;
const tailnetHost = process.env.VITE_TAILNET_HOST?.trim().toLowerCase();
if (!['ws', 'wss'].includes(hmrProtocol)) {
  throw new Error('VITE_HMR_PROTOCOL must be ws or wss');
}
if (!Number.isInteger(hmrClientPort) || hmrClientPort < 1 || hmrClientPort > 65535) {
  throw new Error('VITE_HMR_CLIENT_PORT must be an integer from 1 to 65535');
}
if (tailnetHost && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(tailnetHost)) {
  throw new Error('VITE_TAILNET_HOST must be one exact *.ts.net hostname');
}
if (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS?.trim()) {
  throw new Error('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS is not allowed for managed development');
}
if (process.env.VITE_API_BASE_URL?.trim()) {
  throw new Error('VITE_API_BASE_URL must be empty for same-origin development API requests');
}
if (tailnetHost) {
  if (hmrHost !== tailnetHost || hmrProtocol !== 'wss' || !rawHmrClientPort) {
    throw new Error('Tailnet HMR must use the exact Tailnet host, wss, and an explicit HTTPS client port');
  }
} else if (hmrHost !== loopback || hmrProtocol !== 'ws' || hmrClientPort !== frontendPort) {
  throw new Error('Local HMR must use loopback ws on FRONTEND_PORT');
}

const expectedProxyTarget = `http://${loopback}:${backendPort}`;
const devApiProxyTarget = process.env.DEV_API_PROXY_TARGET || expectedProxyTarget;
if (devApiProxyTarget !== expectedProxyTarget) {
  throw new Error(`DEV_API_PROXY_TARGET must match BACKEND_PORT: ${expectedProxyTarget}`);
}
const apiProxy = Object.fromEntries(['/api', '/health', '/ready', '/openapi'].map((path) => [path, {
    target: devApiProxyTarget,
    changeOrigin: true,
    secure: false,
  }]));

// vite.config.js
// Vite development server with API proxy and Vitest configuration.
// Tech Stack: Vite / React 19 / Vitest

export default defineConfig({
  envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  plugins: [tailwindcss(), react()],
  server: {
    host: frontendHost,
    port: frontendPort,
    strictPort: true,
    allowedHosts: tailnetHost ? [tailnetHost] : undefined,
    clearScreen: false,
    ws: {
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
  build: {
    outDir: 'build',
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './vitest.setup.js',
  },
});
