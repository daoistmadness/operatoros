import React, { useState } from 'react';
import { BrowserRouter as Router, Navigate, Outlet, Routes, Route } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import UploadCenter from './pages/UploadCenter.tsx';
import UploadHistory from './pages/UploadHistory';
import AttendanceReport from './pages/AttendanceReport';
import AttendanceReview from './pages/AttendanceReview';
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
import SidebarNav from './components/SidebarNav';
import Login from './pages/Login.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { RequireAuth, RequireRole } from './components/auth/RouteGuards.tsx';
import { SetupBoundary } from './components/auth/SetupBoundary.tsx';

function AppShell() {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="app-shell min-h-screen bg-slate-50 xl:flex">
      <button
        type="button"
        aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navigationOpen}
        aria-controls="primary-navigation"
        onClick={() => setNavigationOpen((open) => !open)}
        className="fixed left-4 top-4 z-[60] inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm xl:hidden"
      >
        {navigationOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      {navigationOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] xl:hidden"
        />
      )}
      <SidebarNav open={navigationOpen} onNavigate={() => setNavigationOpen(false)} />
      <main className="app-main min-w-0 flex-1 px-4 pb-8 pt-20 sm:px-6 xl:ml-64 xl:p-8">
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
              <Route path="/upload" element={<UploadCenter />} />
              <Route path="/upload-history" element={<UploadHistory />} />
              <Route path="/mapping" element={<Navigate to="/enrollment" replace />} />
              <Route path="/analytics" element={<ManagementAnalytics />} />
              <Route path="/reports" element={<Navigate to="/reports/monthly" replace />} />
              <Route path="/reports/monthly" element={<ExecutiveReports reportType="monthly" />} />
              <Route path="/reports/annual" element={<ExecutiveReports reportType="annual" />} />
              <Route path="/reports/management/monthly" element={<MonthlyManagementReport />} />
              <Route path="/reports/attendance" element={<AttendanceReport />} />
              <Route path="/reports/tardiness" element={<TardinessReport />} />
              <Route path="/reports/rekap-absensi" element={<RekapAbsensi />} />
              <Route path="/attendance-review" element={<AttendanceReview />} />
              <Route path="/academic-management" element={<AcademicManagement />} />
              <Route path="/enrollment" element={<Enrollment />} />
              <Route path="/grades" element={<GradeLedger />} />
              <Route path="/config/jenjang" element={<JenjangConfig />} />
              <Route path="/config/heb" element={<HebConfig />} />
              <Route path="/config/absence-reasons" element={<AbsenceReasons />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/backups" element={<RequireRole role="admin"><BackupManagement /></RequireRole>} />
              <Route path="/students" element={<RequireRole role="admin"><StudentManagement /></RequireRole>} />
              <Route path="/students/:id" element={<RequireRole role="admin"><CanonicalStudentProfile /></RequireRole>} />
              <Route path="/attendance/students/:id" element={<StudentProfile />} />
            </Route>
          </Route>
          </Routes>
        </AuthProvider>
      </SetupBoundary>
    </Router>
  );
}

export default App;
