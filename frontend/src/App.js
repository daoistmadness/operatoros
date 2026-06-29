import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import UploadHistory from './pages/UploadHistory';
import ClassMapping from './pages/ClassMapping';
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
import SidebarNav from './components/SidebarNav';

function App() {
  return (
    <Router>
      <div className="app-shell min-h-screen bg-slate-50 flex">
        <SidebarNav />
        <main className="app-main flex-1 ml-64 p-8">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/upload-history" element={<UploadHistory />} />
              <Route path="/mapping" element={<ClassMapping />} />
              <Route path="/analytics" element={<ManagementAnalytics />} />
              <Route path="/reports" element={<AttendanceReport />} />
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
              <Route path="/students/:id" element={<StudentProfile />} />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;
