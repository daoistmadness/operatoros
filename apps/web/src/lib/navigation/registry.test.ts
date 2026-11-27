import { describe, expect, it } from 'vitest';
import type { AuthContextValue } from '../../context/AuthContext';
import { routeAuthorizations, routePolicyPathForLocation } from '../router/access';
import {
  activeNavigationEntry,
  canSelectNavigationItem,
  domainPrimaryPath,
  navigationGroups,
  navigationItemIsActive,
  navigationPresentationForPath,
  searchNavigationGroups,
  visibleNavigationGroups,
} from './registry';

function authFor(role: 'admin' | 'staff', capabilities: string[] = []): AuthContextValue {
  const user = { id: role === 'admin' ? 1 : 2, username: role, role, capabilities };
  return {
    user,
    loading: false,
    authenticated: true,
    can: (capability) => capabilities.includes(capability),
    login: async () => user,
    logout: async () => undefined,
  };
}

describe('navigation registry', () => {
  it('organizes the primary navigation into nine domains with complete route-policy coverage', () => {
    expect(navigationGroups.map((group) => group.title)).toEqual([
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
    for (const item of navigationGroups.flatMap((group) => group.items)) {
      expect(routeAuthorizations[item.path]).toBeDefined();
    }
  });

  it('uses route authorization for visibility and checks deployment restrictions', () => {
    const admin = authFor('admin', [
      'view_student',
      'view_student_audit',
      'view_staff',
      'view_staff_analytics',
      'manage_staff',
      'import_staff',
      'view_inventory',
      'view_attendance_followups',
    ]);
    const context = { auth: admin, isSingleUserMode: false };
    const teacherAssignments = navigationGroups
      .flatMap((group) => group.items)
      .find((item) => item.path === '/teacher-class-assignments');

    expect(teacherAssignments).toBeDefined();
    if (!teacherAssignments) throw new Error('Expected teacher assignment navigation metadata.');
    expect(canSelectNavigationItem(teacherAssignments, context)).toBe(true);
    expect(canSelectNavigationItem(teacherAssignments, { ...context, isSingleUserMode: true })).toBe(false);
    expect(routeAuthorizations['/teacher-class-assignments']).toEqual({ type: 'role', role: 'admin' });

    const staffVisibleGroups = visibleNavigationGroups({
      auth: authFor('staff', ['view_student', 'view_attendance', 'view_attendance_followups', 'view_inventory']),
      isSingleUserMode: false,
    });
    const staffDomainTitles = staffVisibleGroups.map((group) => group.title);
    const staffPaths = staffVisibleGroups.flatMap((group) => group.items.map((item) => item.path));
    const staffSettings = staffVisibleGroups.find((group) => group.id === 'settings');

    expect(staffDomainTitles).not.toContain('Staff');
    expect(staffDomainTitles).not.toContain('Academics');
    expect(staffPaths).toContain('/students');
    expect(staffPaths).toContain('/inventory');
    expect(staffPaths).toContain('/config/jenjang');
    expect(staffPaths).toContain('/attendance/followups');
    expect(staffPaths).not.toContain('/upload');
    expect(staffPaths).not.toContain('/students/operations');
    expect(staffPaths).not.toContain('/reports/upp');
    expect(staffSettings ? domainPrimaryPath(staffSettings) : undefined).toBe('/settings');
    expect(staffSettings?.items.map((item) => item.path)).toEqual(['/settings', '/setup', '/config/jenjang']);
  });

  it('searches English and Indonesian aliases without exposing unauthorized routes', () => {
    const groups = visibleNavigationGroups({
      auth: authFor('staff', ['view_student', 'view_inventory']),
      isSingleUserMode: false,
    });

    expect(searchNavigationGroups(groups, 'roster').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/students']);
    expect(searchNavigationGroups(groups, 'direktori siswa').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/students']);
    expect(searchNavigationGroups(groups, 'inventaris').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/inventory']);
    expect(searchNavigationGroups(groups, 'jenjang').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/config/jenjang']);
    expect(searchNavigationGroups(groups, 'pegawai')).toEqual([]);
    expect(searchNavigationGroups(groups, 'private student record')).toEqual([]);
    expect(searchNavigationGroups(groups, 'upload').flatMap((group) => group.items)).toEqual([]);
    expect(searchNavigationGroups(groups, '/analytics/trends').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/analytics/student-insights']);
  });

  it('preserves active-route matching for nested, detail, and compatibility routes without duplicates', () => {
    const entries = navigationGroups.flatMap((group) => group.items);
    const studentDirectory = entries.find((item) => item.path === '/students');
    const entryFor = (pathname: string) => activeNavigationEntry(navigationGroups, pathname);

    expect(entryFor('/')?.group.id).toBe('home');
    expect(entryFor('/attendance/followups')?.group.id).toBe('work-queue');
    expect(entryFor('/config/jenjang')?.group.id).toBe('settings');
    expect(entryFor('/attendance/departure-policies')?.group.id).toBe('settings');
    expect(entryFor('/students/42')?.item.name).toBe('Student Directory');
    expect(entryFor('/students/operations')?.item.name).toBe('Operations Audit');
    expect(entryFor('/analytics/trends')?.item.name).toBe('Student Insights');
    expect(entryFor('/reports/management/monthly')?.item.name).toBe('Reports & Reviews');
    expect(entryFor('/staff/42')?.group.id).toBe('staff');
    expect(entryFor('/staff/42/edit')?.group.id).toBe('staff');
    expect(entryFor('/staff/analytics')?.item.name).toBe('Staff Analytics');
    expect(entryFor('/classes/12')?.group.id).toBe('students');
    expect(entryFor('/upload-center')?.group.id).toBe('settings');
    expect(entryFor('/settings/backups')?.item.name).toBe('Backup Management');

    expect(studentDirectory).toBeDefined();
    if (!studentDirectory) throw new Error('Expected student directory metadata.');
    expect(navigationItemIsActive(studentDirectory, '/students/operations')).toBe(false);
  });

  it('builds consistent domain-aware breadcrumbs and titles for pages and detail routes', () => {
    const context = {
      auth: authFor('admin', ['view_student', 'view_staff', 'manage_staff', 'view_attendance']),
      isSingleUserMode: false,
    };
    const groups = visibleNavigationGroups(context);

    expect(routePolicyPathForLocation('/students/42')).toBe('/students/:id');
    expect(routePolicyPathForLocation('/staff/42/edit/')).toBe('/staff/:id/edit');
    expect(routePolicyPathForLocation('/unclassified')).toBeUndefined();

    expect(navigationPresentationForPath(groups, '/')).toEqual({
      title: 'Home',
      domainTitle: 'Home',
      breadcrumbs: [{ label: 'Home' }],
    });

    expect(navigationPresentationForPath(groups, '/students/42')).toEqual({
      title: 'Student profile',
      domainTitle: 'Students',
      breadcrumbs: [
        { label: 'Home', href: '/' },
        { label: 'Students', href: '/students' },
        { label: 'Student profile' },
      ],
    });

    expect(navigationPresentationForPath(groups, '/staff/42/edit')).toEqual({
      title: 'Edit staff profile',
      domainTitle: 'Staff',
      breadcrumbs: [
        { label: 'Home', href: '/' },
        { label: 'Staff', href: '/staff' },
        { label: 'Staff profile', href: '/staff/42' },
        { label: 'Edit staff profile' },
      ],
    });

    expect(navigationPresentationForPath(groups, '/attendance/calendar')).toEqual({
      title: 'Attendance Calendar',
      domainTitle: 'Attendance',
      breadcrumbs: [
        { label: 'Home', href: '/' },
        { label: 'Attendance', href: '/attendance/daily' },
        { label: 'Attendance Calendar' },
      ],
    });

    expect(navigationPresentationForPath(groups, '/attendance/daily')).toEqual({
      title: 'Daily Attendance',
      domainTitle: 'Attendance',
      breadcrumbs: [
        { label: 'Home', href: '/' },
        { label: 'Attendance' },
        { label: 'Daily Operations' },
        { label: 'Daily Attendance' },
      ],
    });

    expect(navigationPresentationForPath(groups, '/classes/42')?.title).toBe('Class overview');
    expect(navigationPresentationForPath(groups, '/upload-history')?.title).toBe('Data Import & Export');
  });
});
