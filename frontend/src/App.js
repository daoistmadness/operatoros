import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Navigate, Outlet, Routes, Route, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import UploadCenter from './pages/UploadCenter.tsx';
import UploadHistory from './pages/UploadHistory';
import AttendanceReport from './pages/AttendanceReport';
import AttendanceReview from './pages/AttendanceReview';
import AttendanceCorrections from './pages/AttendanceCorrections';
import AbsenceReasons from './pages/AbsenceReasons';
import HebConfig from './pages/HebConfig';
import JenjangConfig from './pages/JenjangConfig';
import Settings from './pages/Settings';
import TardinessReport from './pages/TardinessReport';
import RekapAbsensi from './pages/RekapAbsensi';
import StudentProfile from './pages/StudentProfile';
import StudentManagement from './pages/StudentManagement.tsx';
import CanonicalStudentProfile from './pages/CanonicalStudentProfile.tsx';
import GradeLedger from './pages/GradeLedger.tsx';
import Enrollment from './pages/Enrollment.tsx';
import AcademicManagement from './pages/AcademicManagement.tsx';
import ManagementAnalytics from './pages/ManagementAnalytics';
import ExecutiveReports from './pages/ExecutiveReports.tsx';
import MonthlyManagementReport from './pages/MonthlyManagementReport.tsx';
import BackupManagement from './pages/BackupManagement.tsx';
import OperationsAudit from './pages/OperationsAudit.tsx';
import SidebarNav from './components/SidebarNav';
import Login from './pages/Login.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { RequireAuth, RequireCapability, RequireRole } from './components/auth/RouteGuards.tsx';
import { SetupBoundary } from './components/auth/SetupBoundary.tsx';

export function AppShell() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const openerRef = useRef(null);
  const mainRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    setNavigationOpen(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (!navigationOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (mainRef.current) mainRef.current.inert = true;
    const drawer = document.getElementById('navigation-drawer');
    const focusable = () => [openerRef.current, ...(drawer?.querySelectorAll('a[href], button:not([disabled])') || [])]
      .filter((element) => element?.getClientRects().length > 0);
    window.requestAnimationFrame(() => {
      const items = focusable();
      (items[1] ?? items[0])?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setNavigationOpen(false); window.requestAnimationFrame(() => openerRef.current?.focus()); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (mainRef.current) mainRef.current.inert = false;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [navigationOpen]);

  return (
    <div className="app-shell min-h-screen bg-slate-50 xl:flex">
      <a href="#main-content" className="fixed left-4 top-2 z-[80] -translate-y-16 rounded-lg bg-slate-950 px-4 py-2 font-bold text-white transition-transform focus:translate-y-0 motion-reduce:transition-none">Skip to main content</a>
      <button
        ref={openerRef}
        type="button"
        aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navigationOpen}
        aria-controls="navigation-drawer"
        onClick={() => setNavigationOpen((open) => !open)}
        className="fixed left-4 top-4 z-[60] inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm xl:hidden"
      >
        {navigationOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      {navigationOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          aria-hidden="true"
          tabIndex="-1"
          onClick={() => setNavigationOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] xl:hidden"
        />
      )}
      <SidebarNav open={navigationOpen} collapsed={navigationCollapsed} onToggleCollapsed={() => setNavigationCollapsed((value) => !value)} onNavigate={() => setNavigationOpen(false)} />
      <main ref={mainRef} id="main-content" tabIndex="-1" aria-hidden={navigationOpen ? 'true' : undefined} className={`app-main min-w-0 flex-1 px-4 pb-8 pt-20 outline-none sm:px-6 xl:p-8 ${navigationCollapsed ? 'xl:ml-20' : 'xl:ml-64'}`}>
        <div className="max-w-7xl mx-auto"><Outlet /></div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <SetupBoundary>
        <AuthProvider>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<RequireRole role="admin"><UploadCenter /></RequireRole>} />
              <Route path="/upload-history" element={<RequireRole role="admin"><UploadHistory /></RequireRole>} />
              <Route path="/mapping" element={<Navigate to="/enrollment" replace />} />
              <Route path="/analytics" element={<ManagementAnalytics />} />
              <Route path="/reports" element={<Navigate to="/reports/monthly" replace />} />
              <Route path="/reports/monthly" element={<ExecutiveReports reportType="monthly" />} />
              <Route path="/reports/annual" element={<ExecutiveReports reportType="annual" />} />
              <Route path="/reports/management/monthly" element={<MonthlyManagementReport />} />
              <Route path="/reports/attendance" element={<AttendanceReport />} />
              <Route path="/reports/tardiness" element={<TardinessReport />} />
              <Route path="/reports/rekap-absensi" element={<RekapAbsensi />} />
              <Route path="/attendance-review" element={<RequireCapability capability="view_attendance"><AttendanceReview /></RequireCapability>} />
              <Route path="/attendance-corrections" element={<RequireCapability capability="view_attendance_corrections"><AttendanceCorrections /></RequireCapability>} />
              <Route path="/academic-management" element={<RequireRole role="admin"><AcademicManagement /></RequireRole>} />
              <Route path="/enrollment" element={<RequireCapability capability="manage_enrollment"><Enrollment /></RequireCapability>} />
              <Route path="/grades" element={<RequireRole role="admin"><GradeLedger /></RequireRole>} />
              <Route path="/config/jenjang" element={<JenjangConfig />} />
              <Route path="/config/heb" element={<RequireRole role="admin"><HebConfig /></RequireRole>} />
              <Route path="/config/absence-reasons" element={<RequireRole role="admin"><AbsenceReasons /></RequireRole>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/backups" element={<RequireRole role="admin"><BackupManagement /></RequireRole>} />
              <Route path="/students" element={<RequireCapability capability="view_student"><StudentManagement /></RequireCapability>} />
              <Route path="/students/operations" element={<RequireCapability capability="view_student_audit"><OperationsAudit /></RequireCapability>} />
              <Route path="/students/:id" element={<RequireCapability capability="view_student"><CanonicalStudentProfile /></RequireCapability>} />
              <Route path="/attendance/students/:id" element={<RequireCapability capability="view_student"><StudentProfile /></RequireCapability>} />
              <Route path="*" element={<div role="alert" className="mx-auto mt-16 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-2xl font-black text-slate-900">Page not found</h1><p className="mt-2 text-sm font-semibold text-slate-500">The requested route does not exist.</p></div>} />
            </Route>
          </Route>
          </Routes>
        </AuthProvider>
      </SetupBoundary>
    </Router>
  );
}

export default App;
