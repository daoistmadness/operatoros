import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../api/auth';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';
import SidebarNav, {
  NAV_GROUPS,
  navigationItemIsActive,
  visibleNavigationGroups,
} from './SidebarNav';
import { authenticatedRoutes } from '../routes/routeDefinitions';

vi.mock('../lib/api/client', () => ({ getServerStatus: vi.fn().mockResolvedValue({ status: 'ok' }) }));

const users: Record<'admin' | 'staff', AuthUser> = {
  admin: { id: 1, username: 'admin', role: 'admin', capabilities: ['view_student', 'view_student_audit', 'view_staff', 'manage_enrollment', 'enter_assigned_class_attendance', 'view_attendance_followups', 'view_early_departure', 'view_attendance', 'view_attendance_corrections'] },
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
  }: {
    user?: AuthUser | null;
    path?: string;
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
  } = {}) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <AuthContext.Provider value={authFor(user)}>
            <SidebarNav open collapsed={collapsed} onNavigate={vi.fn()} onToggleCollapsed={onToggleCollapsed} />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  it('shows the complete administrator inventory with one current destination', async () => {
    await renderSidebar({ path: '/students/42?month=7#attendance' });
    expect(container.querySelectorAll('nav a')).toHaveLength(32);
    expect(container.querySelector('a[href="/students"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('removes restricted links and empty groups for staff and anonymous states', () => {
    const staff = visibleNavigationGroups(users.staff, authFor(users.staff).can);
    const staffNames = staff.flatMap((group) => group.items.map((item) => item.name));
    expect(staffNames).toContain('Student Directory');
    expect(staffNames).not.toContain('Data Import Center');
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
    expect(activeNames('/reports/monthly')).toEqual(['Executive Reports']);
    expect(activeNames('/enrollment')).toEqual(['Student Enrollment']);
  });

  it('keeps collapsed links named and exposes a usable expand control', async () => {
    const onToggleCollapsed = vi.fn();
    await renderSidebar({ collapsed: true, onToggleCollapsed });
    expect(container.querySelector('a[href="/reports/tardiness"]')?.textContent).toContain('Tardiness Report');
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
      ['Dashboard'],
      ['Operator Work Queue', 'Class Attendance', 'Early Departures', 'Attendance Review', 'Attendance Corrections', 'Follow-Up Queue'],
      ['Student Directory', 'Student Enrollment', 'Academic Management', 'Teacher Assignments', 'Grade Ledger'],
      ['Management Analytics', 'Data Recapitulation', 'Data Quality', 'Attendance Analytics', 'Academic Analytics', 'Executive Reports', 'Monthly Management', 'Attendance Report', 'Attendance Recap', 'Tardiness Report'],
      ['Data Import Center', 'Data Import & Export', 'Import History'],
      ['Departure Policies', 'Grade Level Cutoff', 'HEB Overrides', 'Absence Reasons', 'Operations Audit', 'Employee Directory', 'Settings'],
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
