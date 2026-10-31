import { statSync } from 'node:fs';
import path from 'node:path';

const loopback = '127.0.0.1';

export function readViteRuntimeConfig(env = process.env) {
  const rawFrontendPort = env.FRONTEND_PORT ?? '5173';
  const rawBackendPort = env.BACKEND_PORT ?? '8000';
  const frontendPort = Number(rawFrontendPort);
  const backendPort = Number(rawBackendPort);

  if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
    throw new Error(`Invalid FRONTEND_PORT: ${rawFrontendPort}`);
  }
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    throw new Error(`Invalid BACKEND_PORT: ${rawBackendPort}`);
  }

  const frontendHost = env.FRONTEND_HOST || loopback;
  const backendHost = env.BACKEND_HOST || loopback;
  for (const [name, value] of [['FRONTEND_HOST', frontendHost], ['BACKEND_HOST', backendHost], ['HOST', env.HOST || loopback]]) {
    if (value !== loopback) throw new Error(`${name} must be ${loopback} for development`);
  }

  const hmrHost = env.VITE_HMR_HOST?.trim() || loopback;
  const hmrProtocol = env.VITE_HMR_PROTOCOL?.trim() || 'ws';
  const rawHmrClientPort = env.VITE_HMR_CLIENT_PORT?.trim();
  const hmrClientPort = rawHmrClientPort ? Number(rawHmrClientPort) : frontendPort;
  const tailnetHost = env.VITE_TAILNET_HOST?.trim().toLowerCase();

  if (!['ws', 'wss'].includes(hmrProtocol)) {
    throw new Error('VITE_HMR_PROTOCOL must be ws or wss');
  }
  if (!Number.isInteger(hmrClientPort) || hmrClientPort < 1 || hmrClientPort > 65535) {
    throw new Error('VITE_HMR_CLIENT_PORT must be an integer from 1 to 65535');
  }
  if (tailnetHost && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(tailnetHost)) {
    throw new Error('VITE_TAILNET_HOST must be one exact *.ts.net hostname');
  }
  if (env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS?.trim()) {
    throw new Error('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS is not allowed for managed development');
  }
  if (env.VITE_API_BASE_URL?.trim()) {
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
  const devApiProxyTarget = env.DEV_API_PROXY_TARGET || expectedProxyTarget;
  if (devApiProxyTarget !== expectedProxyTarget) {
    throw new Error(`DEV_API_PROXY_TARGET must match BACKEND_PORT: ${expectedProxyTarget}`);
  }

  return {
    frontendPort,
    backendPort,
    frontendHost,
    backendHost,
    hmrHost,
    hmrProtocol,
    hmrClientPort,
    tailnetHost,
    devApiProxyTarget,
  };
}

export function createApiProxy(target) {
  return Object.fromEntries(['/api', '/health', '/ready', '/openapi'].map((route) => [route, {
    target,
    changeOrigin: true,
    secure: false,
  }]));
}

export function spaShellFallbackPlugin() {
  return {
    name: 'operatoros-spa-shell-fallback',
    configurePreviewServer(server) {
      const clientDirectory = path.resolve(server.config.root, server.config.build.outDir);
      const protectedPrefixes = ['/api', '/health', '/ready', '/openapi'];

      server.middlewares.use((request, _response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        const url = new URL(request.url ?? '/', 'http://preview.local');
        if (protectedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return next();
        if (!request.headers.accept?.includes('text/html')) return next();

        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          return next();
        }

        const file = path.resolve(clientDirectory, `.${pathname}`);
        if (file.startsWith(`${clientDirectory}${path.sep}`)) {
          try {
            if (statSync(file).isFile()) return next();
          } catch {}
        }

        request.url = `/_shell.html${url.search}`;
        next();
      });
    },
  };
}
