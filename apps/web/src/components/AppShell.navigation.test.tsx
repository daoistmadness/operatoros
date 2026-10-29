import { act, type MouseEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import { AuthContext } from '../context/AuthContext';
import type { NavigationGroup } from '../lib/navigation/registry';
import { AppShell } from './AppShell';
import type { RouterContext } from '../lib/router/access';

vi.mock('./SidebarNav', () => ({
  default: ({ groups, onOpenCommandSearch }: {
    groups: readonly NavigationGroup[];
    onOpenCommandSearch: (event: MouseEvent<HTMLButtonElement>) => void;
  }) => (
    <aside data-testid="sidebar">
      <button type="button" aria-label="Search navigation" onClick={onOpenCommandSearch}>Search navigation</button>
      <span data-testid="sidebar-group-count">{groups.length}</span>
    </aside>
  ),
}));

const admin: AuthContextValue = {
  user: { id: 1, username: 'admin', role: 'admin', capabilities: ['view_student'] },
  loading: false,
  authenticated: true,
  can: (capability) => capability === 'view_student',
  login: async () => ({ id: 1, username: 'admin', role: 'admin', capabilities: ['view_student'] }),
  logout: async () => undefined,
};

function navigationRouter(auth: AuthContextValue) {
  const root = createRootRouteWithContext<RouterContext>()({ component: Outlet });
  const shell = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: AppShell,
  });
  const analytics = createRoute({
    getParentRoute: () => shell,
    path: 'analytics',
    component: () => <h1>Management Analytics</h1>,
  });
  const academic = createRoute({
    getParentRoute: () => shell,
    path: 'analytics/academic',
    component: () => <h1>Academic Analytics</h1>,
  });
  const routeTree = root.addChildren([shell.addChildren([analytics, academic])]);
  const context = { auth, setupLoading: false, setupRequired: false };
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/analytics'] }),
    context,
  });
}

describe('AppShell navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function render(auth = admin) {
    const router = navigationRouter(auth);
    await router.load();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AuthContext.Provider value={auth}>
          <RouterProvider router={router} context={{ auth, setupLoading: false, setupRequired: false }} />
        </AuthContext.Provider>,
      );
    });
  }

  it('shares registry labels across the breadcrumb and document title and navigates from Ctrl+K', async () => {
    await render();
    expect(document.title).toBe('Management Analytics | OperatorOS');
    expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain('Dashboard');
    expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain('Management Analytics');

    const shortcut = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { window.dispatchEvent(shortcut); });
    expect(shortcut.defaultPrevented).toBe(true);
    const search = document.querySelector<HTMLInputElement>('#navigation-search-input');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
    if (!search) throw new Error('Expected the command search input.');

    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setInputValue?.call(search, 'academic analytics');
    await act(async () => search.dispatchEvent(new Event('input', { bubbles: true })));
    const destination = document.querySelector<HTMLAnchorElement>('[role="dialog"] a[href="/analytics/academic"]');
    expect(destination).not.toBeNull();
    if (!destination) throw new Error('Expected the Academic Analytics command.');
    await act(async () => destination.click());

    expect(container.querySelector('h1')?.textContent).toBe('Academic Analytics');
    expect(document.title).toBe('Academic Analytics | OperatorOS');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('does not open navigation search while session verification is active', async () => {
    await render({ ...admin, sessionVerification: 'checking' });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-testid="session-verification-overlay"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('supports Meta+K and leaves the shortcut unhandled inside an editable search field', async () => {
    await render();
    const shortcut = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });
    await act(async () => { window.dispatchEvent(shortcut); });
    expect(shortcut.defaultPrevented).toBe(true);
    const search = document.querySelector<HTMLInputElement>('#navigation-search-input');
    expect(search).not.toBeNull();
    if (!search) throw new Error('Expected the command search input.');

    const editableShortcut = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { search.dispatchEvent(editableShortcut); });
    expect(editableShortcut.defaultPrevented).toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
