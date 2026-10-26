import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('FRONTEND_PORT', '5173');
  for (const name of ['FRONTEND_HOST', 'BACKEND_HOST', 'HOST', 'PORT', 'ALLOWED_ORIGINS', 'COOKIE_SECURE', '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', 'OPERATOROS_DISABLE_ENV_FILES', 'VITE_HMR_HOST', 'VITE_HMR_PROTOCOL', 'VITE_HMR_CLIENT_PORT', 'VITE_TAILNET_HOST', 'VITE_API_BASE_URL', 'BACKEND_PORT', 'DEV_API_PROXY_TARGET']) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
const load = async () => (await import('../vite.config.js')).default;

it('uses Vite 8 websocket config with local hot reload and host restrictions by default', async () => {
  const config = await load();
  expect(config.server.ws.host).toBe('127.0.0.1');
  expect(config.server.ws.port).toBe(5173);
  expect(config.server.ws.clientPort).toBe(5173);
  expect(config.server.ws.protocol).toBe('ws');
  expect(config.server.hmr).toBeUndefined();
  expect(config.server.host).toBe('127.0.0.1');
  expect(config.preview.host).toBe('127.0.0.1');
  expect(config.envDir).toBeUndefined();
  expect(config.server.allowedHosts).not.toBe(true);
});

it('binds the frontend explicitly and disables env files for isolated development containers', async () => {
  vi.stubEnv('FRONTEND_HOST', '0.0.0.0');
  vi.stubEnv('OPERATOROS_DISABLE_ENV_FILES', 'true');
  await expect(load()).rejects.toThrow('FRONTEND_HOST must be 127.0.0.1');
});

it.each(['FRONTEND_HOST', 'BACKEND_HOST', 'HOST'])('rejects a non-loopback %s override', async (name) => {
  vi.stubEnv(name, '0.0.0.0');
  await expect(load()).rejects.toThrow(`${name} must be 127.0.0.1`);
});

it('resolves to loopback, exact proxy and HMR settings under poisoned inherited values', async () => {
  vi.stubEnv('OPERATOROS_DISABLE_ENV_FILES', 'true');
  vi.stubEnv('FRONTEND_PORT', '5198');
  vi.stubEnv('BACKEND_PORT', '8098');
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('PORT', '5198');
  vi.stubEnv('FRONTEND_HOST', '127.0.0.1');
  vi.stubEnv('BACKEND_HOST', '127.0.0.1');
  vi.stubEnv('VITE_HMR_HOST', '127.0.0.1');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'ws');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '5198');
  vi.stubEnv('VITE_TAILNET_HOST', '');
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://127.0.0.1:8098');
  vi.stubEnv('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', '');
  const resolved = await resolveConfig(await load(), 'serve', 'development');
  expect(resolved.server.host).toBe('127.0.0.1');
  expect(resolved.server.port).toBe(5198);
  expect(resolved.server.ws).toMatchObject({ host: '127.0.0.1', port: 5198, protocol: 'ws', clientPort: 5198 });
  expect(resolved.server.allowedHosts).not.toBe(true);
  for (const route of ['/api', '/health', '/ready', '/openapi']) expect(resolved.server.proxy[route].target).toBe('http://127.0.0.1:8098');
});

it('does not load hostile Vite environment files when the launcher disables them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operatoros-vite-env-'));
  try {
    writeFileSync(path.join(root, '.env'), [
      'VITE_TAILNET_HOST=attacker.example',
      'VITE_HMR_HOST=attacker.example',
      'VITE_HMR_PROTOCOL=wss',
      'VITE_HMR_CLIENT_PORT=8443',
      'VITE_API_BASE_URL=https://attacker.example/api',
      '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=*',
      'FRONTEND_HOST=0.0.0.0',
      'ALLOWED_ORIGINS=*',
      'COOKIE_SECURE=true',
    ].join('\n'));
    vi.stubEnv('OPERATOROS_DISABLE_ENV_FILES', 'true');
    const resolved = await resolveConfig({ ...await load(), root }, 'serve', 'development');
    expect(resolved.envDir).toBe(false);
    expect(resolved.server.host).toBe('127.0.0.1');
    expect(resolved.server.ws).toMatchObject({ host: '127.0.0.1', protocol: 'ws', clientPort: 5173 });
    expect(resolved.server.allowedHosts).not.toContain('attacker.example');
    expect(resolved.env.VITE_API_BASE_URL).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('clears Tailnet settings when returning to local mode and enforces exact Tailnet HMR when enabled', async () => {
  vi.stubEnv('FRONTEND_PORT', '5198');
  vi.stubEnv('BACKEND_PORT', '8098');
  vi.stubEnv('VITE_TAILNET_HOST', 'node.tailnet.ts.net');
  vi.stubEnv('VITE_HMR_HOST', 'node.tailnet.ts.net');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'wss');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '8444');
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://127.0.0.1:8098');
  let config = await load();
  expect(config.server.allowedHosts).toEqual(['node.tailnet.ts.net']);
  expect(config.server.ws).toEqual({ host: 'node.tailnet.ts.net', port: 5198, protocol: 'wss', clientPort: 8444 });

  vi.resetModules();
  vi.stubEnv('VITE_TAILNET_HOST', '');
  vi.stubEnv('VITE_HMR_HOST', '127.0.0.1');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'ws');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '5198');
  config = await load();
  expect(config.server.allowedHosts).toBeUndefined();
  expect(config.server.ws).toEqual({ host: '127.0.0.1', port: 5198, protocol: 'ws', clientPort: 5198 });

  vi.resetModules();
  vi.stubEnv('VITE_TAILNET_HOST', 'node.tailnet.ts.net');
  vi.stubEnv('VITE_HMR_HOST', 'node.tailnet.ts.net');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'wss');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '8444');
  config = await load();
  expect(config.server.allowedHosts).toEqual(['node.tailnet.ts.net']);
  expect(config.server.ws).toEqual({ host: 'node.tailnet.ts.net', port: 5198, protocol: 'wss', clientPort: 8444 });
});

