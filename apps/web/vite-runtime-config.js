export function resolveViteRuntimeConfig(env) {
  return {
    host: env.FRONTEND_HOST || '127.0.0.1',
    envDir: env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,
  };
}
