import { Children, isValidElement, useLayoutEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  RouterContextProvider,
} from '@tanstack/react-router';
import { routeAuthorizations } from '../lib/router/access';
import { parseSearch, stringifySearch, validateSearch } from '../lib/router/search';

type RouteProps = { path: string; element: ReactNode; children?: ReactNode };
type MemoryRouterProps = { initialEntries?: string[]; children: ReactNode };
type TestRouterInstance = ReturnType<typeof createRouter>;
const TestRouterContextProvider = RouterContextProvider as unknown as ComponentType<{ router: unknown; children: ReactNode }>;

export function Route(_props: RouteProps) {
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function routeEntries(children: ReactNode): RouteProps[] {
  return Children.toArray(children).flatMap((child) => {
    if (isValidElement<RouteProps>(child) && child.type === Route) return [child.props];
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return routeEntries(child.props.children);
  });
}

function toTanStackPath(path: string): string {
  if (path === '*') return '$';
  if (path === '/') return '/';
  return path.replace(/:([A-Za-z0-9_]+)/g, '$$$1').replace(/^\//, '');
}

export function MemoryRouter({ initialEntries = ['/'], children }: MemoryRouterProps) {
  const [router] = useState(() => {
    const entries = routeEntries(children);
    const testPages = new Map(entries.map(({ path, element }) => [toTanStackPath(path), element]));
    const rootRoute = createRootRoute({ component: Outlet, validateSearch });
    const authenticatedRoute = createRoute({ getParentRoute: () => rootRoute, id: '/_authenticated', component: Outlet, validateSearch });
    const paths = new Set([...Object.keys(routeAuthorizations), '/login'].map(toTanStackPath));
    for (const path of testPages.keys()) paths.add(path);
    const routes = [...paths].map((path) => createRoute({
      getParentRoute: () => authenticatedRoute,
      path,
      component: () => {
        const page = testPages.get(path);
        return page ?? (entries.length ? null : <>{children}</>);
      },
    }));
    const routeTree = rootRoute.addChildren([authenticatedRoute.addChildren(routes)]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries }),
      parseSearch,
      stringifySearch,
    });
    return router;
  });
  const needsRouteMatches = routeEntries(children).length > 0 || initialEntries.some((entry) => {
    const pathname = new URL(entry, 'http://test.local').pathname;
    return Object.keys(routeAuthorizations).some((path) => path.includes(':') && matchPath(path, pathname));
  });
  return needsRouteMatches
    ? <RouterProvider router={router} />
    : <TestRouterContext router={router}>{children}</TestRouterContext>;
}

function matchPath(pattern: string, pathname: string): boolean {
  const segments = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  return segments.length === actual.length && segments.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

function TestRouterContext({ router: value, children }: { router: unknown; children: ReactNode }) {
  const router = value as TestRouterInstance;
  useLayoutEffect(() => {
    const unsubscribe = router.history.subscribe(router.load);
    router.updateLatestLocation();
    void router.load({ sync: true });
    return unsubscribe;
  }, [router]);
  return <TestRouterContextProvider router={router}>{children}</TestRouterContextProvider>;
}
