import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip,
} from "chart.js";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock3, Download, GraduationCap,
  Loader2, RefreshCw, ShieldAlert, Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  downloadReportBlob, ExecutiveReport, exportAnnualReport, exportMonthlyReport,
  ReportFiltersResponse, ReportQuery, ReportScope, ReportType,
} from "../api/reports";
import { useExecutiveReport, useReportFilters } from "../hooks/useReportQueries";
import { Button } from "../components/ui/button";
import { FieldLabel, FormField } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

const unavailable = "Not Available";
export const DEFAULT_REPORT_TYPE: ReportType = "monthly";
export const DEFAULT_REPORT_SCOPE: ReportScope = "combined";
export const displayValue = (value: number | null, suffix = "") => value === null ? unavailable : `${value}${suffix}`;
export const staleReport = () => null;
export const selectFilterDefaults = (filters: ReportFiltersResponse) => ({
  academicYearId: filters.default_academic_year_id || filters.academic_years[0]?.id || null,
  month: filters.months[0]?.value || "",
});

const cardClass = "rounded-3xl border border-slate-100 bg-white p-5 shadow-sm";

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof Users; tone: string }) {
  return <div className={`${cardClass} flex items-center gap-4`}>
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></div>
    <div><p className="text-xs font-bold text-slate-400">{label}</p><p className="mt-1 text-2xl font-black text-slate-800">{value}</p></div>
  </div>;
}

export function ExecutiveSummaryCards({ report }: { report: ExecutiveReport }) {
  const row = report.executive_summary;
  return <section aria-labelledby="executive-summary-title">
    <h2 id="executive-summary-title" className="mb-4 text-lg font-black text-slate-800">Executive Summary</h2>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="Total Students" value={row.total_students} icon={Users} tone="bg-indigo-50 text-indigo-600" />
      <MetricCard label="Attendance Rate" value={displayValue(row.attendance_rate, "%")} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />
      <MetricCard label="Late Rate" value={displayValue(row.late_rate, "%")} icon={Clock3} tone="bg-orange-50 text-orange-600" />
      <MetricCard label="Late Minutes" value={row.late_minutes} icon={Clock3} tone="bg-orange-50 text-orange-600" />
      <MetricCard label="Below-KKM Count" value={row.below_kkm_count} icon={GraduationCap} tone="bg-rose-50 text-rose-600" />
      <MetricCard label="Data Completeness" value={displayValue(row.data_completeness_rate, "%")} icon={ShieldAlert} tone="bg-slate-100 text-slate-600" />
    </div>
  </section>;
}

