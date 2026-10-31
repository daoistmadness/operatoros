import { defineConfig } from 'vite';
import { createApiProxy, readViteRuntimeConfig, spaShellFallbackPlugin } from './vite.shared.js';

const runtime = readViteRuntimeConfig();

export default defineConfig({
  appType: 'custom',
  envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,
  plugins: [spaShellFallbackPlugin()],
  build: { outDir: 'build/client', manifest: true },
  preview: {
    host: runtime.frontendHost,
    port: runtime.frontendPort,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    proxy: createApiProxy(runtime.devApiProxyTarget),
  },
});
