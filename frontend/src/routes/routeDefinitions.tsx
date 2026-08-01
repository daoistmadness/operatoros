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
const StudentProfile = lazy(() => import('../pages/StudentProfile'));
const StudentManagement = lazy(() => import('../pages/StudentManagement'));
const StaffManagement = lazy(() => import('../pages/StaffManagement'));
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
  authorization?: 'authenticated' | 'admin' | 'capability';
};

const notFound = (
  <div role="alert" className="mx-auto mt-16 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center">
    <h1 className="text-2xl font-black text-slate-900">Page not found</h1>
    <p className="mt-2 text-sm font-semibold text-slate-500">The requested route does not exist.</p>
  </div>
);

export const authenticatedRoutes: readonly AppRouteDefinition[] = [
  { path: '/', element: <Dashboard />, group: ROUTE_GROUPS.CORE, authorization: 'authenticated' },
  { path: '/operator/work-queue', element: <RequireCapability capability="view_attendance_followups"><OperatorWorkQueue /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/upload', element: <RequireRole role="admin"><UploadCenter /></RequireRole>, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'admin' },
  { path: '/data-portability', element: <RequireRole role="admin"><DataPortability /></RequireRole>, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'admin' },
  { path: '/upload-history', element: <RequireRole role="admin"><UploadHistory /></RequireRole>, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'admin' },
  { path: '/mapping', element: <Navigate to="/enrollment" replace />, group: ROUTE_GROUPS.ACADEMIC, redirectTo: '/enrollment', authorization: 'authenticated' },
  { path: '/analytics', element: <ManagementAnalytics />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports', element: <Navigate to="/reports/monthly" replace />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, redirectTo: '/reports/monthly', authorization: 'authenticated' },
  { path: '/reports/monthly', element: <ExecutiveReports reportType="monthly" />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports/annual', element: <ExecutiveReports reportType="annual" />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports/management/monthly', element: <MonthlyManagementReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports/attendance', element: <AttendanceReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports/tardiness', element: <TardinessReport />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/reports/rekap-absensi', element: <RekapAbsensi />, group: ROUTE_GROUPS.REPORTS_ANALYTICS, authorization: 'authenticated' },
  { path: '/attendance-review', element: <RequireCapability capability="view_attendance"><AttendanceReview /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/attendance-corrections', element: <RequireCapability capability="view_attendance_corrections"><AttendanceCorrections /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/attendance/followups', element: <RequireCapability capability="view_attendance_followups"><AttendanceFollowUpQueue /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/academic-management', element: <RequireRole role="admin"><AcademicManagement /></RequireRole>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'admin' },
  { path: '/teacher-class-assignments', element: <RequireRole role="admin"><TeacherClassAssignments /></RequireRole>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'admin' },
  { path: '/attendance/class-entry', element: <RequireCapability capability="enter_assigned_class_attendance"><ClassAttendanceEntry /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/attendance/departure-policies', element: <RequireRole role="admin"><DismissalPolicies /></RequireRole>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'admin' },
  { path: '/attendance/class-departures', element: <RequireCapability capability="view_early_departure"><ClassEarlyDeparture /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '/enrollment', element: <RequireCapability capability="manage_enrollment"><Enrollment /></RequireCapability>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'capability' },
  { path: '/grades', element: <RequireRole role="admin"><GradeLedger /></RequireRole>, group: ROUTE_GROUPS.GRADES, authorization: 'admin' },
  { path: '/config/jenjang', element: <JenjangConfig />, group: ROUTE_GROUPS.ACADEMIC, authorization: 'authenticated' },
  { path: '/config/heb', element: <RequireRole role="admin"><HebConfig /></RequireRole>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'admin' },
  { path: '/config/absence-reasons', element: <RequireRole role="admin"><AbsenceReasons /></RequireRole>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'admin' },
  { path: '/settings', element: <Settings />, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'authenticated' },
  { path: '/settings/backups', element: <RequireRole role="admin"><BackupManagement /></RequireRole>, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'admin' },
  { path: '/students', element: <RequireCapability capability="view_student"><StudentManagement /></RequireCapability>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'capability' },
  { path: '/staff', element: <RequireCapability capability="view_staff"><StaffManagement /></RequireCapability>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'capability' },
  { path: '/students/operations', element: <RequireCapability capability="view_student_audit"><OperationsAudit /></RequireCapability>, group: ROUTE_GROUPS.SYSTEM_ADMINISTRATION, authorization: 'capability' },
  { path: '/students/:id', element: <RequireCapability capability="view_student"><CanonicalStudentProfile /></RequireCapability>, group: ROUTE_GROUPS.ACADEMIC, authorization: 'capability' },
  { path: '/attendance/students/:id', element: <RequireCapability capability="view_student"><StudentProfile /></RequireCapability>, group: ROUTE_GROUPS.ATTENDANCE, authorization: 'capability' },
  { path: '*', element: notFound, group: ROUTE_GROUPS.CORE, authorization: 'authenticated' },
];
