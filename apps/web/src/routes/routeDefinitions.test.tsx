import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { authenticatedRoutes } from './routeDefinitions';
import { RouteLoadingFallback } from './RouteLoadingFallback';

const expectedPaths = [
  '/',
  '/setup',
  '/operator/work-queue',
  '/upload',
  '/upload-center',
  '/data-portability',
  '/upload-history',
  '/mapping',
  '/analytics',
  '/analytics/management-review/student-profile',
  '/reports',
  '/reports/monthly',
  '/reports/annual',
  '/reports/management/monthly',
  '/reports/attendance',
  '/reports/tardiness',
  '/reports/rekap-absensi',
  '/analytics/recapitulation',
  '/analytics/data-quality',
  '/analytics/attendance',
  '/analytics/academic',
  '/analytics/student-insights',
  '/analytics/trends',
  '/analytics/indicators',
  '/attendance-review',
  '/attendance-corrections',
  '/attendance/override-review',
  '/attendance/followups',
  '/academic-management',
  '/teacher-class-assignments',
  '/attendance/class-entry',
  '/attendance/daily',
  '/attendance/calendar',
  '/attendance/monthly-recap',
  '/attendance/reconciliation',
  '/attendance/machine-import',
  '/classes/:id',
  '/attendance/departure-policies',
  '/attendance/class-departures',
  '/enrollment',
  '/grades',
  '/grades/operations',
  '/config/jenjang',
  '/config/heb',
  '/config/absence-reasons',
  '/settings',
  '/settings/backups',
  '/students',
  '/staff',
  '/staff/new',
  '/staff/import',
  '/staff/analytics',
  '/staff/:id/edit',
  '/staff/:id',
  '/students/operations',
  '/students/:id',
  '/attendance/students/:id',
  '*',
];

describe('route definitions', () => {
  it('preserves every authenticated route path', () => {
    expect(authenticatedRoutes.map(({ path }) => path)).toEqual(expectedPaths);
  });

  it('preserves legacy redirects', () => {
    expect(authenticatedRoutes.filter(({ redirectTo }) => redirectTo).map(({ path, redirectTo }) => ({ path, redirectTo }))).toEqual([
      { path: '/upload-center', redirectTo: '/upload?section=attendance' },
      { path: '/data-portability', redirectTo: '/upload?section=export' },
      { path: '/upload-history', redirectTo: '/upload?section=history' },
      { path: '/mapping', redirectTo: '/enrollment' },
      { path: '/reports/monthly', redirectTo: '/reports?view=monthly' },
      { path: '/reports/annual', redirectTo: '/reports?view=annual' },
      { path: '/reports/management/monthly', redirectTo: '/reports?view=monthly' },
      { path: '/reports/attendance', redirectTo: '/analytics/attendance?view=report' },
      { path: '/reports/tardiness', redirectTo: '/analytics/attendance?view=tardiness' },
      { path: '/reports/rekap-absensi', redirectTo: '/analytics/attendance?view=recap' },
      { path: '/attendance/machine-import', redirectTo: '/upload' },
      { path: '/config/absence-reasons', redirectTo: '/attendance/monthly-recap' },
    ]);
  });

  it('keeps both Student Insights compatibility routes beside the canonical destination', () => {
    expect(authenticatedRoutes.find(({ path }) => path === '/analytics/student-insights')?.authorization).toEqual({ type: 'capability', capability: 'view_student' });
    expect(authenticatedRoutes.find(({ path }) => path === '/analytics/trends')?.authorization).toEqual({ type: 'capability', capability: 'view_student' });
    expect(authenticatedRoutes.find(({ path }) => path === '/analytics/indicators')?.authorization).toEqual({ type: 'capability', capability: 'view_student' });
  });

  it('limits the reconciliation worklist to administrators', () => {
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance/reconciliation')?.authorization).toEqual({ type: 'role', role: 'admin' });
  });

  it('keeps every route behind authentication metadata', () => {
    expect(authenticatedRoutes.every(({ authorization }) => Boolean(authorization))).toBe(true);
    expect(authenticatedRoutes.find(({ path }) => path === '/grades')?.authorization).toEqual({ type: 'role', role: 'admin' });
    expect(authenticatedRoutes.find(({ path }) => path === '/grades/operations')?.authorization).toEqual({ type: 'role', role: 'admin' });
    expect(authenticatedRoutes.find(({ path }) => path === '/enrollment')?.authorization).toEqual({ type: 'capability', capability: 'manage_enrollment' });
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance-review')?.authorization).toEqual({ type: 'capability', capability: 'view_attendance' });
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance/calendar')?.authorization).toEqual({ type: 'capability', capability: 'view_attendance' });
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance/override-review')?.authorization).toEqual({ type: 'capability', capability: 'view_attendance_corrections' });
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance/machine-import')?.authorization).toEqual({ type: 'capability', capability: 'import_attendance' });
    for (const path of ['/upload', '/upload-center', '/data-portability', '/upload-history']) {
      expect(authenticatedRoutes.find((route) => route.path === path)?.authorization).toEqual({ type: 'role', role: 'admin' });
    }
  });

  it('keeps the current not-found behavior', () => {
    const wildcard = authenticatedRoutes.find(({ path }) => path === '*');
    expect(renderToStaticMarkup(wildcard?.element)).toContain('Page not found');
  });
});

describe('route loading fallback', () => {
  it('announces understandable loading status accessibly', () => {
    const markup = renderToStaticMarkup(<RouteLoadingFallback />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Loading page');
  });
});
