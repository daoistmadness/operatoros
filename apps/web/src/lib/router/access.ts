import { redirect } from '@tanstack/react-router';
import type { AuthContextValue } from '../../context/AuthContext';

export type RouteAuthorization =
  | { type: 'authenticated' }
  | { type: 'role'; role: 'admin' | 'staff' }
  | { type: 'capability'; capability: string };

export type RouterContext = {
  auth: AuthContextValue;
  setupLoading: boolean;
  setupRequired: boolean;
};

export const routeAuthorizations: Record<string, RouteAuthorization> = {
  '/': { type: 'authenticated' },
  '/setup': { type: 'authenticated' },
  '/operator/work-queue': { type: 'capability', capability: 'view_attendance_followups' },
  '/upload': { type: 'role', role: 'admin' },
  '/upload-center': { type: 'role', role: 'admin' },
  '/data-portability': { type: 'role', role: 'admin' },
  '/upload-history': { type: 'role', role: 'admin' },
  '/mapping': { type: 'authenticated' },
  '/analytics': { type: 'authenticated' },
  '/analytics/management-review/student-profile': { type: 'capability', capability: 'view_student' },
  '/reports': { type: 'authenticated' },
  '/reports/monthly': { type: 'authenticated' },
  '/reports/annual': { type: 'authenticated' },
  '/reports/management/monthly': { type: 'role', role: 'admin' },
  '/reports/attendance': { type: 'authenticated' },
  '/reports/tardiness': { type: 'authenticated' },
  '/reports/rekap-absensi': { type: 'authenticated' },
  '/analytics/recapitulation': { type: 'authenticated' },
  '/analytics/data-quality': { type: 'authenticated' },
  '/analytics/attendance': { type: 'authenticated' },
  '/analytics/academic': { type: 'authenticated' },
  '/analytics/student-insights': { type: 'capability', capability: 'view_student' },
  '/analytics/trends': { type: 'capability', capability: 'view_student' },
  '/analytics/indicators': { type: 'capability', capability: 'view_student' },
  '/attendance-review': { type: 'capability', capability: 'view_attendance' },
  '/attendance-corrections': { type: 'capability', capability: 'view_attendance_corrections' },
  '/attendance/override-review': { type: 'capability', capability: 'view_attendance_corrections' },
  '/attendance/followups': { type: 'capability', capability: 'view_attendance_followups' },
  '/academic-management': { type: 'role', role: 'admin' },
  '/teacher-class-assignments': { type: 'role', role: 'admin' },
  '/attendance/class-entry': { type: 'capability', capability: 'enter_assigned_class_attendance' },
  '/attendance/daily': { type: 'capability', capability: 'view_attendance' },
  '/attendance/calendar': { type: 'capability', capability: 'view_attendance' },
  '/attendance/monthly-recap': { type: 'role', role: 'admin' },
  '/attendance/reconciliation': { type: 'role', role: 'admin' },
  '/attendance/machine-import': { type: 'capability', capability: 'import_attendance' },
  '/classes/:id': { type: 'capability', capability: 'view_student' },
  '/attendance/departure-policies': { type: 'role', role: 'admin' },
  '/attendance/class-departures': { type: 'capability', capability: 'view_early_departure' },
  '/enrollment': { type: 'capability', capability: 'manage_enrollment' },
  '/grades': { type: 'role', role: 'admin' },
  '/grades/operations': { type: 'role', role: 'admin' },
  '/config/jenjang': { type: 'authenticated' },
  '/config/heb': { type: 'role', role: 'admin' },
  '/config/absence-reasons': { type: 'role', role: 'admin' },
  '/settings': { type: 'authenticated' },
  '/settings/backups': { type: 'role', role: 'admin' },
  '/students': { type: 'capability', capability: 'view_student' },
  '/staff': { type: 'capability', capability: 'view_staff' },
  '/staff/new': { type: 'capability', capability: 'manage_staff' },
  '/staff/import': { type: 'capability', capability: 'import_staff' },
  '/staff/analytics': { type: 'capability', capability: 'view_staff_analytics' },
  '/staff/monthly-activities': { type: 'capability', capability: 'view_staff_analytics' },
  '/reports/upp': { type: 'role', role: 'admin' },
  '/staff/:id/edit': { type: 'capability', capability: 'manage_staff' },
  '/staff/:id': { type: 'capability', capability: 'view_staff' },
  '/students/operations': { type: 'capability', capability: 'view_student_audit' },
  '/students/:id': { type: 'capability', capability: 'view_student' },
  '/attendance/students/:id': { type: 'capability', capability: 'view_student' },
  '*': { type: 'authenticated' },
};

export function routeAuthorizationForPath(path: string): RouteAuthorization | undefined {
  return routeAuthorizations[path];
}

type RouteAccessOptions = {
  context: RouterContext;
  location: { pathname: string };
};

export function authorizeRoute(path: string) {
  return ({ context, location }: RouteAccessOptions) => {
    if (context.setupLoading || context.setupRequired || context.auth.loading) return { waiting: true };
    if (!context.auth.authenticated) {
      throw redirect({ to: '/login', state: { from: location.pathname } });
    }

    const authorization = routeAuthorizations[path];
    if (!authorization || authorization.type === 'authenticated') return undefined;
    const allowed = authorization.type === 'role'
      ? context.auth.user?.role === authorization.role
      : context.auth.can(authorization.capability);
    return allowed ? undefined : { accessDenied: true };
  };
}
