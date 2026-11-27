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
  user: {
    id: 1,
    username: 'admin',
    role: 'admin',
    capabilities: [
      'view_student',
      'view_student_audit',
      'manage_enrollment',
      'view_attendance',
      'enter_assigned_class_attendance',
      'view_early_departure',
      'view_attendance_corrections',
    ],
  },
  loading: false,
  authenticated: true,
  can: (capability) => [
    'view_student',
    'view_student_audit',
    'manage_enrollment',
    'view_attendance',
    'enter_assigned_class_attendance',
    'view_early_departure',
    'view_attendance_corrections',
  ].includes(capability),
  login: async () => ({ id: 1, username: 'admin', role: 'admin', capabilities: ['view_student'] }),
  logout: async () => undefined,
};

const staff: AuthContextValue = {
  user: { id: 2, username: 'staff', role: 'staff', capabilities: ['view_student', 'view_attendance'] },
  loading: false,
  authenticated: true,
  can: (capability) => ['view_student', 'view_attendance'].includes(capability),
  login: async () => ({ id: 2, username: 'staff', role: 'staff', capabilities: ['view_student', 'view_attendance'] }),
  logout: async () => undefined,
};

function navigationRouter(auth: AuthContextValue, initialEntry = '/analytics') {
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
  const students = createRoute({
    getParentRoute: () => shell,
    path: 'students',
    component: () => <h1>Student Directory</h1>,
  });
  const dailyAttendance = createRoute({
    getParentRoute: () => shell,
    path: 'attendance/daily',
    component: () => <h1>Daily Attendance</h1>,
  });
  const attendanceCalendar = createRoute({
    getParentRoute: () => shell,
    path: 'attendance/calendar',
    component: () => <h1>Attendance Calendar</h1>,
  });
  const routeTree = root.addChildren([shell.addChildren([analytics, academic, students, dailyAttendance, attendanceCalendar])]);
  const context = { auth, setupLoading: false, setupRequired: false };
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
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

  async function render(auth = admin, initialEntry = '/analytics') {
    if (root) {
      await act(async () => root.unmount());
      container.remove();
    }
    const router = navigationRouter(auth, initialEntry);
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

  it('shares domain registry labels across breadcrumbs, contextual sub-nav, and document title, and navigates from Ctrl+K', async () => {
    await render();
    expect(document.title).toBe('Management Analytics | OperatorOS');
    expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain('Home');
    expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain('Insights & Reports');
    expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain('Management Analytics');

    const domainNav = container.querySelector('nav[aria-label="Insights & Reports navigation"]');
    expect(domainNav).not.toBeNull();
    expect(domainNav?.querySelector('a[href="/analytics"]')?.getAttribute('aria-current')).toBe('page');
    expect(domainNav?.querySelector('a[href="/reports/upp"]')).not.toBeNull();

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

  it('renders compact workflow groups for Attendance and hides unauthorized groups', async () => {
    await render(admin, '/attendance/daily');
    const attendanceNav = container.querySelector('nav[aria-label="Attendance navigation"]');
    expect(attendanceNav).not.toBeNull();
    const topGroupLinks = Array.from(attendanceNav?.querySelectorAll(':scope > ul:first-child a') ?? []);
    expect(topGroupLinks.map((link) => link.textContent)).toEqual([
      'Daily Operations',
      'Attendance Calendar',
      'Review & Corrections',
      'Monthly Processing',
    ]);
    const activeGroupPages = Array.from(attendanceNav?.querySelectorAll('ul[aria-label="Daily Operations pages"] a') ?? []);
    expect(activeGroupPages.map((link) => link.textContent)).toEqual([
      'Daily Attendance',
      'Class Attendance',
      'Early Departures',
    ]);
    expect(attendanceNav?.querySelector('a[href="/attendance/daily"]')?.getAttribute('aria-current')).toBe('page');
    expect(attendanceNav?.querySelector('a[href="/attendance/reconciliation"]')).toBeNull();

    await render(admin, '/attendance/calendar');
    const calendarNav = container.querySelector('nav[aria-label="Attendance navigation"]');
    expect(calendarNav?.querySelectorAll(':scope > ul')).toHaveLength(1);
    expect(calendarNav?.querySelector('a[href="/attendance/calendar"]')?.getAttribute('aria-current')).toBe('page');

    await render(staff, '/attendance/daily');
    const staffAttendanceNav = container.querySelector('nav[aria-label="Attendance navigation"]');
    expect(staffAttendanceNav?.textContent).not.toContain('Monthly Processing');
  });

  it('filters contextual sub-navigation by authorization and hides single-item domain bars', async () => {
    await render(staff, '/analytics');
    const insightsNav = container.querySelector('nav[aria-label="Insights & Reports navigation"]');
    expect(insightsNav).not.toBeNull();
    expect(insightsNav?.querySelector('a[href="/reports/upp"]')).toBeNull();

    await render(staff, '/students');
    expect(container.querySelector('nav[aria-label="Students navigation"]')).toBeNull();
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
