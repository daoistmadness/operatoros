import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from '../test/TestRouter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../api/auth';
import { ApiError } from '../lib/api/errors';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';
import SidebarNav from './SidebarNav';
import {
  navigationGroups,
  navigationItemIsActive,
  visibleNavigationGroups,
} from '../lib/navigation/registry';
import { routeAuthorizations } from '../lib/router/access';

vi.mock('../hooks/useServerStatusQuery', () => ({
  useServerStatusQuery: () => ({ isLoading: false, isError: false }),
}));

const users: Record<'admin' | 'staff', AuthUser> = {
  admin: { id: 1, username: 'admin', role: 'admin', capabilities: ['view_student', 'view_student_audit', 'view_staff', 'view_staff_analytics', 'manage_staff', 'export_staff', 'manage_enrollment', 'enter_assigned_class_attendance', 'view_attendance_followups', 'view_early_departure', 'view_attendance', 'view_attendance_corrections'] },
  staff: { id: 2, username: 'staff', role: 'staff', capabilities: ['view_student'] },
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
    onToggleCollapsed = vi.fn(),
    logout = vi.fn<() => Promise<void>>(),
  }: {
    user?: AuthUser | null;
    path?: string;
    open?: boolean;
    collapsed?: boolean;
    isSingleUserMode?: boolean;
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

  it('shows the complete administrator inventory with one current destination', async () => {
    await renderSidebar({ path: '/students/42?month=7#attendance' });
    expect(container.querySelectorAll('nav a')).toHaveLength(navigationGroups.reduce((count, group) => count + group.items.length, 0));
    expect(container.querySelector('a[href="/students"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('removes restricted links and empty groups for staff and anonymous states', () => {
    const staff = visibleNavigationGroups({ auth: authFor(users.staff), isSingleUserMode: false });
    const staffNames = staff.flatMap((group) => group.items.map((item) => item.name));
    expect(staffNames).toContain('Student Directory');
    expect(staffNames).not.toContain('Data Import & Export');
    expect(staffNames).not.toContain('Operations Audit');
    expect(staff.every((group) => group.items.length > 0)).toBe(true);
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

  it('matches exact, nested, query-safe, and canonical redirect destinations without duplicates', () => {
    const items = navigationGroups.flatMap((group) => group.items);
    const activeNames = (path: string) => items.filter((item) => navigationItemIsActive(item, path)).map((item) => item.name);
    expect(activeNames('/')).toEqual(['Dashboard']);
    expect(activeNames('/students/42')).toEqual(['Student Directory']);
    expect(activeNames('/students/operations')).toEqual(['Operations Audit']);
    expect(activeNames('/reports/monthly')).toEqual(['Reports & Reviews']);
    expect(activeNames('/reports/management/monthly')).toEqual(['Reports & Reviews']);
    expect(activeNames('/analytics/management-review/student-profile')).toEqual(['Reports & Reviews']);
    expect(activeNames('/analytics/trends')).toEqual(['Student Insights']);
    expect(activeNames('/analytics/indicators')).toEqual(['Student Insights']);
    expect(activeNames('/analytics/attendance')).toEqual(['Attendance']);
    expect(activeNames('/enrollment')).toEqual(['Student Enrollment']);
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
    expect(container.querySelector('a[href="/analytics/attendance"]')?.textContent).toContain('Attendance');
    const expand = container.querySelector('button[aria-label="Expand sidebar"]');
    expect(expand).not.toBeNull();
    await act(async () => (expand as HTMLButtonElement).click());
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('opens the mobile drawer at full width when the desktop preference is collapsed', async () => {
    await renderSidebar({ collapsed: true, open: true });

    const sidebar = container.querySelector('aside');
    expect(sidebar?.className).toContain('w-64');
    const analyticsGroup = Array.from(sidebar?.querySelectorAll('nav button') ?? []).find((button) => button.textContent?.includes('Analytics & Reports'));
    expect(analyticsGroup?.hasAttribute('disabled')).toBe(false);
    expect(container.querySelector('a[href="/analytics/attendance"]')?.textContent).toContain('Attendance');
  });

  it('operates disclosure groups by keyboard-compatible native buttons and preserves the active group', async () => {
    await renderSidebar({ path: '/analytics' });
    const workflowButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Attendance'));
    const analyticsButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Analytics & Reports'));
    expect(workflowButton).toBeDefined();
    expect(analyticsButton).toBeDefined();
    if (!workflowButton || !analyticsButton) throw new Error('Expected navigation disclosure buttons.');
    await act(async () => workflowButton.click());
    expect(workflowButton.getAttribute('aria-expanded')).toBe('false');
    expect(analyticsButton.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('a[href="/analytics"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps navigation authorization identical to the canonical route contract', () => {
    for (const item of navigationGroups.flatMap((group) => group.items)) expect(routeAuthorizations[item.path]).toBeDefined();
  });

  it('uses the reviewed six-group hierarchy and keeps configured links unique', () => {
    expect(navigationGroups.map((group) => group.title)).toEqual([
      'Overview', 'Attendance', 'Academic & Students', 'Analytics & Reports', 'Data Management', 'Administration',
    ]);
    expect(navigationGroups.map((group) => group.items.map((item) => item.name))).toEqual([
      ['Dashboard', 'Setup & Readiness'],
      ['Operator Work Queue', 'Class Attendance', 'Daily Attendance', 'Attendance Calendar', 'Monthly Recap Input', 'Monthly Reconciliation', 'Early Departures', 'Attendance Review', 'Attendance Corrections', 'Correction Review', 'Follow-Up Queue'],
      ['Student Directory', 'Student Enrollment', 'Academic Management', 'Teacher Assignments', 'Grade Ledger', 'Assessment Operations'],
      ['Management Analytics', 'Population Overview', 'Data Quality', 'Attendance', 'Academic Analytics', 'Student Insights', 'Reports & Reviews'],
      ['Data Import & Export'],
      ['Departure Policies', 'Grade Level Cutoff', 'HEB Overrides', 'Operations Audit', 'Employee Directory', 'Staff Monthly Activity', 'Monthly UPP Reports', 'Settings'],
    ]);
    for (const group of navigationGroups) expect(new Set(group.items.map((item) => item.icon)).size).toBe(group.items.length);
  });

  it('keeps every configured sidebar destination in the authenticated route table', () => {
    const routePaths = new Set(Object.keys(routeAuthorizations));
    for (const item of navigationGroups.flatMap((group) => group.items)) expect(routePaths.has(item.path)).toBe(true);
  });

  it('filters Attendance Review using the same capability as its route', () => {
    expect(visibleNavigationGroups({ auth: authFor(users.admin), isSingleUserMode: false }).flatMap((group) => group.items).map((item) => item.name)).toContain('Attendance Review');
    expect(visibleNavigationGroups({ auth: authFor(users.staff), isSingleUserMode: false }).flatMap((group) => group.items).map((item) => item.name)).not.toContain('Attendance Review');
  });
});
