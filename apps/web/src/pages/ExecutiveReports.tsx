import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExecutiveReport, ReportFiltersResponse, ReportQuery, ReportScope } from "../api/reports";
import { downloadReportBlob, exportAnnualReport } from "../api/reports";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel, FormField } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { useAnnualReport, useReportFilters } from "../hooks/useReportQueries";
import { normalizeReportQuery, selectReportFilterDefaults } from "../lib/defaultReportMonth";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);
const unavailable = "—";
const display = (value: number | null | undefined, suffix = "") => value == null ? unavailable : `${value}${suffix}`;

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</CardContent></Card>;
}

function AnnualAttendance({ report }: { report: ExecutiveReport }) {
  const value = report.attendance_summary;
  return <Card><CardHeader><CardTitle>Academic-Year Attendance</CardTitle><p className="text-sm text-muted-foreground">{report.report_period.sections.attendance.label}. Attendance Rate and Coverage summarize OBSERVED class-months only.</p></CardHeader><CardContent className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Attendance Rate" value={display(value.attendance_rate, "%")} note="OBSERVED class-months" />
      <Metric label="Coverage" value={display(value.coverage_rate, "%")} note="OBSERVED class-months" />
      <Metric label="Unrecorded" value={value.unrecorded_student_days} note="OBSERVED Student-Days" />
      <Metric label="Late Event Rate" value={display(value.late_event_rate, "%")} note={`${value.lateness_availability.toLowerCase()} · ${display(value.lateness_coverage_rate, "%")} coverage`} />
      <Metric label="Late Among Present" value={display(value.late_among_present, "%")} note="Shown only when lateness is fully available" />
    </div>
    <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-3">Jenjang</th><th className="p-3">Observed Class-Months</th><th className="p-3">Declared</th><th className="p-3">Not Reported</th><th className="p-3">Expected Student-Days</th><th className="p-3">Hadir</th><th className="p-3">Unrecorded</th><th className="p-3">Attendance Rate</th><th className="p-3">Coverage</th><th className="p-3">Conflicts</th></tr></thead><tbody>{report.attendance_by_level.map((row) => <tr className="border-b" key={row.level}><th className="p-3 text-left">{row.level}</th><td className="p-3">{row.observed_class_months}</td><td className="p-3">{row.declared_class_months}</td><td className="p-3">{row.not_reported_class_months}</td><td className="p-3">{row.attendance_denominator}</td><td className="p-3">{row.present}</td><td className="p-3">{row.unrecorded_student_days}</td><td className="p-3">{display(row.attendance_rate, "%")}</td><td className="p-3">{display(row.coverage_rate, "%")}</td><td className="p-3">{row.conflict_count}</td></tr>)}</tbody></table></div>
  </CardContent></Card>;
}

function AnnualTrends({ report }: { report: ExecutiveReport }) {
  const chart = { labels: report.trends.map((row) => row.label), datasets: [{ label: "Attendance Rate · OBSERVED class-months", data: report.trends.map((row) => row.attendance_rate), borderColor: "#10b981", backgroundColor: "#10b981", spanGaps: false }] };
  return <Card><CardHeader><CardTitle>Annual Trends</CardTitle><p className="text-sm text-muted-foreground">The chart shows observed attendance patterns. The table keeps basis, coverage, and reporting gaps visible.</p></CardHeader><CardContent>
    <div className="mb-5 h-72" aria-label="Annual observed attendance rate chart"><Line data={chart} options={{ responsive: true, maintainAspectRatio: false }} /></div>
    <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-3">Month</th><th className="p-3">Observed</th><th className="p-3">Declared</th><th className="p-3">Not Reported</th><th className="p-3">Expected</th><th className="p-3">Hadir</th><th className="p-3">Unrecorded</th><th className="p-3">Attendance Rate</th><th className="p-3">Coverage</th><th className="p-3">Lateness</th><th className="p-3">Late Events</th><th className="p-3">Late Event Rate</th></tr></thead><tbody>{report.trends.map((row) => <tr className="border-b" key={row.month}><th className="p-3 text-left">{row.label}</th><td className="p-3">{row.basis_counts.observed}</td><td className="p-3">{row.basis_counts.declared}</td><td className="p-3">{row.basis_counts.not_reported}</td><td className="p-3">{row.attendance_denominator}</td><td className="p-3">{row.present}</td><td className="p-3">{row.unrecorded_student_days}</td><td className="p-3">{display(row.attendance_rate, "%")}</td><td className="p-3">{display(row.coverage_rate, "%")}</td><td className="p-3">{row.lateness_availability.toLowerCase()} · {display(row.lateness_coverage_rate, "%")}</td><td className="p-3">{display(row.late_days)}</td><td className="p-3">{display(row.late_event_rate, "%")}</td></tr>)}</tbody></table></div>
  </CardContent></Card>;
}

