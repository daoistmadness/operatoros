import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '../context/AuthContext';
import SidebarNav, {
  NAV_GROUPS,
  navigationItemIsActive,
  visibleNavigationGroups,
} from './SidebarNav';

vi.mock('../lib/api/client', () => ({ getServerStatus: vi.fn().mockResolvedValue({ status: 'ok' }) }));

const users = {
  admin: { id: 1, username: 'admin', role: 'admin', capabilities: ['view_student', 'view_student_audit', 'manage_enrollment'] },
  staff: { id: 2, username: 'staff', role: 'staff', capabilities: ['view_student'] },
};

function authFor(user) {
  return {
    user,
    loading: false,
    authenticated: Boolean(user),
    can: (capability) => Boolean(user?.capabilities?.includes(capability)),
    login: vi.fn(),
    logout: vi.fn(),
  };
}

describe('role-aware sidebar navigation', () => {
  let container;
  let root;

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

  async function renderSidebar({ user = users.admin, path = '/', collapsed = false, onToggleCollapsed = vi.fn() } = {}) {
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

  it('shows the complete admin inventory with one current destination', async () => {
    await renderSidebar({ path: '/students/42?month=7#attendance' });
    expect(container.querySelectorAll('nav a')).toHaveLength(19);
    expect(container.querySelector('a[href="/students"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('removes restricted links and empty groups for staff and anonymous states', () => {
    const staff = visibleNavigationGroups(users.staff, authFor(users.staff).can);
    const staffNames = staff.flatMap((group) => group.items.map((item) => item.name));
    expect(staffNames).toContain('Students');
    expect(staffNames).not.toContain('Data Import Center');
    expect(staffNames).not.toContain('Operations Audit');
    expect(staff.every((group) => group.items.length > 0)).toBe(true);
    expect(visibleNavigationGroups(null, () => false)).toEqual([]);
  });

  it('matches exact, nested, query-safe, and canonical redirect destinations without duplicates', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    const activeNames = (path) => items.filter((item) => navigationItemIsActive(item, path)).map((item) => item.name);
    expect(activeNames('/')).toEqual(['Dashboard']);
    expect(activeNames('/students/42')).toEqual(['Students']);
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
    await act(async () => expand.click());
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('operates disclosure groups by keyboard-compatible native buttons and preserves the active group', async () => {
    await renderSidebar({ path: '/analytics' });
    const workflowButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Daily Workflows'));
    const analyticsButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Analytics & Reports'));
    await act(async () => workflowButton.click());
    expect(workflowButton.getAttribute('aria-expanded')).toBe('false');
    expect(analyticsButton.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('a[href="/analytics"]')?.getAttribute('aria-current')).toBe('page');
  });
});
