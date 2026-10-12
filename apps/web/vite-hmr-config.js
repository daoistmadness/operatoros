export function resolveViteHmrConfig(env) {
  const rawPort = env.VITE_HMR_CLIENT_PORT;
  const clientPort = rawPort ? Number(rawPort) : undefined;
  const protocol = env.VITE_HMR_PROTOCOL;
  if (clientPort !== undefined && (!Number.isInteger(clientPort) || clientPort < 1 || clientPort > 65535)) {
    throw new Error(`Invalid VITE_HMR_CLIENT_PORT: ${rawPort}`);
  }
  if (protocol && !['ws', 'wss'].includes(protocol)) throw new Error(`Invalid VITE_HMR_PROTOCOL: ${protocol}`);
  return {
    host: env.VITE_HMR_HOST || '127.0.0.1',
    ...(protocol ? { protocol } : {}),
    ...(clientPort ? { clientPort } : {}),
  };
}
