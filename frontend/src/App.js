import React from 'react';
import { BrowserRouter as Router, Navigate, Outlet, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
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
import GradeLedger from './pages/GradeLedger.tsx';
import Enrollment from './pages/Enrollment.tsx';
import AcademicManagement from './pages/AcademicManagement.tsx';
import ManagementAnalytics from './pages/ManagementAnalytics';
import ExecutiveReports from './pages/ExecutiveReports.tsx';
import BackupManagement from './pages/BackupManagement.tsx';
import SidebarNav from './components/SidebarNav';
import Login from './pages/Login.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { RequireAuth, RequireRole } from './components/auth/RouteGuards.tsx';
import { SetupBoundary } from './components/auth/SetupBoundary.tsx';

function AppShell() {
  return (
    <div className="app-shell min-h-screen bg-slate-50 flex">
      <SidebarNav />
      <main className="app-main min-w-0 flex-1 ml-64 p-8">
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
              <Route path="/upload" element={<Upload />} />
              <Route path="/upload-history" element={<UploadHistory />} />
              <Route path="/mapping" element={<Navigate to="/enrollment" replace />} />
              <Route path="/analytics" element={<ManagementAnalytics />} />
              <Route path="/reports" element={<Navigate to="/reports/monthly" replace />} />
              <Route path="/reports/monthly" element={<ExecutiveReports reportType="monthly" />} />
              <Route path="/reports/annual" element={<ExecutiveReports reportType="annual" />} />
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
              <Route path="/students/:id" element={<StudentProfile />} />
            </Route>
          </Route>
          </Routes>
        </AuthProvider>
      </SetupBoundary>
    </Router>
  );
}

export default App;
