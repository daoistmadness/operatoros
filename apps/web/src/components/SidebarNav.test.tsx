import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from '../test/TestRouter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../api/auth';
import { ApiError } from '../lib/api/errors';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';
import SidebarNav from './SidebarNav';
import {
  activeNavigationEntry,
  navigationGroups,
  visibleNavigationGroups,
} from '../lib/navigation/registry';
import { routeAuthorizations } from '../lib/router/access';

vi.mock('../hooks/useServerStatusQuery', () => ({
  useServerStatusQuery: () => ({ isLoading: false, isError: false }),
}));

const users: Record<'admin' | 'staff', AuthUser> = {
  admin: {
    id: 1,
    username: 'admin',
    role: 'admin',
    capabilities: [
      'view_student',
      'view_student_audit',
      'view_staff',
      'view_staff_analytics',
      'manage_staff',
      'import_staff',
      'export_staff',
      'manage_enrollment',
      'enter_assigned_class_attendance',
      'view_attendance_followups',
      'view_early_departure',
      'view_attendance',
      'view_attendance_corrections',
      'view_inventory',
    ],
  },
  staff: {
    id: 2,
    username: 'staff',
    role: 'staff',
    capabilities: ['view_student', 'view_attendance_followups', 'view_attendance', 'view_inventory'],
  },
};

function authFor(user: AuthUser | null): AuthContextValue {
  return {
    user,
    loading: false,
    authenticated: Boolean(user),
    can: (capability) => Boolean(user?.capabilities?.includes(capability)),
    login: vi.fn<() => Promise<AuthUser>>(),
    logout: vi.fn<() => Promise<void>>(),
  };
}

