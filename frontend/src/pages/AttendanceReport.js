import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar,
  Download,
  Filter,
  Users,
  GraduationCap,
  Clock,
  TrendingUp,
  Fingerprint,
  BookOpen,
} from "lucide-react";

import api from "../api";
import { cn } from "../lib/cn";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { FormField, FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState } from "../components/common/state-message";

const JENJANG_OPTIONS = ["Primary", "Secondary", "Kiddy", "Kindergarten"];

const PERIOD_TYPES = [
  { id: "monthly", label: "Monthly (1 Month)" },
  { id: "bimonthly", label: "Bi-Monthly (2 Months)" },
  { id: "term", label: "Term (3 Months)" },
  { id: "semester", label: "Semester (6 Months)" },
  { id: "yearly", label: "Yearly (12 Months)" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

// Generate period options based on type
const getPeriodOptions = (type) => {
  switch (type) {
    case "monthly":
      return MONTHS.map((m, i) => ({ value: i, label: m }));
    case "bimonthly":
      return [
        { value: 0, label: "Jan - Feb" },
        { value: 2, label: "Mar - Apr" },
        { value: 4, label: "May - Jun" },
        { value: 6, label: "Jul - Aug" },
        { value: 8, label: "Sep - Oct" },
        { value: 10, label: "Nov - Dec" },
      ];
    case "term":
      return [
        { value: 0, label: "Term 1 (Jul - Sep)" },
        { value: 3, label: "Term 2 (Oct - Dec)" },
        { value: 6, label: "Term 3 (Jan - Mar)" },
        { value: 9, label: "Term 4 (Apr - Jun)" },
      ];
    case "semester":
      return [
        { value: 0, label: "Semester 1 (Jul - Dec)" },
        { value: 6, label: "Semester 2 (Jan - Jun)" },
      ];
    case "yearly":
      return [{ value: 0, label: "Full Year" }];
    default:
      return [];
  }
};

const getDateRange = (type, periodValue, year) => {
  let startMonth = parseInt(periodValue, 10);
  let endMonth = startMonth;
  let startYear = year;
  let endYear = year;

  if (type === "monthly") {
    endMonth = startMonth;
  } else if (type === "bimonthly") {
    endMonth = startMonth + 1;
  } else if (type === "term") {
    // School terms logic: Jul-Sep -> Term 1 (Start in past year maybe, let's just stick to explicit offsets relative to selected year)
    // Actually, simple standard logic: 0 = Jul, 3 = Oct, 6 = Jan, 9 = Apr
    // Wait, let's keep it simple relative to the selected 'Academic Year'
    if (startMonth === 0) { startMonth = 6; endMonth = 8; } // Jul-Sep
    else if (startMonth === 3) { startMonth = 9; endMonth = 11; } // Oct-Dec
    else if (startMonth === 6) { startMonth = 0; endMonth = 2; startYear++; endYear++; } // Jan-Mar (next year)
    else if (startMonth === 9) { startMonth = 3; endMonth = 5; startYear++; endYear++; } // Apr-Jun (next year)
  } else if (type === "semester") {
    if (startMonth === 0) { startMonth = 6; endMonth = 11; } // Jul-Dec
    else if (startMonth === 6) { startMonth = 0; endMonth = 5; startYear++; endYear++; } // Jan-Jun
  } else if (type === "yearly") {
    startMonth = 6; // Jul
    endMonth = 5; // Jun
    endYear++;
  }

  // First day of startMonth
  const startDate = new Date(startYear, startMonth, 1);
  // Last day of endMonth
  const endDate = new Date(endYear, endMonth + 1, 0);

  const format = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return { start_date: format(startDate), end_date: format(endDate) };
};

const StatCard = ({ title, value, subtext, icon, color }) => (
  <Card className="rounded-2xl p-6 flex flex-col justify-between hover:-translate-y-1 transition-transform">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
        <p className="text-3xl font-bold text-slate-900">{value}</p>
      </div>
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg", color)}>
        {icon}
      </div>
    </div>
    {subtext && <p className="text-sm font-medium text-slate-400 mt-4">{subtext}</p>}
  </Card>
);

function AttendanceReport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [classes, setClasses] = useState([]);
  const [reportData, setReportData] = useState([]);
  const [summaryMetadata, setSummaryMetadata] = useState({});


  // Filters state
  const [periodType, setPeriodType] = useState("monthly");
  const [selectedPeriod, setSelectedPeriod] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [jenjangFilter, setJenjangFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");

  const fetchClasses = useCallback(async () => {
    try {
      const response = await api.get("/api/students/classes");
      setClasses(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const generateReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { start_date, end_date } = getDateRange(periodType, selectedPeriod, selectedYear);
      const params = { start_date, end_date };
      
      if (jenjangFilter !== "all") params.jenjang = jenjangFilter;
      if (classFilter !== "all") params.class_name = classFilter;

      const response = await api.get("/api/analytics/attendance-report", { params });
      setReportData(response.data.results || []);
      setSummaryMetadata(response.data.summary || {});

    } catch (err) {
      setError(err.response?.data?.detail || "Failed to generate report.");
    } finally {
      setLoading(false);
    }
  }, [periodType, selectedPeriod, selectedYear, jenjangFilter, classFilter]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  // Handle changing period type
  useEffect(() => {
    const opts = getPeriodOptions(periodType);
    if (opts.length > 0) {
      // Re-initialize valid selection when type changes
      const valid = opts.some(o => o.value == selectedPeriod) ? selectedPeriod : opts[0].value;
      setSelectedPeriod(valid);
    }
  }, [periodType]);

  const summary = useMemo(() => {
    let sum = 0;
    let perfect = 0;
    let highAbsence = 0;
    let totalIncomplete = 0;
    reportData.forEach(r => {
      sum += r.attendance_percentage;
      if (r.attendance_percentage === 100) perfect++;
      if (r.absent_count >= 3) highAbsence++;
      totalIncomplete += r.incomplete_count;
    });
    return {
      avg: (sum / reportData.length).toFixed(1),
      perfect,
      highAbsence,
      totalIncomplete
    };

  }, [reportData]);

  const exportCSV = () => {
    if (!reportData.length) return;
    const headers = [
      "No. ID", "Name", "Jenjang", "Class", "HEB", "Present", "Late", "Absent", "Incomplete", "Sakit", "Izin", "Alfa", "Total Days", "Attendance %"
    ];
    const rows = reportData.map(r => [
      r.student_id,
      r.name,
      r.jenjang || "N/A",
      r.class_name || "N/A",
      summaryMetadata.heb_days || "—",
      r.present_count,
      r.late_count,
      r.absent_count,
      r.incomplete_count,
      r.sakit ?? 0,
      r.izin ?? 0,
      r.alfa ?? 0,
      r.total_days,
      r.attendance_percentage
    ]);

    let csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_report_${periodType}_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const periodOptions = getPeriodOptions(periodType);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <PageHeader
        title="Attendance Reports"
        description="Generate flexible reports by timeframe, level, and class."
        actions={<Button variant="outline" onClick={exportCSV} disabled={reportData.length === 0}>
          <Download size={18} />
          Export CSV
        </Button>}
      />

      {/* Filter Panel */}
      <FilterBar className="p-6">
        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
          <Filter size={18} className="text-brand" />
          <h2 className="font-bold text-slate-800">Report Parameters</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          <FormField id="attendance-period-type">
            <FieldLabel>Period Type</FieldLabel>
            <NativeSelect
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value)}
            >
              {PERIOD_TYPES.map(pt => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
            </NativeSelect>
          </FormField>

          <FormField id="attendance-period">
            <FieldLabel>Select Period</FieldLabel>
            <NativeSelect
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(Number(e.target.value))}
            >
              {periodOptions.map(po => <option key={po.value} value={po.value}>{po.label}</option>)}
            </NativeSelect>
          </FormField>

          <FormField id="attendance-year">
            <FieldLabel>Year</FieldLabel>
            <NativeSelect
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {YEARS.map(y => <option key={y} value={y}>{y}/{y+1}</option>)}
            </NativeSelect>
          </FormField>

          <FormField id="attendance-jenjang">
            <FieldLabel>Jenjang</FieldLabel>
            <NativeSelect
              value={jenjangFilter}
              onChange={(e) => setJenjangFilter(e.target.value)}
            >
              <option value="all">All Jenjang</option>
              {JENJANG_OPTIONS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id="attendance-class">
            <FieldLabel>Class</FieldLabel>
            <NativeSelect
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value="all">All Classes</option>
              <option value="unassigned">Unassigned</option>
              {classes.map((className) => (
                <option key={className} value={className}>{className}</option>
              ))}
            </NativeSelect>
          </FormField>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-100 flex justify-end">
          <Button
            onClick={generateReport}
            disabled={loading}
            size="lg"
          >
            {loading ? "Generating..." : "Generate Report"}
            <Calendar size={18} />
          </Button>
        </div>
      </FilterBar>

      {error && (
        <ErrorState title="Attendance report could not be generated" description={error} />
      )}

      {reportData.length > 0 && (
        <>
          {/* Summary Stat Cards */}
           <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">

            <StatCard 
              title="Total HEB" 
              value={`${summaryMetadata.heb_days || "—"}`}
              icon={<BookOpen size={24} className="text-white" />}
              color="bg-slate-800 shadow-slate-800/30"
              subtext="Hari Efektif Belajar"
            />
            <StatCard 
              title="Average Attendance" 
              value={`${summary.avg}%`}
              icon={<TrendingUp size={24} className="text-white" />}
              color="bg-emerald-500 shadow-emerald-500/30"
              subtext="For selected group"
            />
            <StatCard 
              title="Incomplete Records" 
              value={`${summary.totalIncomplete}`}
              icon={<Fingerprint size={24} className="text-white" />}
              color="bg-amber-500 shadow-amber-500/30"
              subtext="Needs scan correction"
            />
            <StatCard 
              title="Perfect Attendance" 
              value={`${summary.perfect}`}
              icon={<GraduationCap size={24} className="text-white" />}
              color="bg-brand shadow-brand/30"
              subtext="Students with 100% rate"
            />
             <StatCard 
              title="High Absence Risk" 
              value={`${summary.highAbsence}`}
              icon={<Clock size={24} className="text-white" />}
              color="bg-rose-500 shadow-rose-500/30"
              subtext="Students with 3+ absences"
            />
            <StatCard 
              title="Avg Late Time" 
              value={summaryMetadata.avg_late_time_str || "—"}
              icon={<Clock size={24} className="text-white" />}
              color="bg-brand-hover shadow-brand/30"
              subtext="Per late instance"
            />
          </div>



          {/* Data Table */}
          <Card className="rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Report Results</h3>
              <span className="text-xs font-semibold text-slate-500 px-3 py-1 bg-slate-200 rounded-[9999px]">
                {reportData.length} records
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white border-b border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                    <th className="px-6 py-4">Student Name</th>
                    <th className="px-6 py-4">Jenjang</th>
                    <th className="px-6 py-4">Class</th>
                    <th className="px-6 py-4 text-center">Present</th>
                    <th className="px-6 py-4 text-center">Late (Count)</th>
                    <th className="px-6 py-4 text-center">Late (Time)</th>
                    <th className="px-6 py-4 text-center">Absent</th>

                    <th className="px-6 py-4 text-center">Incomplete</th>
                    <th className="px-6 py-4 text-center">Sakit</th>
                    <th className="px-6 py-4 text-center">Izin</th>
                    <th className="px-6 py-4 text-center">Alfa</th>
                    <th className="px-6 py-4 text-center text-brand">Att. Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {reportData.map((row) => (
                    <tr key={row.student_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-slate-900">{row.name}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{row.jenjang || "—"}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{row.class_name || "—"}</td>
                      <td className="px-6 py-4 text-center font-medium text-emerald-600 bg-emerald-50/50">{row.present_count}</td>
                      <td className="px-6 py-4 text-center font-medium text-amber-600 bg-amber-50/50">{row.late_count}</td>
                      <td className="px-6 py-4 text-center font-medium text-amber-700 bg-amber-100/30">{row.total_late_time_str}</td>
                      <td className="px-6 py-4 text-center font-bold text-rose-600 bg-rose-50/50">{row.absent_count}</td>

                      <td className={cn(
                        "px-6 py-4 text-center font-medium transition-colors",
                        row.incomplete_count > 0 ? "text-amber-600 bg-amber-50 font-bold" : "text-slate-500 bg-slate-50/50"
                      )}>
                        {row.incomplete_count > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{row.incomplete_count}</span>
                            <span className="text-[10px] uppercase tracking-tighter opacity-70">Needs Scan</span>
                          </div>
                        ) : (
                          row.incomplete_count
                        )}
                      </td>

                      <td className="px-6 py-4 text-center font-medium text-slate-700 bg-slate-50/50">{row.sakit ?? 0}</td>
                      <td className="px-6 py-4 text-center font-medium text-slate-700 bg-slate-50/50">{row.izin ?? 0}</td>
                      <td className="px-6 py-4 text-center font-medium text-slate-700 bg-slate-50/50">{row.alfa ?? 0}</td>

                      <td className="px-6 py-4 text-center font-bold">
                        <span className={cn(
                          "inline-flex items-center justify-center px-3 py-1 rounded-[9999px] text-sm",
                          row.attendance_percentage >= 95 ? "bg-emerald-100 text-emerald-700" :
                          row.attendance_percentage >= 80 ? "bg-amber-100 text-amber-700" :
                          "bg-rose-100 text-rose-700"
                        )}>
                          {row.attendance_percentage}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {!loading && reportData.length === 0 && !error && (
        <EmptyState title="No report data" description="Select your parameters and generate the report to see attendance data." />
      )}
    </div>
  );
}

export default AttendanceReport;
