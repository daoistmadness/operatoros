export type ViteHmrEnvironment = {
  VITE_HMR_HOST?: string;
  VITE_HMR_PROTOCOL?: string;
  VITE_HMR_CLIENT_PORT?: string;
};

export function resolveViteHmrConfig(env: ViteHmrEnvironment): {
  host: string;
  protocol?: 'ws' | 'wss';
  clientPort?: number;
};