export function AttendanceSection({ report }: { report: ExecutiveReport }) {
  const a = report.attendance_summary;
  const chartData = {
    labels: report.attendance_by_level.map((row) => row.level),
    datasets: [
      { label: "Present", data: report.attendance_by_level.map((row) => row.present), backgroundColor: "#10b981" },
      { label: "Sakit", data: report.attendance_by_level.map((row) => row.sakit), backgroundColor: "#3b82f6" },
      { label: "Izin", data: report.attendance_by_level.map((row) => row.izin), backgroundColor: "#f59e0b" },
      { label: "Alfa", data: report.attendance_by_level.map((row) => row.alfa), backgroundColor: "#f43f5e" },
    ],
  };
  return <section className={cardClass} aria-labelledby="attendance-title">
    <h2 id="attendance-title" className="text-lg font-black text-slate-800">Attendance</h2>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {[["Present", a.present, "text-emerald-600"], ["Sakit", a.sakit, "text-blue-600"], ["Izin", a.izin, "text-amber-600"], ["Alfa", a.alfa, "text-rose-600"], ["Incomplete", a.incomplete, "text-slate-600"], ["Late Days", a.late_days, "text-orange-600"], ["Late Minutes", a.late_minutes, "text-orange-600"], ["Attendance Rate", displayValue(a.attendance_rate, "%"), "text-emerald-600"], ["Late Rate", displayValue(a.late_rate, "%"), "text-orange-600"]].map(([label, value, color]) =>
        <div key={String(label)} className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-xl font-black ${color}`}>{value}</p></div>)}
    </div>
    {report.attendance_by_level.length ? <>
      <div className="mt-6 h-64" aria-label="Attendance by Level chart"><Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false }} /></div>
      <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400"><th className="p-3">Level</th><th className="p-3">Present</th><th className="p-3">Sakit</th><th className="p-3">Izin</th><th className="p-3">Alfa</th><th className="p-3">Incomplete</th><th className="p-3">Attendance</th><th className="p-3">Late Rate</th></tr></thead><tbody>{report.attendance_by_level.map((row) => <tr key={row.level} className="border-b border-slate-100"><td className="p-3 font-bold text-slate-700">{row.level}</td><td className="p-3 text-emerald-600">{row.present}</td><td className="p-3 text-blue-600">{row.sakit}</td><td className="p-3 text-amber-600">{row.izin}</td><td className="p-3 text-rose-600">{row.alfa}</td><td className="p-3 text-slate-600">{row.incomplete}</td><td className="p-3">{displayValue(row.attendance_rate, "%")}</td><td className="p-3">{displayValue(row.late_rate, "%")}</td></tr>)}</tbody></table></div>
    </> : <p className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No attendance-by-level data is available.</p>}
  </section>;
}

function DistributionTable({ title, rows }: { title: string; rows: Array<{ name: string; count: number; percentage: number | null }> }) {
  return <div><h3 className="text-sm font-black text-slate-700">{title}</h3>{rows.length ? <div className="mt-2 overflow-x-auto"><table className="min-w-full text-sm"><tbody>{rows.map((row) => <tr key={row.name} className="border-b border-slate-100"><td className="py-2 font-semibold text-slate-600">{row.name}</td><td className="py-2 text-right font-black text-slate-800">{row.count}</td><td className="py-2 text-right text-slate-500">{displayValue(row.percentage, "%")}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-400">Not available</p>}</div>;
}

export function StudentDistributionSection({ report }: { report: ExecutiveReport }) {
  const d = report.student_distribution;
  return <section className={cardClass}><h2 className="text-lg font-black text-slate-800">Student Distribution</h2><div className="mt-4 grid gap-6 lg:grid-cols-2"><DistributionTable title="By Level" rows={d.by_level} /><DistributionTable title="By Class" rows={d.by_class} /></div>
    {!d.by_gender.length && !d.by_religion.length && !d.by_domicile.length && <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">Gender, religion, and domicile distributions are unavailable in the current student data.</div>}
  </section>;
}

export function AcademicSection({ report }: { report: ExecutiveReport }) {
  const a = report.academic_summary;
  return <section className={cardClass}><h2 className="text-lg font-black text-slate-800">Academic Summary</h2>{!a.availability ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{a.reason || unavailable}</div> : <>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-bold text-indigo-500">Sumatif Average</p><p className="text-2xl font-black text-indigo-800">{displayValue(a.sumatif_average)}</p></div><div className="rounded-2xl bg-blue-50 p-4"><p className="text-xs font-bold text-blue-500">Formatif Average</p><p className="text-2xl font-black text-blue-800">{displayValue(a.formatif_average)}</p></div><div className="rounded-2xl bg-rose-50 p-4"><p className="text-xs font-bold text-rose-500">Below KKM</p><p className="text-2xl font-black text-rose-800">{a.below_kkm_count}</p></div></div>
    <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-400"><th className="p-3">Subject</th><th className="p-3">Level</th><th className="p-3">Sumatif</th><th className="p-3">Formatif</th><th className="p-3">Below KKM</th></tr></thead><tbody>{a.by_subject.map((row) => <tr key={`${row.subject_id}-${row.jenjang}`} className="border-b border-slate-100"><td className="p-3 font-bold">{row.subject_name}</td><td className="p-3">{row.jenjang}</td><td className="p-3">{displayValue(row.sumatif_average)}</td><td className="p-3">{displayValue(row.formatif_average)}</td><td className="p-3 text-rose-600">{row.below_kkm_count}</td></tr>)}</tbody></table></div>
  </>}</section>;
}

export function AnnualTrendsSection({ report }: { report: ExecutiveReport }) {
  const chartData = { labels: report.trends.map((row) => row.label), datasets: [{ label: "Attendance Rate", data: report.trends.map((row) => row.attendance_rate), borderColor: "#10b981", backgroundColor: "#10b981", spanGaps: false }, { label: "Late Minutes", data: report.trends.map((row) => row.late_minutes), borderColor: "#f97316", backgroundColor: "#f97316" }] };
  const comparisons = report.comparisons || {};
  const comparisonRows = [["Highest Attendance Month", "highest_attendance_month"], ["Lowest Attendance Month", "lowest_attendance_month"], ["Highest Attendance Level", "highest_attendance_level"], ["Lowest Attendance Level", "lowest_attendance_level"]] as const;
  return <section className={cardClass}><h2 className="text-lg font-black text-slate-800">Annual Trends</h2><div className="mt-5 h-72" aria-label="Annual attendance trends chart"><Line data={chartData} options={{ responsive: true, maintainAspectRatio: false }} /></div>
    <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-400"><th className="p-3">Month</th><th className="p-3">Present</th><th className="p-3">Denominator</th><th className="p-3">Attendance</th><th className="p-3">Late Days</th><th className="p-3">Late Minutes</th><th className="p-3">Sumatif</th><th className="p-3">Formatif</th></tr></thead><tbody>{report.trends.map((row) => <tr key={row.month} className="border-b border-slate-100"><td className="p-3 font-bold">{row.label}</td><td className="p-3">{row.present}</td><td className="p-3">{row.attendance_denominator}</td><td className="p-3">{displayValue(row.attendance_rate, "%")}</td><td className="p-3">{row.late_days}</td><td className="p-3">{row.late_minutes}</td><td className="p-3">{displayValue(row.sumatif_average)}</td><td className="p-3">{displayValue(row.formatif_average)}</td></tr>)}</tbody></table></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{comparisonRows.map(([label, key]) => { const row = comparisons[key]; return <div key={key} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">{label}</p><p className="mt-1 font-black text-slate-800">{row?.name || unavailable}</p>{row && <p className="text-sm text-slate-500">{row.attendance_rate}%</p>}</div>; })}</div>
  </section>;
}

export function DataQualityPanel({ report }: { report: ExecutiveReport }) {
  const q = report.data_quality;
  return <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="flex items-center gap-2 text-lg font-black text-amber-950"><AlertTriangle className="h-5 w-5" />Data Quality</h2><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-amber-900"><span className="rounded-full bg-white/70 px-3 py-1.5">Incomplete: {q.incomplete_attendance}</span><span className="rounded-full bg-white/70 px-3 py-1.5">Empty grades: {q.empty_grade_cells}</span>{q.unmapped_levels.length > 0 && <span className="rounded-full bg-white/70 px-3 py-1.5">Unmapped: {q.unmapped_levels.join(", ")}</span>}</div><ul className="mt-4 space-y-2 text-sm font-semibold text-amber-900">{q.warnings.map((warning) => <li key={warning} className="flex gap-2"><span aria-hidden="true">•</span><span>{warning}</span></li>)}</ul></section>;
}

export function ReportFeedback({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <LoadingState title="Loading report" description="Calculating the selected attendance and academic context." />;
  if (error) return <ErrorState title="The report could not be generated" description={error} />;
  return <EmptyState title="Generate an executive report" description="Choose the report context, then select Generate Report." />;
}

export default function ExecutiveReports({ reportType }: { reportType: ReportType }) {
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [scope, setScope] = useState<ReportScope>(DEFAULT_REPORT_SCOPE);
  const [className, setClassName] = useState("");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [generatedQuery, setGeneratedQuery] = useState<ReportQuery | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtersQuery = useReportFilters(academicYearId, scope);
  const filters = filtersQuery.data ?? null;
  const reportQuery = useExecutiveReport(reportType, generatedQuery);
  const report = reportQuery.data ?? null;
  const loadingFilters = filtersQuery.isLoading;
  const loadingReport = reportQuery.isFetching;

  const clearStale = useCallback(() => { setGeneratedQuery(null); setError(null); }, []);
  useEffect(() => {
    if (!filters) return;
    const defaults = selectFilterDefaults(filters);
    if (academicYearId === null && defaults.academicYearId !== null) setAcademicYearId(defaults.academicYearId);
    setMonth((current) => filters.months.some((item) => item.value === current) ? current : defaults.month);
  }, [academicYearId, filters]);
  useEffect(() => { clearStale(); }, [reportType, clearStale]);

  const updateYear = (value: number) => { clearStale(); setAcademicYearId(value); };
  const updateScope = (value: ReportScope) => { clearStale(); setScope(value); setClassName(""); setSubjectId(null); };
  const query = useMemo<ReportQuery | null>(() => academicYearId && (reportType === "annual" || month) ? { academic_year_id: academicYearId, scope, month: reportType === "monthly" ? month : undefined, class_name: className || null, subject_id: subjectId } : null, [academicYearId, className, month, reportType, scope, subjectId]);

  const generate = async () => {
    if (!query) return;
    setError(null); setGeneratedQuery(query);
  };
  const runExport = async (format: "pdf" | "xlsx") => {
    if (!generatedQuery) return;
    setExporting(format); setError(null);
    try { const file = reportType === "monthly" ? await exportMonthlyReport(format, generatedQuery) : await exportAnnualReport(format, generatedQuery); downloadReportBlob(file.blob, file.filename); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The export could not be downloaded."); }
    finally { setExporting(null); }
  };

  return <div className="space-y-7 pb-12">
    <PageHeader title="Executive Reports" description="Monthly and annual leadership reporting from one verified calculation source." actions={<><Button aria-label="Export PDF" variant="secondary" disabled={!generatedQuery || loadingReport || exporting !== null} onClick={() => void runExport("pdf")}><Download className="h-4 w-4" />{exporting === "pdf" ? "Exporting..." : "Export PDF"}</Button><Button aria-label="Export Excel" variant="outline" disabled={!generatedQuery || loadingReport || exporting !== null} onClick={() => void runExport("xlsx")}><Download className="h-4 w-4" />{exporting === "xlsx" ? "Exporting..." : "Export Excel"}</Button></>}/>
    <div className="flex rounded-2xl border border-slate-200 bg-white p-1.5" role="tablist" aria-label="Report type"><Link role="tab" aria-selected={reportType === "monthly"} to="/reports/monthly" className={`flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-black ${reportType === "monthly" ? "bg-brand text-white" : "text-slate-500"}`}>Monthly</Link><Link role="tab" aria-selected={reportType === "annual"} to="/reports/annual" className={`flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-black ${reportType === "annual" ? "bg-brand text-white" : "text-slate-500"}`}>Annual</Link></div>
    <FilterBar className="space-y-4"><div className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-400"><CalendarDays className="h-4 w-4" />Report Filters</div>{loadingFilters ? <LoadingState title="Loading report filters" /> : <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><FormField id="report-academic-year"><FieldLabel>Academic Year</FieldLabel><NativeSelect value={academicYearId || ""} onChange={(e) => void updateYear(Number(e.target.value))}>{filters?.academic_years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_default ? " (Default)" : ""}</option>)}</NativeSelect></FormField>{reportType === "monthly" && <FormField id="report-month"><FieldLabel>Month</FieldLabel><NativeSelect value={month} onChange={(e) => { clearStale(); setMonth(e.target.value); }}>{filters?.months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></FormField>}<FormField id="report-scope"><FieldLabel>Scope</FieldLabel><NativeSelect value={scope} onChange={(e) => void updateScope(e.target.value as ReportScope)}>{filters?.scopes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></FormField><FormField id="report-class"><FieldLabel>Class</FieldLabel><NativeSelect value={className} onChange={(e) => { clearStale(); setClassName(e.target.value); }}><option value="">All Classes</option>{filters?.classes.map((item) => <option key={item}>{item}</option>)}</NativeSelect></FormField><FormField id="report-subject"><FieldLabel>Subject</FieldLabel><NativeSelect value={subjectId || ""} onChange={(e) => { clearStale(); setSubjectId(Number(e.target.value) || null); }}><option value="">All Subjects</option>{filters?.subjects.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.jenjang_name}</option>)}</NativeSelect></FormField></div><Button onClick={() => void generate()} disabled={!query || loadingReport}>{loadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Generate Report</Button></>}</FilterBar>
    {report ? <div className="space-y-7"><ExecutiveSummaryCards report={report} /><AttendanceSection report={report} /><div className="grid gap-7 xl:grid-cols-2"><StudentDistributionSection report={report} /><AcademicSection report={report} /></div>{reportType === "annual" && <AnnualTrendsSection report={report} />}<DataQualityPanel report={report} /></div> : <ReportFeedback loading={loadingReport} error={error || (filtersQuery.error instanceof Error ? filtersQuery.error.message : reportQuery.error instanceof Error ? `The report could not be generated. Please review the selected filters and try again. ${reportQuery.error.message}` : null)} />}
  </div>;
}
