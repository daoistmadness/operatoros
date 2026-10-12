import { expect, test } from 'vitest';
import { resolveViteHmrConfig } from '../../vite-hmr-config.js';
import { resolveViteRuntimeConfig } from '../../vite-runtime-config.js';

test('uses the Tailscale websocket endpoint when configured', () => {
  expect(resolveViteHmrConfig({
    VITE_HMR_HOST: 'oprserver.taile856.ts.net',
    VITE_HMR_PROTOCOL: 'wss',
    VITE_HMR_CLIENT_PORT: '8444',
  })).toEqual({ host: 'oprserver.taile856.ts.net', protocol: 'wss', clientPort: 8444 });
});

test('keeps the native localhost websocket default', () => {
  expect(resolveViteHmrConfig({})).toEqual({ host: '127.0.0.1' });
});

test('keeps native Vite loopback defaults and supports an explicit container bind', () => {
  expect(resolveViteRuntimeConfig({})).toEqual({ host: '127.0.0.1', envDir: undefined });
  expect(resolveViteRuntimeConfig({
    FRONTEND_HOST: '0.0.0.0',
    OPERATOROS_DISABLE_ENV_FILES: 'true',
  })).toEqual({ host: '0.0.0.0', envDir: false });
});

test('rejects an invalid websocket protocol or client port', () => {
  expect(() => resolveViteHmrConfig({ VITE_HMR_PROTOCOL: 'https' })).toThrow('Invalid VITE_HMR_PROTOCOL');
  expect(() => resolveViteHmrConfig({ VITE_HMR_CLIENT_PORT: '65536' })).toThrow('Invalid VITE_HMR_CLIENT_PORT');
});