describe('role-aware sidebar navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderSidebar({
    user = users.admin,
    path = '/',
    open = true,
    collapsed = false,
    isSingleUserMode = false,
    onClose = vi.fn(),
    onToggleCollapsed = vi.fn(),
    logout = vi.fn<() => Promise<void>>(),
  }: {
    user?: AuthUser | null;
    path?: string;
    open?: boolean;
    collapsed?: boolean;
    isSingleUserMode?: boolean;
    onClose?: () => void;
    onToggleCollapsed?: () => void;
    logout?: () => Promise<void>;
  } = {}) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <AuthContext.Provider value={{ ...authFor(user), logout }}>
            <SidebarNav
              groups={visibleNavigationGroups({ auth: authFor(user), isSingleUserMode })}
              open={open}
              collapsed={collapsed}
              onClose={onClose}
              onNavigate={vi.fn()}
              onOpenCommandSearch={vi.fn()}
              onToggleCollapsed={onToggleCollapsed}
            />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  it('renders the nine primary domains for administrators with one active domain on nested detail routes', async () => {
    await renderSidebar({ path: '/students/42?month=7#attendance' });
    const links = Array.from(container.querySelectorAll('nav a'));
    expect(links.map((link) => link.textContent)).toEqual([
      'Home',
      'Work Queue',
      'Attendance',
      'Students',
      'Academics',
      'Staff',
      'Inventory',
      'Insights & Reports',
      'Settings',
    ]);
    expect(container.querySelector('a[href="/students"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('omits empty domains for staff and places Grade Level Cutoff under Settings', async () => {
    await renderSidebar({ user: users.staff, path: '/config/jenjang' });
    const links = Array.from(container.querySelectorAll('nav a'));
    const labels = links.map((link) => link.textContent);
    expect(labels).toEqual([
      'Home',
      'Work Queue',
      'Attendance',
      'Students',
      'Inventory',
      'Insights & Reports',
      'Settings',
    ]);
    expect(container.querySelector('a[href="/settings"]')?.getAttribute('aria-current')).toBe('page');
    expect(visibleNavigationGroups({ auth: authFor(null), isSingleUserMode: false })).toEqual([]);
  });

  it('hides teacher assignments in single-user mode without changing its route policy', () => {
    const adminAuth = authFor(users.admin);
    const multiUserNames = visibleNavigationGroups({ auth: adminAuth, isSingleUserMode: false }).flatMap((group) => group.items.map((item) => item.name));
    const singleUserNames = visibleNavigationGroups({ auth: adminAuth, isSingleUserMode: true }).flatMap((group) => group.items.map((item) => item.name));
    expect(multiUserNames).toContain('Teacher Assignments');
    expect(singleUserNames).not.toContain('Teacher Assignments');
    expect(routeAuthorizations['/teacher-class-assignments']).toEqual({ type: 'role', role: 'admin' });
  });

  it('matches exact, nested, detail, and compatibility routes to a single domain without duplicates', () => {
    const activeDomain = (path: string) => activeNavigationEntry(navigationGroups, path)?.group.title;
    expect(activeDomain('/')).toBe('Home');
    expect(activeDomain('/attendance/followups')).toBe('Work Queue');
    expect(activeDomain('/config/jenjang')).toBe('Settings');
    expect(activeDomain('/attendance/departure-policies')).toBe('Settings');
    expect(activeDomain('/students/42')).toBe('Students');
    expect(activeDomain('/students/operations')).toBe('Students');
    expect(activeDomain('/reports/monthly')).toBe('Insights & Reports');
    expect(activeDomain('/reports/management/monthly')).toBe('Insights & Reports');
    expect(activeDomain('/analytics/management-review/student-profile')).toBe('Insights & Reports');
    expect(activeDomain('/analytics/trends')).toBe('Insights & Reports');
    expect(activeDomain('/analytics/indicators')).toBe('Insights & Reports');
    expect(activeDomain('/analytics/attendance')).toBe('Insights & Reports');
    expect(activeDomain('/enrollment')).toBe('Students');
    expect(activeDomain('/staff/42')).toBe('Staff');
    expect(activeDomain('/inventory')).toBe('Inventory');
  });

  it.each([
    ['a network failure', new ApiError('The server could not be reached.', { kind: 'network' }), true],
    ['a rejected request', new ApiError('The server could not complete the request.', { status: 500 }), false],
  ])('reports an unconfirmed logout after %s without hiding the authenticated shell', async (_label, failure, expectsConnectionGuidance) => {
    const logout = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
    await renderSidebar({ logout });

    const button = container.querySelector('button[aria-label="Logout"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(logout).toHaveBeenCalledOnce();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Sign out could not be confirmed');
    expect(alert?.textContent).toContain('session may still be active');
    if (expectsConnectionGuidance) expect(alert?.textContent).toContain('Check the connection');
    else expect(alert?.textContent).not.toContain('Check the connection');
    expect(container.textContent).toContain('admin');
    expect(container.querySelector('button[aria-label="Logout"]')).not.toBeNull();
  });

  it('keeps collapsed links named and exposes a usable expand control', async () => {
    const onToggleCollapsed = vi.fn();
    await renderSidebar({ collapsed: true, onToggleCollapsed, open: false });
    expect(container.querySelector('a[href="/analytics"]')?.textContent).toContain('Insights & Reports');
    const expand = container.querySelector('button[aria-label="Expand sidebar"]');
    expect(expand).not.toBeNull();
    await act(async () => (expand as HTMLButtonElement).click());
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('opens the mobile drawer at full width when the desktop preference is collapsed', async () => {
    await renderSidebar({ collapsed: true, open: true });

    const sidebar = container.querySelector('aside');
    expect(sidebar?.className).toContain('w-64');
    expect(container.querySelector('a[href="/analytics"]')?.textContent).toContain('Insights & Reports');
  });

  it('provides a close control inside the open navigation dialog', async () => {
    const onClose = vi.fn();
    await renderSidebar({ open: true, onClose });

    const closeButton = container.querySelector<HTMLButtonElement>('aside[role="dialog"] button[aria-label="Close navigation"]');
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('supports arrow-key navigation across primary domain links', async () => {
    await renderSidebar({ path: '/' });
    const homeLink = container.querySelector<HTMLAnchorElement>('a[href="/"]');
    const queueLink = container.querySelector<HTMLAnchorElement>('a[href="/operator/work-queue"]');
    const settingsLink = container.querySelector<HTMLAnchorElement>('a[href="/settings"]');
    expect(homeLink).not.toBeNull();
    expect(queueLink).not.toBeNull();
    expect(settingsLink).not.toBeNull();

    homeLink?.focus();
    await act(async () => {
      homeLink?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(queueLink);

    await act(async () => {
      queueLink?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(settingsLink);
  });

  it('keeps every configured sidebar and sub-domain destination in the authenticated route table', () => {
    const routePaths = new Set(Object.keys(routeAuthorizations));
    for (const item of navigationGroups.flatMap((group) => group.items)) expect(routePaths.has(item.path)).toBe(true);
  });
});
