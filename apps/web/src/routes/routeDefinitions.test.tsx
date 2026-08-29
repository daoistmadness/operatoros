import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { authenticatedRoutes } from './routeDefinitions';
import { RouteLoadingFallback } from './RouteLoadingFallback';

const expectedPaths = [
  '/',
  '/operator/work-queue',
  '/upload',
  '/data-portability',
  '/upload-history',
  '/mapping',
  '/analytics',
  '/reports',
  '/reports/monthly',
  '/reports/annual',
  '/reports/management/monthly',
  '/reports/attendance',
  '/reports/tardiness',
  '/reports/rekap-absensi',
  '/analytics/recapitulation',
  '/attendance-review',
  '/attendance-corrections',
  '/attendance/followups',
  '/academic-management',
  '/teacher-class-assignments',
  '/attendance/class-entry',
  '/attendance/departure-policies',
  '/attendance/class-departures',
  '/enrollment',
  '/grades',
  '/config/jenjang',
  '/config/heb',
  '/config/absence-reasons',
  '/settings',
  '/settings/backups',
  '/students',
  '/staff',
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
      { path: '/mapping', redirectTo: '/enrollment' },
      { path: '/reports', redirectTo: '/reports/monthly' },
    ]);
  });

  it('keeps every route behind authentication metadata', () => {
    expect(authenticatedRoutes.every(({ authorization }) => Boolean(authorization))).toBe(true);
    expect(authenticatedRoutes.find(({ path }) => path === '/grades')?.authorization).toEqual({ type: 'role', role: 'admin' });
    expect(authenticatedRoutes.find(({ path }) => path === '/enrollment')?.authorization).toEqual({ type: 'capability', capability: 'manage_enrollment' });
    expect(authenticatedRoutes.find(({ path }) => path === '/attendance-review')?.authorization).toEqual({ type: 'capability', capability: 'view_attendance' });
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
