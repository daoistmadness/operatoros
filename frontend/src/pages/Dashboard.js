import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import ChartMonthly from "../components/ChartMonthly";
import ChartClass from "../components/ChartClass";
import {
  AlertTriangle,
  CalendarDays,
  Trophy,
  TrendingUp,
  UserPlus,
  ExternalLink,
  ChevronRight,
  Fingerprint,
  X,
  Check,
  Loader2,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  BarChart4,
  Activity,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "../api";
import { cn } from "../lib/cn";
import {
  assignStudentClass,
  deleteHebOverride,
  getDashboardSnapshot,
  getHebOverview,
  normalizeAbsenceTotals,
  saveHebOverride,
} from "../lib/api/endpoints";

const MONTH_OPTIONS = [
  { value: 1, label: "Januari" },
  { value: 2, label: "Februari" },
  { value: 3, label: "Maret" },
  { value: 4, label: "April" },
  { value: 5, label: "Mei" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "Agustus" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Desember" },
];

function formatMonthYearLabel(month, year) {
  return `${MONTH_OPTIONS.find((item) => item.value === Number(month))?.label || "Bulan"} ${year}`;
}

const snappySpring = { type: "spring", stiffness: 400, damping: 30 };

export default function Dashboard() {
  const today = useMemo(() => new Date(), []);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState([]);
  const [classData, setClassData] = useState([]);
  const [offenders, setOffenders] = useState([]);
  const [pending, setPending] = useState([]);
  const [summary, setSummary] = useState({ total_late: 0, total_incomplete: 0, total_offenders: 0 });
  const [incompleteSummary, setIncompleteSummary] = useState(null);
  const [absenceSummary, setAbsenceSummary] = useState([]);
  const [rekapAbsensiSummary, setRekapAbsensiSummary] = useState(null);
  const [existingClasses, setExistingClasses] = useState([]);
  const [mappingWarning, setMappingWarning] = useState("");

  // Filters state (visual only for now per spec design)
  const [selectedMonth, setSelectedMonth] = useState(String(today.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [selectedJenjang, setSelectedJenjang] = useState("All Jenjang");

  // Class mapping modal state
  const [modalStudent, setModalStudent] = useState(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await getDashboardSnapshot(today);
      setMonthlyData(snapshot.monthlyData);
      setClassData(snapshot.classData);
      setOffenders(snapshot.offenders);
      setPending(snapshot.pending);
      setSummary(snapshot.summary);
      setExistingClasses(snapshot.existingClasses);
      setIncompleteSummary(snapshot.incompleteSummary);
      setAbsenceSummary(snapshot.absenceSummary);
      setRekapAbsensiSummary(snapshot.rekapAbsensiSummary);
      setMappingWarning(snapshot.mappingWarning);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleOpenMapping = (student) => setModalStudent(student);

  const openFirstPendingForMapping = () => {
    if (pending.length > 0) {
      setModalStudent(pending[0]);
      return;
    }
    document.getElementById('pending-categorization')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMapped = async (mappedStudentId) => {
    setModalStudent(null);
    await loadDashboardData();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <div className="animate-spin rounded-[9999px] h-12 w-12 border-b-2 border-brand"></div>
        <p className="text-slate-500 font-medium animate-pulse">Loading analytics...</p>
      </div>
    );
  }

  const totalLate = monthlyData.reduce((acc, curr) => acc + curr.late_count, 0);
  const avgPunctuality = classData.length > 0 
    ? Math.round(classData.reduce((acc, curr) => acc + curr.punctuality_score, 0) / classData.length) 
    : 0;
  const absenceTotals = normalizeAbsenceTotals(absenceSummary);

  const totalClasses = Number(absenceTotals.total || 0);
  const enteredClasses = Number(absenceTotals.entered || 0);
  const missingClasses = Math.max(0, totalClasses - enteredClasses);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-16">
      
      {/* 1. Header Section */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-slate-200/60">
        <div>
          <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">System Analytics</h1>
          <p className="text-slate-500 mt-2 font-medium">Real-time attendance overview and behavioral metrics.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm p-1">
            <select 
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent border-none text-sm font-semibold text-slate-700 py-1.5 pl-3 pr-8 focus:ring-0 cursor-pointer"
            >
              {MONTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <div className="w-px h-5 bg-slate-200 mx-1"></div>
            <select 
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-transparent border-none text-sm font-semibold text-slate-700 py-1.5 pl-3 pr-8 focus:ring-0 cursor-pointer"
            >
              {Array.from({ length: 3 }, (_, i) => String(today.getFullYear() - i)).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm p-1">
            <Filter size={16} className="text-slate-400 ml-3" />
            <select 
              value={selectedJenjang}
              onChange={(e) => setSelectedJenjang(e.target.value)}
              className="bg-transparent border-none text-sm font-semibold text-slate-700 py-1.5 pl-2 pr-8 focus:ring-0 cursor-pointer"
            >
              <option value="All Jenjang">All Jenjang</option>
              <option value="Primary">Primary</option>
              <option value="Secondary">Secondary</option>
            </select>
          </div>

          <button className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm">
            <Download size={16} /> Export
          </button>
        </div>
      </header>

      {/* 2. Alert Banner */}
      {mappingWarning && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          transition={snappySpring}
          className="bg-amber-50 border border-amber-200 text-amber-900 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between shadow-sm gap-4 relative overflow-hidden"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
          <div className="flex items-start gap-4 z-10">
            <div className="p-2 bg-amber-100 rounded-xl mt-0.5">
              <AlertTriangle className="text-amber-600" size={24} />
            </div>
            <div>
              <h3 className="font-bold text-lg">Mapping Incomplete</h3>
              <p className="font-medium text-amber-800 mt-0.5">{mappingWarning}</p>
              <p className="text-sm text-amber-700/80 mt-1">This may affect the absolute accuracy of class-level analytics.</p>
            </div>
          </div>
          <button
            onClick={() => document.getElementById('pending-categorization')?.scrollIntoView({ behavior: 'smooth' })}
            className="whitespace-nowrap shrink-0 bg-white border border-amber-300 text-amber-700 font-bold hover:bg-amber-100 px-5 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            Fix Mapping
          </button>
        </motion.div>
      )}

      {/* 3. Executive Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-y-4 gap-x-8 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-[9999px] bg-emerald-100 text-emerald-600">
            <Check size={18} strokeWidth={3} />
          </span>
          <div className="font-bold text-slate-800 uppercase tracking-wide text-sm">Attendance Health: GOOD</div>
        </div>
        <div className="h-6 w-px bg-slate-200 hidden md:block"></div>
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-emerald-500" />
          <div className="text-slate-600 font-medium"><span className="text-slate-900 font-bold">{avgPunctuality}%</span> avg punctuality</div>
        </div>
        <div className="h-6 w-px bg-slate-200 hidden md:block"></div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={incompleteSummary?.total_incomplete > 0 ? "text-amber-500" : "text-emerald-500"} />
          <div className="text-slate-600 font-medium">
            <span className="text-slate-900 font-bold">{incompleteSummary?.total_incomplete || 0}</span> data quality issues
          </div>
        </div>
        <div className="h-6 w-px bg-slate-200 hidden lg:block"></div>
        <div className="flex items-center gap-2">
          <FileText size={18} className={missingClasses > 0 ? "text-amber-500" : "text-emerald-500"} />
          <div className="text-slate-600 font-medium">
            <span className="text-slate-900 font-bold">{missingClasses}</span> classes pending review
          </div>
        </div>
      </div>

      {/* 4. KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Total Late Entries" 
          value={summary.total_late} 
          icon={<TrendingUp size={24} className="text-indigo-600" />} 
          trend="Total distinct instances"
          color="bg-indigo-50"
        />
        <KpiCard 
          title="Frequent Offenders" 
          value={summary.total_offenders} 
          icon={<AlertTriangle size={24} className="text-rose-600" />} 
          trend="Individuals (>3 lates)"
          color="bg-rose-50"
        />
        <KpiCard 
          title="Unmapped Students" 
          value={pending.length} 
          icon={<UserPlus size={24} className="text-slate-600" />} 
          trend={pending.length > 0 ? "Action required" : "All mapped"}
          color="bg-slate-100"
        />
        <KpiCard 
          title="Incomplete Records" 
          value={incompleteSummary?.total_incomplete || 0} 
          icon={<Fingerprint size={24} className="text-amber-600" />} 
          trend="Missing checkout scans"
          color="bg-amber-50"
        />
      </div>

      {/* 5. Attendance Summary Section */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Card: Rekap Absensi Summary */}
        <motion.div 
          whileHover={{ y: -4 }} 
          transition={snappySpring}
          className="card p-6 lg:col-span-3 flex flex-col justify-between group"
          style={{ willChange: "transform, box-shadow" }}
        >
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <BarChart4 className="text-brand" />
                Rekap Absensi Summary
              </h3>
              <span className="text-xs font-bold text-slate-400 uppercase">{formatMonthYearLabel(selectedMonth, selectedYear)}</span>
            </div>
            
            {Array.isArray(rekapAbsensiSummary?.jenjang) && rekapAbsensiSummary.jenjang.length > 0 ? (
              <div className="space-y-6">
                <div className="grid grid-cols-4 gap-4">
                  <MetricBlock label="Hadir" value={rekapAbsensiSummary.global_summary?.percentages?.hadir_pct} color="text-emerald-600" />
                  <MetricBlock label="Sakit" value={rekapAbsensiSummary.global_summary?.percentages?.sakit_pct} color="text-amber-500" />
                  <MetricBlock label="Izin" value={rekapAbsensiSummary.global_summary?.percentages?.izin_pct} color="text-blue-500" />
                  <MetricBlock label="Alfa" value={rekapAbsensiSummary.global_summary?.percentages?.alfa_pct} color="text-rose-500" />
                </div>
                
                {/* Visual Bar */}
                <div className="w-full h-4 rounded-[9999px] overflow-hidden flex bg-slate-100 mt-2">
                  <div style={{ width: `${rekapAbsensiSummary.global_summary?.percentages?.hadir_pct || 0}%` }} className="bg-emerald-500 h-full"></div>
                  <div style={{ width: `${rekapAbsensiSummary.global_summary?.percentages?.sakit_pct || 0}%` }} className="bg-amber-400 h-full"></div>
                  <div style={{ width: `${rekapAbsensiSummary.global_summary?.percentages?.izin_pct || 0}%` }} className="bg-blue-400 h-full"></div>
                  <div style={{ width: `${rekapAbsensiSummary.global_summary?.percentages?.alfa_pct || 0}%` }} className="bg-rose-400 h-full"></div>
                </div>
              </div>
            ) : (
               <p className="text-sm font-medium text-slate-500 py-4">Sistem sedang menghimpun data rekapitulasi absensi untuk bulan ini...</p>
            )}
          </div>
          
          <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
            <Link to="/reports/rekap-absensi" className="text-sm font-semibold text-brand group-hover:text-brand-hover inline-flex items-center gap-1">
              View Detailed Report <ChevronRight size={16} />
            </Link>
          </div>
        </motion.div>

        {/* Right Card: Absence Review Status */}
        <motion.div 
          whileHover={{ y: -4 }} 
          transition={snappySpring}
          className="card p-6 lg:col-span-2 flex flex-col justify-between bg-slate-900 border-slate-800 text-white relative overflow-hidden"
          style={{ willChange: "transform, box-shadow" }}
        >
          <div className="absolute top-0 right-0 p-32 bg-brand/20 blur-3xl rounded-[9999px] transform translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
          
          <div className="z-10 relative">
            <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
              <CalendarDays className="text-brand" />
              Absence Review Status
            </h3>
            
            <div className="space-y-4">
              <div>
                <p className="text-4xl font-bold font-mono tracking-tight">{enteredClasses} <span className="text-xl text-slate-400">/ {totalClasses}</span></p>
                <p className="text-sm font-medium text-slate-400 mt-1">Classes Coverage</p>
              </div>
              
              {missingClasses > 0 ? (
                <div className="inline-flex py-1.5 px-3 bg-amber-500/20 text-amber-300 font-semibold text-sm rounded-lg items-center gap-2">
                  <AlertTriangle size={16} /> {missingClasses} classes pending review
                </div>
              ) : totalClasses > 0 ? (
                <div className="inline-flex py-1.5 px-3 bg-emerald-500/20 text-emerald-400 font-semibold text-sm rounded-lg items-center gap-2">
                  <Check size={16} /> All classes reviewed
                </div>
              ) : null}
            </div>
          </div>
          
          <div className="mt-8 z-10 relative">
            <Link to="/config/absence-reasons" className="btn-primary w-full shadow-lg shadow-brand/20">
              Complete Review
            </Link>
          </div>
        </motion.div>
      </div>

      {/* 6. Analytics Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Monthly Trend Chart */}
        <div className="card p-6 md:p-8 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-slate-900">Monthly Late Trend</h3>
            <span className="text-xs font-bold px-3 py-1 bg-slate-100 rounded-[9999px] text-slate-500 tracking-wider">6 MONTHS</span>
          </div>
          <div className="flex-1 flex flex-col justify-end">
            {monthlyData.length > 0 ? (
              <div className="h-[300px] w-full"><ChartMonthly data={monthlyData} /></div>
            ) : (
              <div className="h-[300px] flex items-center justify-center"><EmptyState message="No monthly data recorded yet." /></div>
            )}
          </div>
        </div>

        {/* Punctuality Leaderboard */}
        <div className="card p-6 md:p-8 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-slate-900">Class Leaderboard</h3>
            <span className="text-xs font-bold px-3 py-1 bg-emerald-50 rounded-[9999px] text-emerald-600 tracking-wider">TOP 5</span>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            {classData.length > 0 ? (
              <div className="h-[300px] w-full"><ChartClass data={classData.slice(0, 5)} /></div>
            ) : (
              <div className="h-[300px] flex items-center justify-center"><EmptyState message="No class data available to rank." /></div>
            )}
          </div>
        </div>
      </div>

      {/* 7. Operational Insights (Bottom Section) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="pending-categorization">
        
        {/* Frequent Offenders List */}
        <div className="card p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <UsersIcon size={20} className="text-rose-500" /> Top Frequent Offenders
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left bg-white">
              <thead className="bg-slate-50 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3 text-right">Lates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {offenders.slice(0,5).map((p, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{p.class_name}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 h-6 rounded bg-rose-100 text-rose-700 font-bold text-xs">{p.late_count}</span>
                    </td>
                  </tr>
                ))}
                {offenders.length === 0 && (
                  <tr><td colSpan="3" className="p-8 text-center text-sm font-medium text-slate-500">No late records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending Mapping */}
        <div className="card p-6 bg-slate-50/50">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold flex items-center gap-2">
               <GraduationCap size={20} className="text-slate-600" /> Pending Class Mapping
             </h3>
             <span className="text-xs font-bold px-2 py-1 bg-slate-200 text-slate-700 rounded-lg">{pending.length} remaining</span>
          </div>
          
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
            {pending.map((student, idx) => (
              <button
                key={student.id ?? idx}
                onClick={() => handleOpenMapping(student)}
                className="w-full bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:border-brand/50 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[9999px] bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs">
                    {student.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-sm text-slate-800">{student.name}</span>
                </div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
            ))}
            {pending.length === 0 && (
              <div className="flex items-center justify-center h-24 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                <span className="text-sm font-semibold text-emerald-600 flex items-center gap-2"><Check size={18} /> All mapping resolved</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {modalStudent && (
        <MapModal
          student={modalStudent}
          existingClasses={existingClasses}
          onSave={handleMapped}
          onClose={() => setModalStudent(null)}
        />
      )}
    </div>
  );
}

// ─── Minimal Subcomponents ───────────────────────────────────────────────────

function MetricBlock({ label, value, color }) {
  return (
    <div>
      <div className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</div>
      <div className={cn("text-2xl lg:text-3xl font-black", color)}>{value ?? 0}%</div>
    </div>
  );
}

const KpiCard = ({ title, value, icon, trend, color }) => (
  <motion.div 
    whileHover={{ y: -4, scale: 1.01 }}
    transition={snappySpring}
    className="card p-6 flex flex-col justify-between rounded-2xl border-slate-200/60 shadow-sm"
    style={{ willChange: "transform, box-shadow" }}
  >
    <div className="flex items-start justify-between">
      <div className={cn("p-3 rounded-xl shadow-inner", color)}>
        {icon}
      </div>
    </div>
    <div className="mt-6">
      <div className="text-[2.5rem] font-bold tracking-tight text-slate-900 leading-none">{value}</div>
      <p className="text-slate-500 font-semibold mt-2">{title}</p>
    </div>
    <div className="mt-4 flex items-center gap-2">
      <span className="text-sm font-medium text-slate-400">{trend}</span>
    </div>
  </motion.div>
);

const EmptyState = ({ message, onMapClick }) => (
  <div className="flex flex-col items-center justify-center text-center">
    <div className="w-12 h-12 bg-slate-100 rounded-[9999px] flex items-center justify-center mb-3">
      <AlertTriangle className="text-slate-400" size={20} />
    </div>
    <p className="text-slate-500 text-sm max-w-[200px] mb-4 font-medium">{message}</p>
  </div>
);

function UsersIcon(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ─── Class Mapping Modal (Kept clean & isolated) ──────────────────────────────

const MapModal = ({ student, existingClasses, onSave, onClose }) => {
  const [jenjang, setJenjang] = useState("");
  const [className, setClassName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const jenjangOptions = ["Primary", "Secondary", "Kiddy", "Kindergarten"];

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const filtered = className.length > 0
    ? existingClasses.filter(c => c.toLowerCase().includes(className.toLowerCase()))
    : existingClasses;

  const handleSave = async () => {
    if (!jenjang) { setError("Educational level (Jenjang) is required."); return; }
    if (!className.trim()) { setError("Class name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await assignStudentClass({ student_id: student.id, class_name: className.trim(), jenjang: jenjang });
      onSave(student.id);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to save.");
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden"
        >
          <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Assign Class</p>
              <h3 className="font-bold text-lg">{student.name}</h3>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1"><X size={20} /></button>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Jenjang</label>
              <div className="grid grid-cols-2 gap-2">
                {jenjangOptions.map((opt) => (
                  <button key={opt} type="button" onClick={() => setJenjang(opt)} className={cn("py-2.5 px-4 rounded-xl text-sm font-semibold border-2 transition-all", jenjang === opt ? "bg-brand/10 border-brand text-brand" : "bg-white border-slate-100 text-slate-600 hover:bg-slate-50")}>{opt}</button>
                ))}
              </div>
            </div>

            <div className="relative">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Class Name</label>
              <input
                ref={inputRef}
                value={className}
                onChange={(e) => { setClassName(e.target.value); setShowSuggestions(true); setError(""); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. 7-Alpha"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 font-medium focus:ring-2 focus:ring-brand/30 outline-none"
              />
              {showSuggestions && filtered.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-40 overflow-auto">
                  {filtered.map(cls => <button key={cls} onMouseDown={() => { setClassName(cls); setShowSuggestions(false); }} className="w-full text-left px-4 py-2 hover:bg-brand/5 hover:text-brand text-sm">{cls}</button>)}
                </div>
              )}
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !className} className="flex-1 py-3 bg-brand text-white rounded-xl font-bold hover:bg-brand-hover flex items-center justify-center gap-2">{saving ? "Saving..." : "Save Mapping"}</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