function AcademicSnapshot({ report }: { report: ExecutiveReport }) {
  const academic = report.academic_summary;
  return <Card><CardHeader><CardTitle>Academic Snapshot — Academic Year Records</CardTitle><p className="text-sm text-muted-foreground">{report.report_period.sections.academics.label}. Monthly grade trends are unavailable because scores have no assessment-month field.</p></CardHeader><CardContent>
    {!academic.availability ? <p role="status" className="p-4">{academic.reason ?? "Academic data is unavailable."}</p> : <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><Metric label="Sumatif Average" value={display(academic.sumatif_average)} /><Metric label="Formatif Average" value={display(academic.formatif_average)} /><Metric label="Below KKM" value={academic.below_kkm_count} /></div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-3">Subject</th><th className="p-3">Jenjang</th><th className="p-3">Sumatif</th><th className="p-3">Formatif</th><th className="p-3">Below KKM</th></tr></thead><tbody>{academic.by_subject.map((row) => <tr className="border-b" key={`${row.subject_id}-${row.jenjang}`}><th className="p-3 text-left">{row.subject_name}</th><td className="p-3">{row.jenjang}</td><td className="p-3">{display(row.sumatif_average)}</td><td className="p-3">{display(row.formatif_average)}</td><td className="p-3">{row.below_kkm_count}</td></tr>)}</tbody></table></div>
    </>}
  </CardContent></Card>;
}

function AnnualReportView({ report }: { report: ExecutiveReport }) {
  return <div className="space-y-6" aria-live="polite">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Students" value={report.executive_summary.total_students} note={report.report_period.sections.population.label} /><Metric label="Attendance Rate" value={display(report.attendance_summary.attendance_rate, "%")} note="OBSERVED class-months" /><Metric label="Late Events" value={display(report.attendance_summary.late_days)} /><Metric label="Known Late Minutes" value={display(report.attendance_summary.late_minutes)} /></section>
    <AnnualAttendance report={report} />
    <AnnualTrends report={report} />
    <AcademicSnapshot report={report} />
    <Card><CardHeader><CardTitle>Data Quality</CardTitle><p className="text-sm text-muted-foreground">Annual reporting readiness summary.</p></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Not Reported Class-Months" value={report.data_quality.not_reported_class_months} /><Metric label="Observed Class-Months With Gaps" value={report.data_quality.partial_observed_class_months} /><Metric label="Attendance Conflicts" value={report.data_quality.unresolved_conflicts} /><Metric label="Empty Grade Cells" value={report.data_quality.empty_grade_cells} /></div>{report.data_quality.warnings.map((warning) => <p className="text-sm text-muted-foreground" key={warning}>{warning}</p>)}<div className="flex gap-4 text-sm font-semibold"><Link className="text-primary underline" to="/analytics/data-quality">Review Data Quality</Link><Link className="text-primary underline" to="/analytics/recapitulation">Open Population Overview</Link></div></CardContent></Card>
  </div>;
}

