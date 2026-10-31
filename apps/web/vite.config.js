import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import path from 'node:path';
import { createApiProxy, readViteRuntimeConfig, spaShellFallbackPlugin } from './vite.shared.js';

const runtime = readViteRuntimeConfig();
const apiProxy = createApiProxy(runtime.devApiProxyTarget);
const { frontendPort, frontendHost, hmrHost, hmrProtocol, hmrClientPort, tailnetHost } = runtime;

export { apiProxy, frontendHost, frontendPort, spaShellFallbackPlugin };

export default defineConfig({
  envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  plugins: [
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/_shell.html' } },
      router: {
        routeFileIgnorePattern: '\\.test\\.|RouteLoadingFallback|lazyRoute|routeGroups|routeDefinitions|AttendanceCompatibilityRedirect|ReportCompatibilityRedirect|RouteErrorBoundary',
        generatedRouteTree: 'routeTree.gen.ts',
      },
    }),
    tailwindcss(),
    react(),
  ],
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
    manifest: true,
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './vitest.setup.js',
  },
});
