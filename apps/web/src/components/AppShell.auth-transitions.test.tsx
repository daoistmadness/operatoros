import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, logout } from '../api/auth';
import { AuthContext, AuthProvider, useAuth, type AuthContextValue } from '../context/AuthContext';
import { createTestQueryClient } from '../lib/query/queryClient';
import { queryKeys } from '../lib/query/queryKeys';
import { Route as AuthenticatedRoute } from '../routes/_authenticated';
import { authorizeRoute, type RouterContext } from '../lib/router/access';

vi.mock('./SidebarNav', () => ({ default: () => null }));
vi.mock('../api/auth', () => ({ getCurrentUser: vi.fn(), login: vi.fn(), logout: vi.fn() }));

const AuthenticatedLayout = AuthenticatedRoute.options.component!;
const admin = auth('admin', ['view_attendance']);
const staffWithAttendance = auth('staff', ['view_attendance']);
const staffWithoutAttendance = auth('staff', []);
const roots: Root[] = [];
const containers: HTMLDivElement[] = [];
const clients: QueryClient[] = [];

function auth(role: 'admin' | 'staff', capabilities: string[]): AuthContextValue {
  const user = { id: role === 'admin' ? 1 : 2, username: role, role, capabilities };
  return {
    user,
    loading: false,
    authenticated: true,
    can: (capability) => capabilities.includes(capability),
    login: async () => ({ ...user }),
    logout: async () => undefined,
  };
}

function createVisibilityRouter(path: string, initialAuth: AuthContextValue, pageComponent = ProtectedPage) {
  const root = createRootRouteWithContext<RouterContext>()({ component: Outlet });
  const parent = createRoute({
    getParentRoute: () => root,
    path: path.slice(1),
    beforeLoad: authorizeRoute(path),
    component: AuthenticatedLayout,
  });
  const page = createRoute({
    getParentRoute: () => parent,
    path: '/',
    component: pageComponent,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: 'login',
    component: () => <div data-testid="login-page">Sign in</div>,
  });
  const routeTree = root.addChildren([parent.addChildren([page]), login]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: initialAuth, setupLoading: false, setupRequired: false },
  });
}

function ProtectedPage() {
  return <div data-testid="protected-content">Privileged content</div>;
}

function renderRouter(router: ReturnType<typeof createVisibilityRouter>, client: QueryClient, value: AuthContextValue) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={value}>
        <RouterProvider router={router} context={{ auth: value, setupLoading: false, setupRequired: false }} />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

async function mount(path: string, initialAuth: AuthContextValue) {
  const router = createVisibilityRouter(path, initialAuth);
  await router.load();
  const client = createTestQueryClient();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  clients.push(client);
  await act(async () => { root.render(renderRouter(router, client, initialAuth)); });
  return { router, client, container, root };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  for (const client of clients.splice(0)) client.clear();
  vi.resetAllMocks();
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('protected content during authorization transitions', () => {
  it.each([
    ['role downgrade', '/data-portability', admin, staffWithAttendance],
    ['capability revocation', '/attendance/calendar', staffWithAttendance, staffWithoutAttendance],
  ])('%s removes protected content before router guard revalidation finishes', async (_name, path, previousAuth, nextAuth) => {
    const view = await mount(path, previousAuth);
    expect(view.container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    await act(async () => { view.root.render(renderRouter(view.router, view.client, nextAuth)); });

    expect(view.container.querySelector('[data-testid="protected-content"]')).toBeNull();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Access denied');

    await act(async () => { await view.router.invalidate(); });
    expect(view.container.querySelector('[data-testid="protected-content"]')).toBeNull();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Access denied');
  });

  it('cancels protected requests before confirmed logout and hides their page when logout succeeds', async () => {
    const initialUser = admin.user!;
    let releaseLogout!: () => void;
    let markLogoutStarted!: () => void;
    let markRequestStarted!: () => void;
    let markAnonymous!: () => void;
    let requestSignal: AbortSignal | undefined;
    let logoutPromise: Promise<void> | undefined;
    const logoutResponse = new Promise<void>((resolve) => { releaseLogout = resolve; });
    const logoutStarted = new Promise<void>((resolve) => { markLogoutStarted = resolve; });
    const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
    const anonymous = new Promise<void>((resolve) => { markAnonymous = resolve; });
    vi.mocked(getCurrentUser).mockResolvedValueOnce(initialUser).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(logout).mockImplementation(() => {
      markLogoutStarted();
      return logoutResponse;
    });

    function PendingProtectedPage() {
      const auth = useAuth();
      useQuery({
        queryKey: ['protected', 'in-flight'],
        queryFn: ({ signal }) => new Promise<string>((_resolve, reject) => {
          requestSignal = signal;
          markRequestStarted();
          signal.addEventListener('abort', () => reject(new Error('request cancelled')), { once: true });
        }),
      });
      return (
        <>
          <div data-testid="protected-content">Privileged content</div>
          <button data-testid="logout" type="button" onClick={() => { logoutPromise = auth.logout(); }}>Sign out</button>
        </>
      );
    }

    function RouterFromAuth({ router }: { router: ReturnType<typeof createVisibilityRouter> }) {
      const auth = useAuth();
      useLayoutEffect(() => { void router.invalidate(); }, [auth.authenticated, auth.loading, auth.user]);
      return <RouterProvider router={router} context={{ auth, setupLoading: false, setupRequired: false }} />;
    }

    function AuthStateProbe() {
      const auth = useAuth();
      useLayoutEffect(() => {
        if (!auth.loading && !auth.authenticated) markAnonymous();
      }, [auth.authenticated, auth.loading]);
      return null;
    }

    const client = createTestQueryClient();
    const router = createVisibilityRouter('/data-portability', admin, PendingProtectedPage);
    await router.load();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    clients.push(client);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><AuthProvider><RouterFromAuth router={router} /><AuthStateProbe /></AuthProvider></QueryClientProvider>);
    });
    await requestStarted;
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    await act(async () => { (container.querySelector('[data-testid="logout"]') as HTMLButtonElement).click(); });
    await logoutStarted;
    expect(requestSignal?.aborted).toBe(true);
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    await act(async () => {
      releaseLogout();
      await logoutPromise;
      await anonymous;
    });
    expect(client.getQueryData(queryKeys.auth.me)).toBeNull();
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
    expect(container.querySelector('[data-testid="login-page"]')).not.toBeNull();
    expect(client.getQueryData(['protected', 'in-flight'])).toBeUndefined();
  });
});