export default function ExecutiveReports() {
  const [academicYearId, setAcademicYearId] = useState<number | null>(null); const [scope, setScope] = useState<ReportScope>("combined");
  const [classId, setClassId] = useState<number | null>(null); const [subjectId, setSubjectId] = useState<number | null>(null);
  const [generatedQuery, setGeneratedQuery] = useState<ReportQuery | null>(null); const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null); const [exportError, setExportError] = useState("");
  const filtersQuery = useReportFilters(academicYearId, scope); const filters: ReportFiltersResponse | undefined = filtersQuery.data;
  const draftQuery = useMemo<ReportQuery | null>(() => academicYearId ? { academic_year_id: academicYearId, scope, class_id: classId ?? undefined, subject_id: subjectId ?? undefined } : null, [academicYearId, classId, scope, subjectId]);
  const isStale = Boolean(generatedQuery && (!draftQuery || JSON.stringify(normalizeReportQuery(generatedQuery)) !== JSON.stringify(normalizeReportQuery(draftQuery))));
  const reportQuery = useAnnualReport(generatedQuery); const report = generatedQuery && !isStale ? reportQuery.data : undefined;
  useEffect(() => { if (!filters) return; const defaults = selectReportFilterDefaults(filters); if (academicYearId === null && defaults.academicYearId) setAcademicYearId(defaults.academicYearId); }, [academicYearId, filters]);
  useEffect(() => { if (classId !== null && filters && !filters.class_options.some((item) => item.id === classId)) setClassId(null); }, [classId, filters]);
  useEffect(() => { if (subjectId !== null && filters && !filters.subjects.some((item) => item.id === subjectId)) setSubjectId(null); }, [filters, subjectId]);
  const changeYear = (id: number) => { setAcademicYearId(id); setClassId(null); setSubjectId(null); };
  const changeScope = (value: ReportScope) => { setScope(value); setClassId(null); setSubjectId(null); };
  const generate = async () => { if (!draftQuery) return; const normalized = { ...draftQuery, ...normalizeReportQuery(draftQuery) }; setExportError(""); if (generatedQuery && JSON.stringify(normalizeReportQuery(generatedQuery)) === JSON.stringify(normalizeReportQuery(normalized))) await reportQuery.refetch(); else setGeneratedQuery(normalized); };
  const runExport = async (format: "pdf" | "xlsx") => { if (!generatedQuery || isStale) return; setExporting(format); setExportError(""); try { const file = await exportAnnualReport(format, generatedQuery); downloadReportBlob(file.blob, file.filename); } catch { setExportError(`${format === "pdf" ? "PDF" : "Excel"} export failed. Please try again.`); } finally { setExporting(null); } };
  const actions = <div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" disabled={!report || Boolean(exporting)} onClick={() => window.print()}><Printer className="mr-2 size-4" />Print</Button><Button variant="outline" disabled={!report || Boolean(exporting)} onClick={() => void runExport("pdf")}>{exporting === "pdf" ? "Exporting…" : <><Download className="mr-2 size-4" />PDF</>}</Button><Button disabled={!report || Boolean(exporting)} onClick={() => void runExport("xlsx")}>{exporting === "xlsx" ? "Exporting…" : <><Download className="mr-2 size-4" />Excel</>}</Button></div>;
  const error = filtersQuery.error ? "Report filters could not be loaded." : reportQuery.error ? "The report could not be generated. Review the selected scope and try again." : null;
  return <div className="space-y-6 pb-12 print:p-0"><PageHeader title="Annual Report" description="Leadership summary across one selected Academic Year." actions={actions} />
    {exportError && <Alert variant="danger"><AlertTitle>Export unavailable</AlertTitle><AlertDescription>{exportError}</AlertDescription></Alert>}
    <FilterBar className="space-y-4"><h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Annual Report Filters</h2>{filtersQuery.isPending ? <LoadingState title="Loading report filters" /> : filtersQuery.error ? <ErrorState title="Report filters unavailable" description="The report scope could not be selected." action={<Button onClick={() => void filtersQuery.refetch()}>Retry</Button>} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FormField id="annual-report-year"><FieldLabel>Academic Year</FieldLabel><NativeSelect value={academicYearId ?? ""} onChange={(event) => changeYear(Number(event.target.value))}>{filters?.academic_years.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_default ? " (Default)" : ""}</option>)}</NativeSelect></FormField><FormField id="annual-report-scope"><FieldLabel>Scope</FieldLabel><NativeSelect value={scope} onChange={(event) => changeScope(event.target.value as ReportScope)}>{filters?.scopes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></FormField><FormField id="annual-report-class"><FieldLabel>Class</FieldLabel><NativeSelect value={classId ?? ""} onChange={(event) => setClassId(Number(event.target.value) || null)}><option value="">All Classes</option>{filters?.class_options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></FormField><FormField id="annual-report-subject"><FieldLabel>Subject</FieldLabel><NativeSelect value={subjectId ?? ""} onChange={(event) => setSubjectId(Number(event.target.value) || null)}><option value="">All Subjects</option>{filters?.subjects.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.jenjang_name}</option>)}</NativeSelect></FormField></div>
      <Button onClick={() => void generate()} disabled={!draftQuery || reportQuery.isFetching}>{reportQuery.isFetching ? "Generating…" : <><RefreshCw className="mr-2 size-4" />Generate Report</>}</Button>
    </>}</FilterBar>
    {isStale && <Alert variant="warning"><AlertTitle>Report scope changed</AlertTitle><AlertDescription>Generate again to update the report and its export scope.</AlertDescription></Alert>}
    {report && <AnnualReportView report={report} />}
    {generatedQuery && !isStale && (reportQuery.isPending || reportQuery.isFetching) && <LoadingState title="Generating annual report" description="Calculating the Academic Year attendance and academic summary." />}
    {!report && !generatedQuery && !filtersQuery.isPending && !error && <EmptyState title="Generate an annual report" description="Select a valid Academic Year and scope, then generate the report." />}
    {!report && error && <ErrorState title="The report could not be generated" description={error} action={generatedQuery ? <Button onClick={() => void reportQuery.refetch()}>Retry</Button> : undefined} />}
  </div>;
}
