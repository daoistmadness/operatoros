import { lazy, type ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { RequireCapability, RequireRole } from '../components/auth/RouteGuards';
import { lazyNamedRoute } from './lazyRoute';
import { ROUTE_GROUPS, type RouteGroup } from './routeGroups';

const Dashboard = lazy(() => import('../pages/Dashboard'));
const UploadCenter = lazy(() => import('../pages/UploadCenter'));
const DataPortability = lazy(() => import('../pages/DataPortability'));
const UploadHistory = lazy(() => import('../pages/UploadHistory'));
const AttendanceReport = lazy(() => import('../pages/AttendanceReport'));
const AttendanceReview = lazy(() => import('../pages/AttendanceReview'));
const AttendanceCorrections = lazy(() => import('../pages/AttendanceCorrections'));
const AttendanceFollowUpQueue = lazy(() => import('../pages/AttendanceFollowUpQueue'));
const AbsenceReasons = lazy(() => import('../pages/AbsenceReasons'));
const HebConfig = lazy(() => import('../pages/HebConfig'));
const JenjangConfig = lazy(() => import('../features/jenjang-config'));
const Settings = lazy(() => import('../pages/Settings'));
const TardinessReport = lazy(() => import('../pages/TardinessReport'));
const RekapAbsensi = lazy(() => import('../pages/RekapAbsensi'));
const DataRecapitulation = lazy(() => import('../pages/DataRecapitulation'));
const DataQuality = lazy(() => import('../pages/DataQuality'));
const AttendanceAnalytics = lazy(() => import('../pages/AttendanceAnalytics'));
const AcademicAnalytics = lazy(() => import('../pages/AcademicAnalytics'));
const StudentTrendInsights = lazy(() => import('../pages/StudentTrendInsights'));
const StudentProfile = lazy(() => import('../pages/StudentProfile'));
const StudentManagement = lazy(() => import('../pages/StudentManagement'));
const StaffManagement = lazy(() => import('../pages/StaffManagement'));
const StaffDetail = lazy(() => import('../pages/StaffDetail'));
const CanonicalStudentProfile = lazy(() => import('../pages/CanonicalStudentProfile'));
const GradeLedger = lazy(() => import('../pages/GradeLedger'));
const Enrollment = lazy(() => import('../pages/Enrollment'));
const AcademicManagement = lazy(() => import('../pages/AcademicManagement'));
const ManagementAnalytics = lazy(() => import('../pages/ManagementAnalytics'));
const ExecutiveReports = lazy(() => import('../pages/ExecutiveReports'));
const MonthlyManagementReport = lazy(() => import('../pages/MonthlyManagementReport'));
const BackupManagement = lazy(() => import('../pages/BackupManagement'));
const OperationsAudit = lazy(() => import('../pages/OperationsAudit'));
const TeacherClassAssignments = lazy(() => import('../pages/TeacherClassAssignments'));
const ClassAttendanceEntry = lazy(() => import('../pages/ClassAttendanceEntry'));
const DismissalPolicies = lazyNamedRoute(() => import('../pages/DismissalPolicies'), 'DismissalPolicies');
const ClassEarlyDeparture = lazyNamedRoute(() => import('../pages/ClassEarlyDeparture'), 'ClassEarlyDeparture');
const OperatorWorkQueue = lazy(() => import('../features/operator-work-queue'));

export type AppRouteDefinition = {
  path: string;
  element: ReactElement;
  group: RouteGroup;
  redirectTo?: string;
  authorization: RouteAuthorization;
};

export type RouteAuthorization =
  | { type: 'authenticated' }
  | { type: 'role'; role: 'admin' | 'staff' }
  | { type: 'capability'; capability: string };

function protectRoute(element: ReactElement, authorization: RouteAuthorization): ReactElement {
  if (authorization.type === 'role') return <RequireRole role={authorization.role}>{element}</RequireRole>;
  if (authorization.type === 'capability') return <RequireCapability capability={authorization.capability}>{element}</RequireCapability>;
  return element;
}

function defineRoute(
  route: Omit<AppRouteDefinition, 'element' | 'authorization'> & { element: ReactElement; authorization: RouteAuthorization },
): AppRouteDefinition {
  return { ...route, element: protectRoute(route.element, route.authorization) };
}

const authenticated = (): RouteAuthorization => ({ type: 'authenticated' });
const adminOnly = (): RouteAuthorization => ({ type: 'role', role: 'admin' });
const capability = (name: string): RouteAuthorization => ({ type: 'capability', capability: name });

const notFound = (
  <div role="alert" className="mx-auto mt-16 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center">
    <h1 className="text-2xl font-black text-slate-900">Page not found</h1>
    <p className="mt-2 text-sm font-semibold text-slate-500">The requested route does not exist.</p>
  </div>
);

export const authenticatedRoutes: readonly AppRouteDefinition[] = [
  defineRoute({ path: '/', element: <Dashboard />, group: ROUTE_GROUPS.CORE, authorization: authenticated() }),
  defineRoute({ path: '/operator/work-queue', element: <OperatorWorkQueue />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_attendance_followups') }),
  defineRoute({ path: '/upload', element: <UploadCenter />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: adminOnly() }),
  defineRoute({ path: '/data-portability', element: <DataPortability />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: adminOnly() }),
  defineRoute({ path: '/upload-history', element: <UploadHistory />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: adminOnly() }),
  defineRoute({ path: '/mapping', element: <Navigate to="/enrollment" replace />, group: ROUTE_GROUPS.ACADEMIC, redirectTo: '/enrollment', authorization: authenticated() }),
  defineRoute({ path: '/analytics', element: <ManagementAnalytics />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports', element: <Navigate to="/reports/monthly" replace />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, redirectTo: '/reports/monthly', authorization: authenticated() }),
  defineRoute({ path: '/reports/monthly', element: <ExecutiveReports reportType="monthly" />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports/annual', element: <ExecutiveReports reportType="annual" />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports/management/monthly', element: <MonthlyManagementReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports/attendance', element: <AttendanceReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports/tardiness', element: <TardinessReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/reports/rekap-absensi', element: <RekapAbsensi />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/analytics/recapitulation', element: <DataRecapitulation />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/analytics/data-quality', element: <DataQuality />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/analytics/attendance', element: <AttendanceAnalytics />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/analytics/academic', element: <AcademicAnalytics />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: authenticated() }),
  defineRoute({ path: '/analytics/trends', element: <StudentTrendInsights />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: capability('view_student') }),
  defineRoute({ path: '/attendance-review', element: <AttendanceReview />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_attendance') }),
  defineRoute({ path: '/attendance-corrections', element: <AttendanceCorrections />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_attendance_corrections') }),
  defineRoute({ path: '/attendance/followups', element: <AttendanceFollowUpQueue />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_attendance_followups') }),
  defineRoute({ path: '/academic-management', element: <AcademicManagement />, group: ROUTE_GROUPS.ACADEMIC, authorization: adminOnly() }),
  defineRoute({ path: '/teacher-class-assignments', element: <TeacherClassAssignments />, group: ROUTE_GROUPS.ACADEMIC, authorization: adminOnly() }),
  defineRoute({ path: '/attendance/class-entry', element: <ClassAttendanceEntry />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('enter_assigned_class_attendance') }),
  defineRoute({ path: '/attendance/departure-policies', element: <DismissalPolicies />, group: ROUTE_GROUPS.ATTENDANCE, authorization: adminOnly() }),
  defineRoute({ path: '/attendance/class-departures', element: <ClassEarlyDeparture />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_early_departure') }),
  defineRoute({ path: '/enrollment', element: <Enrollment />, group: ROUTE_GROUPS.ACADEMIC, authorization: capability('manage_enrollment') }),
  defineRoute({ path: '/grades', element: <GradeLedger />, group: ROUTE_GROUPS.GRADES, authorization: adminOnly() }),
  defineRoute({ path: '/config/jenjang', element: <JenjangConfig />, group: ROUTE_GROUPS.ACADEMIC, authorization: authenticated() }),
  defineRoute({ path: '/config/heb', element: <HebConfig />, group: ROUTE_GROUPS.ACADEMIC, authorization: adminOnly() }),
  defineRoute({ path: '/config/absence-reasons', element: <AbsenceReasons />, group: ROUTE_GROUPS.ATTENDANCE, authorization: adminOnly() }),
  defineRoute({ path: '/settings', element: <Settings />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: authenticated() }),
  defineRoute({ path: '/settings/backups', element: <BackupManagement />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: adminOnly() }),
  defineRoute({ path: '/students', element: <StudentManagement />, group: ROUTE_GROUPS.ACADEMIC, authorization: capability('view_student') }),
  defineRoute({ path: '/staff', element: <StaffManagement />, group: ROUTE_GROUPS.ACADEMIC, authorization: capability('view_staff') }),
  defineRoute({ path: '/staff/:id', element: <StaffDetail />, group: ROUTE_GROUPS.ACADEMIC, authorization: capability('view_staff') }),
  defineRoute({ path: '/students/operations', element: <OperationsAudit />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: capability('view_student_audit') }),
  defineRoute({ path: '/students/:id', element: <CanonicalStudentProfile />, group: ROUTE_GROUPS.ACADEMIC, authorization: capability('view_student') }),
  defineRoute({ path: '/attendance/students/:id', element: <StudentProfile />, group: ROUTE_GROUPS.ATTENDANCE, authorization: capability('view_student') }),
  defineRoute({ path: '*', element: notFound, group: ROUTE_GROUPS.CORE, authorization: authenticated() }),
];
