import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { parseSearch, stringifySearch } from './lib/router/search';

export function getRouter() {
  return createRouter({
    routeTree,
    context: { auth: undefined!, setupLoading: true, setupRequired: false },
    parseSearch,
    stringifySearch,
  });
}

declare module '@tanstack/history' {
  interface HistoryState {
    from?: string;
    message?: string;
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
