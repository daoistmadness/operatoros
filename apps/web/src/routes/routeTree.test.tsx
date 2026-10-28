import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { AuthLoading, AccessDenied } from '../components/auth/RouteGuards';
import NotFoundPage from '../components/NotFoundPage';
import type { AuthContextValue } from '../context/AuthContext';
import { isRouteAuthorized, routeAuthorizations } from '../lib/router/access';
import { parseSearch, stringifySearch } from '../lib/router/search';
import { RouteLoadingFallback } from './RouteLoadingFallback';
import { routeTree } from '../routeTree.gen';

function auth(role: 'admin' | 'staff' | null, capabilities: string[] = []): AuthContextValue {
  return {
    user: role ? { id: 1, username: role, role, capabilities } : null,
    loading: false,
    authenticated: role !== null,
    can: (capability) => capabilities.includes('*') || capabilities.includes(capability),
    login: async () => ({ id: 1, username: 'synthetic', role: 'admin', capabilities: ['*'] }),
    logout: async () => undefined,
  };
}

function createTestRouter(initialEntry: string, currentAuth: AuthContextValue) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { auth: currentAuth, setupLoading: false, setupRequired: false },
    parseSearch,
    stringifySearch,
  });
}

describe('file-based route migration', () => {
  it('keeps the authorization policy for every authenticated path', () => {
    expect(Object.keys(routeAuthorizations)).toHaveLength(60);
    expect(routeAuthorizations['/staff/:id/edit']).toEqual({ type: 'capability', capability: 'manage_staff' });
    expect(routeAuthorizations['/attendance/reconciliation']).toEqual({ type: 'role', role: 'admin' });
    expect(routeAuthorizations['*']).toEqual({ type: 'authenticated' });
  });

  it('registers dynamic file routes and the authenticated fallback', () => {
    const router = createTestRouter('/', auth('admin', ['*']));
    expect(Object.keys(router.routesByPath)).toContain('/staff/$id');
    expect(Object.keys(router.routesByPath)).toContain('/attendance/students/$id');
    expect(Object.keys(router.routesByPath)).toContain('/$');
  });

  it('applies the active authorization policy to dynamic and normalized paths', () => {
    expect(isRouteAuthorized('/staff/27', auth('staff', ['view_staff']))).toBe(true);
    expect(isRouteAuthorized('/staff/27/edit', auth('staff', ['view_staff']))).toBe(false);
    expect(isRouteAuthorized('/staff/27/edit', auth('staff', ['manage_staff']))).toBe(true);
    expect(isRouteAuthorized('/attendance/calendar/', auth('staff'))).toBe(false);
    expect(isRouteAuthorized('/unknown/path', auth(null))).toBe(false);
  });

  it('revalidates active role and capability guards after auth context changes', async () => {
    const roleRouter = createTestRouter('/data-portability', auth('admin', ['*']));
    await roleRouter.load();
    expect(roleRouter.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(false);
    roleRouter.update({ context: { auth: auth('staff'), setupLoading: false, setupRequired: false } });
    expect(roleRouter.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(false);
    await roleRouter.invalidate();
    expect(roleRouter.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(true);

    const capabilityRouter = createTestRouter('/attendance/calendar', auth('staff', ['view_attendance']));
    await capabilityRouter.load();
    expect(capabilityRouter.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(false);
    capabilityRouter.update({ context: { auth: auth('staff'), setupLoading: false, setupRequired: false } });
    await capabilityRouter.invalidate();
    expect(capabilityRouter.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(true);
  });

  it('sends an unauthenticated unknown path to login with only its pathname as return state', async () => {
    const router = createTestRouter('/unknown/path?secret=discarded#part', auth(null));
    await router.load();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state.from).toBe('/unknown/path');
  });

  it('keeps alias-route authorization before redirecting', async () => {
    const router = createTestRouter('/attendance/reconciliation', auth('staff', ['view_attendance']));
    await router.load();
    expect(router.state.matches.some((match) => 'accessDenied' in match.context && match.context.accessDenied)).toBe(true);
  });

  it('preserves repeated and unknown query values and the hash for compatibility redirects', async () => {
    const router = createTestRouter('/analytics/trends?tag=one&tag=two&academic_year_id=4&extra=yes#trend', auth('staff', ['view_student']));
    await router.load();
    const destination = new URL(router.state.location.href, 'http://operator.local');
    expect(destination.pathname).toBe('/analytics/student-insights');
    expect(destination.searchParams.getAll('tag')).toEqual(['one', 'two']);
    expect(destination.searchParams.get('academic_year_id')).toBe('4');
    expect(destination.searchParams.get('extra')).toBe('yes');
    expect(destination.searchParams.get('view')).toBe('trends');
    expect(destination.hash).toBe('#trend');
  });

  it('preserves report compatibility filters and fragments', async () => {
    const router = createTestRouter('/reports/attendance?academic_year_id=4&filter=x#attendance', auth('staff'));
    await router.load();
    const destination = new URL(router.state.location.href, 'http://operator.local');
    expect(destination.pathname).toBe('/analytics/attendance');
    expect(destination.searchParams.get('academic_year_id')).toBe('4');
    expect(destination.searchParams.get('filter')).toBe('x');
    expect(destination.searchParams.get('view')).toBe('report');
    expect(destination.hash).toBe('#attendance');
  });

  it('shows the route loading, denied, and not-found states accessibly', () => {
    expect(renderToStaticMarkup(<AuthLoading />)).toContain('Checking your session');
    expect(renderToStaticMarkup(<AccessDenied />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<NotFoundPage />)).toContain('Page not found');
    expect(renderToStaticMarkup(<RouteLoadingFallback />)).toContain('aria-live="polite"');
  });
});