it('rejects inherited extra host, API and Tailnet HMR overrides', async () => {
  vi.stubEnv('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', '*');
  await expect(load()).rejects.toThrow('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS');
  vi.resetModules();
  vi.stubEnv('__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', '');
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
  await expect(load()).rejects.toThrow('VITE_API_BASE_URL');
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_HMR_HOST', 'attacker.example');
  await expect(load()).rejects.toThrow('Local HMR');
  vi.resetModules();
  vi.stubEnv('VITE_HMR_HOST', '127.0.0.1');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'wss');
  await expect(load()).rejects.toThrow('Local HMR');
  vi.resetModules();
  vi.stubEnv('VITE_HMR_PROTOCOL', 'ws');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '8444');
  await expect(load()).rejects.toThrow('Local HMR');
});

it('rejects foreign proxy targets and mismatched backend ports', async () => {
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://api.example.test:9000');
  await expect(load()).rejects.toThrow('DEV_API_PROXY_TARGET');
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://127.0.0.1:8000');
  vi.stubEnv('BACKEND_PORT', '8098');
  await expect(load()).rejects.toThrow('DEV_API_PROXY_TARGET');
});

it('disables env files for the managed launcher', async () => {
  vi.stubEnv('OPERATOROS_DISABLE_ENV_FILES', 'true');
  const config = await load();
  expect(config.envDir).toBe(false);
});

it('advertises an HTTPS reverse proxy without changing the listening port', async () => {
  vi.stubEnv('FRONTEND_PORT', '5198');
  vi.stubEnv('BACKEND_PORT', '8098');
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://127.0.0.1:8098');
  vi.stubEnv('VITE_HMR_HOST', 'dev.example.ts.net');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'wss');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '8444');
  vi.stubEnv('VITE_TAILNET_HOST', 'dev.example.ts.net');
  const config = await load();
  expect(config.server.port).toBe(5198);
  expect(config.server.ws).toEqual({ host: 'dev.example.ts.net', port: 5198, protocol: 'wss', clientPort: 8444 });
  expect(config.server.allowedHosts).toEqual(['dev.example.ts.net']);
  for (const route of ['/api', '/health', '/ready', '/openapi']) expect(config.server.proxy[route].target).toBe('http://127.0.0.1:8098');
});

it('resolves the @ alias to the web source root', async () => {
  const config = await load();
  expect(config.resolve.alias['@']).toBe(path.resolve(process.cwd(), 'src'));
});

it('proxies every same-origin backend route to the selected backend port', async () => {
  let config = await load();
  for (const route of ['/api', '/health', '/ready', '/openapi']) {
    expect(config.server.proxy[route]).toEqual({ target: 'http://127.0.0.1:8000', changeOrigin: true, secure: false });
    expect(config.preview.proxy[route]).toBe(config.server.proxy[route]);
  }

  vi.resetModules();
  vi.stubEnv('BACKEND_PORT', '8123');
  config = await load();
  for (const route of ['/api', '/health', '/ready', '/openapi']) expect(config.server.proxy[route].target).toBe('http://127.0.0.1:8123');

  vi.resetModules();
  vi.stubEnv('DEV_API_PROXY_TARGET', 'http://backend.example.test:9000');
  await expect(load()).rejects.toThrow('DEV_API_PROXY_TARGET');
});

it('rejects wildcard and non-tailnet Vite host permissions', async () => {
  vi.stubEnv('VITE_TAILNET_HOST', '*.example.com');
  await expect(load()).rejects.toThrow('VITE_TAILNET_HOST');
});

it('does not register JSX-in-JS compatibility tooling', async () => {
  const config = await load();
  expect(config.plugins.map((plugin) => plugin.name)).not.toContain('treat-js-files-as-jsx');
  expect(config.optimizeDeps).toBeUndefined();
});

it.each(['0', '65536', '1.5', 'invalid'])('rejects invalid client port %s', async (port) => {
  vi.stubEnv('VITE_HMR_CLIENT_PORT', port);
  await expect(load()).rejects.toThrow('VITE_HMR_CLIENT_PORT');
});

it('rejects an unsupported websocket protocol', async () => {
  vi.stubEnv('VITE_HMR_PROTOCOL', 'https');
  await expect(load()).rejects.toThrow('VITE_HMR_PROTOCOL');
});
