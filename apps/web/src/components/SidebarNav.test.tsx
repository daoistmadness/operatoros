import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../api/auth';
import { ApiError } from '../lib/api/errors';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';
import SidebarNav, {
  NAV_GROUPS,
  navigationItemIsActive,
  visibleNavigationGroups,
} from './SidebarNav';
import { authenticatedRoutes } from '../routes/routeDefinitions';

vi.mock('../lib/api/client', () => ({ getServerStatus: vi.fn().mockResolvedValue({ status: 'ok' }) }));

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
    collapsed = false,
    onToggleCollapsed = vi.fn(),
    logout = vi.fn<() => Promise<void>>(),
  }: {
    user?: AuthUser | null;
    path?: string;
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    logout?: () => Promise<void>;
  } = {}) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <AuthContext.Provider value={{ ...authFor(user), logout }}>
            <SidebarNav open collapsed={collapsed} onNavigate={vi.fn()} onToggleCollapsed={onToggleCollapsed} />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  it('shows the complete administrator inventory with one current destination', async () => {
    await renderSidebar({ path: '/students/42?month=7#attendance' });
    expect(container.querySelectorAll('nav a')).toHaveLength(NAV_GROUPS.reduce((count, group) => count + group.items.length, 0));
    expect(container.querySelector('a[href="/students"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('removes restricted links and empty groups for staff and anonymous states', () => {
    const staff = visibleNavigationGroups(users.staff, authFor(users.staff).can);
    const staffNames = staff.flatMap((group) => group.items.map((item) => item.name));
    expect(staffNames).toContain('Student Directory');
    expect(staffNames).not.toContain('Data Import & Export');
    expect(staffNames).not.toContain('Operations Audit');
    expect(staff.every((group) => group.items.length > 0)).toBe(true);
    expect(visibleNavigationGroups(null, () => false)).toEqual([]);
  });

  it('matches exact, nested, query-safe, and canonical redirect destinations without duplicates', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
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
    await renderSidebar({ collapsed: true, onToggleCollapsed });
    expect(container.querySelector('a[href="/analytics/attendance"]')?.textContent).toContain('Attendance');
    const expand = container.querySelector('button[aria-label="Expand sidebar"]');
    expect(expand).not.toBeNull();
    await act(async () => (expand as HTMLButtonElement).click());
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
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
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(authenticatedRoutes.find((route) => route.path === item.path)?.authorization).toBe(item.authorization);
    }
  });

  it('uses the reviewed six-group hierarchy and keeps configured links unique', () => {
    expect(NAV_GROUPS.map((group) => group.title)).toEqual([
      'Overview', 'Attendance', 'Academic & Students', 'Analytics & Reports', 'Data Management', 'Administration',
    ]);
    expect(NAV_GROUPS.map((group) => group.items.map((item) => item.name))).toEqual([
      ['Dashboard', 'Setup & Readiness'],
      ['Operator Work Queue', 'Class Attendance', 'Daily Attendance', 'Attendance Calendar', 'Monthly Recap Input', 'Monthly Reconciliation', 'Early Departures', 'Attendance Review', 'Attendance Corrections', 'Correction Review', 'Follow-Up Queue'],
      ['Student Directory', 'Student Enrollment', 'Academic Management', 'Teacher Assignments', 'Grade Ledger', 'Assessment Operations'],
      ['Management Analytics', 'Population Overview', 'Data Quality', 'Attendance', 'Academic Analytics', 'Student Insights', 'Reports & Reviews'],
      ['Data Import & Export'],
      ['Departure Policies', 'Grade Level Cutoff', 'HEB Overrides', 'Operations Audit', 'Employee Directory', 'Staff Monthly Activity', 'Settings'],
    ]);
    for (const group of NAV_GROUPS) expect(new Set(group.items.map((item) => item.icon)).size).toBe(group.items.length);
  });

  it('keeps every configured sidebar destination in the authenticated route table', () => {
    const routePaths = new Set(authenticatedRoutes.map((route) => route.path));
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) expect(routePaths.has(item.path)).toBe(true);
  });

  it('filters Attendance Review using the same capability as its route', () => {
    expect(visibleNavigationGroups(users.admin, authFor(users.admin).can).flatMap((group) => group.items).map((item) => item.name)).toContain('Attendance Review');
    expect(visibleNavigationGroups(users.staff, authFor(users.staff).can).flatMap((group) => group.items).map((item) => item.name)).not.toContain('Attendance Review');
  });
});
