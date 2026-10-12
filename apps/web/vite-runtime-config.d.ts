export type ViteRuntimeEnvironment = {
  FRONTEND_HOST?: string;
  OPERATOROS_DISABLE_ENV_FILES?: string;
};

export function resolveViteRuntimeConfig(env: ViteRuntimeEnvironment): {
  host: string;
  envDir?: false;
};
