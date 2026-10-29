import { describe, expect, it } from 'vitest';
import type { AuthContextValue } from '../../context/AuthContext';
import { routeAuthorizations, routePolicyPathForLocation } from '../router/access';
import {
  activeNavigationEntry,
  canSelectNavigationItem,
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
  it('keeps the current sidebar hierarchy and explicit route-policy coverage', () => {
    expect(navigationGroups.map((group) => group.title)).toEqual([
      'Overview', 'Attendance', 'Academic & Students', 'Analytics & Reports', 'Data Management', 'Administration',
    ]);
    for (const item of navigationGroups.flatMap((group) => group.items)) {
      expect(routeAuthorizations[item.path]).toBeDefined();
    }
  });

  it('uses route authorization for display and checks deployment restrictions at selection time', () => {
    const admin = authFor('admin', ['view_student', 'view_attendance_followups']);
    const context = { auth: admin, isSingleUserMode: false };
    const teacherAssignments = navigationGroups.flatMap((group) => group.items).find((item) => item.path === '/teacher-class-assignments');
    const staffVisibleGroups = visibleNavigationGroups({ auth: authFor('staff', ['view_student']), isSingleUserMode: false });
    const staffPaths = staffVisibleGroups.flatMap((group) => group.items.map((item) => item.path));

    expect(teacherAssignments).toBeDefined();
    if (!teacherAssignments) throw new Error('Expected teacher assignment navigation metadata.');
    expect(canSelectNavigationItem(teacherAssignments, context)).toBe(true);
    expect(canSelectNavigationItem(teacherAssignments, { ...context, isSingleUserMode: true })).toBe(false);
    expect(routeAuthorizations['/teacher-class-assignments']).toEqual({ type: 'role', role: 'admin' });
    expect(staffPaths).toContain('/students');
    expect(staffPaths).not.toContain('/upload');
    expect(staffPaths).not.toContain('/students/operations');
  });

  it('searches static labels, paths, group names, and aliases without exposing hidden routes', () => {
    const groups = visibleNavigationGroups({
      auth: authFor('staff', ['view_student']),
      isSingleUserMode: false,
    });

    expect(searchNavigationGroups(groups, 'roster').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/students']);
    expect(searchNavigationGroups(groups, 'academic students').flatMap((group) => group.items.map((item) => item.path))).toContain('/students');
    expect(searchNavigationGroups(groups, 'private student record')).toEqual([]);
    expect(searchNavigationGroups(groups, 'upload').flatMap((group) => group.items)).toEqual([]);

    const studentGroups = visibleNavigationGroups({
      auth: authFor('staff', ['view_student']),
      isSingleUserMode: false,
    });
    expect(searchNavigationGroups(studentGroups, '/analytics/trends').flatMap((group) => group.items.map((item) => item.path))).toEqual(['/analytics/student-insights']);
  });

  it('preserves current active-route matching for nested pages and compatibility aliases', () => {
    const entries = navigationGroups.flatMap((group) => group.items);
    const studentDirectory = entries.find((item) => item.path === '/students');
    const entryFor = (pathname: string) => activeNavigationEntry(navigationGroups, pathname);

    expect(entryFor('/students/42')?.item.name).toBe('Student Directory');
    expect(entryFor('/students/operations')?.item.name).toBe('Operations Audit');
    expect(entryFor('/analytics/trends')?.item.name).toBe('Student Insights');
    expect(entryFor('/reports/management/monthly')?.item.name).toBe('Reports & Reviews');
    expect(entryFor('/staff/42')).toBeNull();
    expect(studentDirectory).toBeDefined();
    if (!studentDirectory) throw new Error('Expected student directory metadata.');
    expect(navigationItemIsActive(studentDirectory, '/students/operations')).toBe(false);
  });

  it('reuses route-policy matching for generic protected-detail breadcrumbs and titles', () => {
    const context = {
      auth: authFor('admin', ['view_student', 'view_staff', 'manage_staff']),
      isSingleUserMode: false,
    };
    const groups = visibleNavigationGroups(context);

    expect(routePolicyPathForLocation('/students/42')).toBe('/students/:id');
    expect(routePolicyPathForLocation('/staff/42/edit/')).toBe('/staff/:id/edit');
    expect(routePolicyPathForLocation('/unclassified')).toBeUndefined();
    expect(navigationPresentationForPath(groups, '/students/42')).toEqual({
      title: 'Student profile',
      breadcrumbs: [
        { label: 'Dashboard', href: '/' },
        { label: 'Student Directory', href: '/students' },
        { label: 'Student profile' },
      ],
    });
    expect(navigationPresentationForPath(groups, '/staff/42/edit')?.title).toBe('Edit staff profile');
    expect(navigationPresentationForPath(groups, '/classes/42')?.title).toBe('Class overview');
    expect(navigationPresentationForPath(groups, '/upload-history')).toBeNull();
  });
});
