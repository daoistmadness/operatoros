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
import { motion } from "framer-motion";
import api from "../api";
import { cn } from "../lib/cn";
import { Button, buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { FieldError } from "../components/ui/field-error";
import { FieldLabel, FormField } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState as SharedEmptyState, ErrorState, LoadingState } from "../components/common/state-message";
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
  const [dashboardError, setDashboardError] = useState("");
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
    setDashboardError("");
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
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Dashboard analytics could not be loaded.");
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
    return <LoadingState className="min-h-[50vh]" title="Loading analytics" description="Preparing attendance and behavioral metrics." />;
  }
  if (dashboardError) {
    return <ErrorState className="min-h-[50vh]" title="Dashboard analytics could not be loaded" description={dashboardError}><Button className="mt-4" onClick={() => void loadDashboardData()}>Retry</Button></ErrorState>;
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
      
      <PageHeader title="System Analytics" description="Real-time attendance overview and behavioral metrics." />
      <FilterBar className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <FormField id="dashboard-month"><FieldLabel>Month</FieldLabel><NativeSelect value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>{MONTH_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</NativeSelect></FormField>
        <FormField id="dashboard-year"><FieldLabel>Year</FieldLabel><NativeSelect value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>{Array.from({ length: 3 }, (_, i) => String(today.getFullYear() - i)).map(y => <option key={y} value={y}>{y}</option>)}</NativeSelect></FormField>
        <FormField id="dashboard-level"><FieldLabel>Jenjang</FieldLabel><NativeSelect value={selectedJenjang} onChange={(e) => setSelectedJenjang(e.target.value)}><option value="All Jenjang">All Jenjang</option><option value="Primary">Primary</option><option value="Secondary">Secondary</option></NativeSelect></FormField>
        <Button><Download size={16} /> Export</Button>
      </FilterBar>

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
          <Button
            variant="outline"
            onClick={() => document.getElementById('pending-categorization')?.scrollIntoView({ behavior: 'smooth' })}
            className="whitespace-nowrap shrink-0 border-amber-300 text-amber-700"
          >
            Fix Mapping
          </Button>
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
          className="rounded-2xl border border-border bg-surface p-6 shadow-sm lg:col-span-3 flex flex-col justify-between group"
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
                  <MetricBlock label="Sakit" value={rekapAbsensiSummary.global_summary?.percentages?.sakit_pct} color="text-blue-500" />
                  <MetricBlock label="Izin" value={rekapAbsensiSummary.global_summary?.percentages?.izin_pct} color="text-amber-500" />
                  <MetricBlock label="Alfa" value={rekapAbsensiSummary.global_summary?.percentages?.alfa_pct} color="text-rose-500" />
                </div>
                
                <div className="grid grid-cols-2 gap-3" aria-label="Attendance percentage distribution">
                  <progress aria-label="Hadir percentage" max="100" value={rekapAbsensiSummary.global_summary?.percentages?.hadir_pct || 0} className="h-2 w-full accent-emerald-500" />
                  <progress aria-label="Sakit percentage" max="100" value={rekapAbsensiSummary.global_summary?.percentages?.sakit_pct || 0} className="h-2 w-full accent-blue-500" />
                  <progress aria-label="Izin percentage" max="100" value={rekapAbsensiSummary.global_summary?.percentages?.izin_pct || 0} className="h-2 w-full accent-amber-500" />
                  <progress aria-label="Alfa percentage" max="100" value={rekapAbsensiSummary.global_summary?.percentages?.alfa_pct || 0} className="h-2 w-full accent-rose-500" />
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
          className="rounded-2xl border border-slate-800 p-6 shadow-sm lg:col-span-2 flex flex-col justify-between bg-slate-900 text-white relative overflow-hidden"
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
                <p className="text-sm font-medium text-slate-300 mt-1">Classes Coverage</p>
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
            <Link to="/config/absence-reasons" className={cn(buttonVariants({variant:"primary"}), "w-full shadow-lg shadow-brand/20")}>
              Complete Review
            </Link>
          </div>
        </motion.div>
      </div>

      {/* 6. Analytics Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Monthly Trend Chart */}
        <Card className="p-6 md:p-8 flex flex-col">
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
        </Card>

        {/* Punctuality Leaderboard */}
        <Card className="p-6 md:p-8 flex flex-col">
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
        </Card>
      </div>

      {/* 7. Operational Insights (Bottom Section) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="pending-categorization">
        
        {/* Frequent Offenders List */}
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <UsersIcon size={20} className="text-rose-500" /> Top Frequent Offenders
          </h3>
          <DataTableContainer>
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Student</DataTableHead>
                  <DataTableHead>Class</DataTableHead>
                  <DataTableHead className="text-right">Lates</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {offenders.slice(0,5).map((p, idx) => (
                  <DataTableRow key={idx}>
                    <DataTableCell className="font-semibold text-slate-800">{p.name}</DataTableCell>
                    <DataTableCell className="text-slate-500">{p.class_name}</DataTableCell>
                    <DataTableCell className="text-right">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 h-6 rounded bg-rose-100 text-rose-700 font-bold text-xs">{p.late_count}</span>
                    </DataTableCell>
                  </DataTableRow>
                ))}
                {offenders.length === 0 && (
                  <DataTableRow><DataTableCell colSpan="3"><SharedEmptyState title="No late records found." /></DataTableCell></DataTableRow>
                )}
              </DataTableBody>
            </DataTable>
          </DataTableContainer>
        </Card>

        {/* Pending Mapping */}
        <Card className="p-6 bg-slate-50/50">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold flex items-center gap-2">
               <GraduationCap size={20} className="text-slate-600" /> Pending Class Mapping
             </h3>
             <span className="text-xs font-bold px-2 py-1 bg-slate-200 text-slate-700 rounded-lg">{pending.length} remaining</span>
          </div>
          
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
            {pending.map((student, idx) => (
              <Button
                variant="outline"
                key={student.id ?? idx}
                onClick={() => handleOpenMapping(student)}
                className="h-auto w-full justify-between rounded-xl p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[9999px] bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs">
                    {student.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-sm text-slate-800">{student.name}</span>
                </div>
                <ChevronRight size={16} className="text-slate-300" />
              </Button>
            ))}
            {pending.length === 0 && (
              <div className="flex items-center justify-center h-24 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                <span className="text-sm font-semibold text-emerald-600 flex items-center gap-2"><Check size={18} /> All mapping resolved</span>
              </div>
            )}
          </div>
        </Card>

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
    className="rounded-2xl border border-border bg-surface p-6 flex flex-col justify-between shadow-sm"
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
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="overflow-visible p-0">
        <DialogHeader className="rounded-t-xl bg-slate-900 px-6 py-5 text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Assign Class</p>
          <DialogTitle>{student.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 p-6">
          <FormField id="mapping-level" required invalid={Boolean(error && !jenjang)}>
            <FieldLabel>Jenjang</FieldLabel>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Jenjang">
              {jenjangOptions.map((opt) => <Button key={opt} type="button" variant={jenjang === opt ? "primary" : "outline"} onClick={() => { setJenjang(opt); setError(""); }}>{opt}</Button>)}
            </div>
          </FormField>
          <FormField id="mapping-class" required invalid={Boolean(error && !className.trim())} className="relative">
            <FieldLabel>Class Name</FieldLabel>
            <Input ref={inputRef} value={className} onChange={(e) => { setClassName(e.target.value); setShowSuggestions(true); setError(""); }} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 150)} placeholder="e.g. 7-Alpha" />
            {showSuggestions && filtered.length > 0 && <div className="absolute z-10 top-full mt-1 max-h-40 w-full overflow-auto rounded-xl border border-border bg-surface shadow-lg">{filtered.map(cls => <Button key={cls} variant="ghost" onMouseDown={() => { setClassName(cls); setShowSuggestions(false); }} className="w-full justify-start rounded-none">{cls}</Button>)}</div>}
            <FieldError>{error}</FieldError>
          </FormField>
        </div>
        <DialogFooter className="px-6 pb-6"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={handleSave} disabled={saving || !className}>{saving ? <><Loader2 className="size-4 animate-spin"/>Saving...</> : "Save Mapping"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
