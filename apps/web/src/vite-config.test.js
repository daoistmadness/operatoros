import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('FRONTEND_PORT', '5173');
  for (const name of ['VITE_HMR_HOST', 'VITE_HMR_PROTOCOL', 'VITE_HMR_CLIENT_PORT']) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
const load = async () => (await import('../vite.config.js')).default;

it('keeps local hot reload and host restrictions by default', async () => {
  const config = await load();
  expect(config.server.hmr.host).toBe('127.0.0.1');
  expect(config.server.hmr.port).toBe(5173);
  expect(config.server.hmr.clientPort).toBeUndefined();
  expect(config.server.hmr.protocol).toBeUndefined();
  expect(config.server.allowedHosts).not.toBe(true);
});

it('advertises an HTTPS reverse proxy without changing the listening port', async () => {
  vi.stubEnv('VITE_HMR_HOST', 'dev.example.test');
  vi.stubEnv('VITE_HMR_PROTOCOL', 'wss');
  vi.stubEnv('VITE_HMR_CLIENT_PORT', '8444');
  const config = await load();
  expect(config.server.hmr).toEqual({ host: 'dev.example.test', port: 5173, protocol: 'wss', clientPort: 8444 });
  expect(config.server.allowedHosts).not.toBe(true);
});

it.each(['0', '65536', '1.5', 'invalid'])('rejects invalid client port %s', async (port) => {
  vi.stubEnv('VITE_HMR_CLIENT_PORT', port);
  await expect(load()).rejects.toThrow('VITE_HMR_CLIENT_PORT');
});

it('rejects an unsupported websocket protocol', async () => {
  vi.stubEnv('VITE_HMR_PROTOCOL', 'https');
  await expect(load()).rejects.toThrow('VITE_HMR_PROTOCOL');
});
