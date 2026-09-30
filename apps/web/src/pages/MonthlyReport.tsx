import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import type { MonthlyReportResponse, ReportFiltersResponse, ReportQuery, ReportScope } from "../api/reports";
import { downloadReportBlob, exportMonthlyReport } from "../api/reports";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel, FormField } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { useMonthlyReport, useReportFilters } from "../hooks/useReportQueries";
import { normalizeReportQuery, selectReportFilterDefaults } from "../lib/defaultReportMonth";

const value = (number: number | null | undefined, suffix = "") => number == null ? "—" : `${number}${suffix}`;
const defaultScope: ReportScope = "combined";

function SummaryCard({ label, value: count, note }: { label: string; value: string | number; note?: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{count}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</CardContent></Card>;
}

function AttendanceSection({ report }: { report: MonthlyReportResponse }) {
  const summary = report.attendance.summary;
  return <Card>
    <CardHeader><CardTitle>Attendance</CardTitle><p className="text-sm text-muted-foreground">{report.report_period.sections.attendance.label}. Attendance Rate and Coverage summarize OBSERVED classes only. Basis and source remain visible for each class.</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Attendance Rate" value={value(summary.observed.attendance_rate, "%")} note="OBSERVED classes only" />
        <SummaryCard label="Coverage" value={value(summary.observed.coverage_rate, "%")} note="OBSERVED classes only" />
        <SummaryCard label="Unrecorded" value={summary.observed.unrecorded_student_days} note="OBSERVED Student-Days" />
        <SummaryCard label="Late Event Rate" value={value(summary.lateness.late_event_rate, "%")} note={`${summary.lateness.availability.toLowerCase()} · ${value(summary.lateness.coverage_rate, "%")} coverage`} />
        <SummaryCard label="Conflicts" value={summary.conflict_count} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Monthly attendance by class, including source basis, coverage, and conflicts</caption>
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            {["Class", "Jenjang", "Basis", "Expected Student-Days", "Recorded", "Hadir / Presumed", "Sakit", "Izin", "Alfa", "Unrecorded", "Coverage", "Lateness", "Late Events", "Late Event Rate", "Conflict"].map((heading) => <th key={heading} className="whitespace-nowrap p-3">{heading}</th>)}
          </tr></thead>
          <tbody>{report.attendance.classes.map((row) => <tr className="border-b" key={row.class_id}>
            <th className="whitespace-nowrap p-3 text-left font-bold">{row.class_name}</th><td className="whitespace-nowrap p-3">{row.jenjang}</td>
            <td className="whitespace-nowrap p-3 font-semibold">{row.basis}</td><td className="p-3 tabular-nums">{row.expected_student_days}</td>
            <td className="p-3 tabular-nums">{value(row.recorded_student_days)}</td>
            <td className="p-3 tabular-nums">{row.basis === "OBSERVED" ? value(row.hadir_student_days) : row.basis === "DECLARED" ? value(row.presumed_hadir_student_days) : "—"}</td>
            <td className="p-3 tabular-nums">{value(row.sakit_student_days)}</td><td className="p-3 tabular-nums">{value(row.izin_student_days)}</td><td className="p-3 tabular-nums">{value(row.alfa_student_days)}</td>
            <td className="p-3 tabular-nums">{value(row.unrecorded_student_days)}</td><td className="p-3 tabular-nums">{value(row.coverage_rate, "%")}</td>
            <td className="whitespace-nowrap p-3">{row.lateness.availability === "AVAILABLE" ? "Available" : "Unavailable"}</td>
            <td className="p-3 tabular-nums">{value(row.lateness.late_events)}</td><td className="p-3 tabular-nums">{value(row.lateness.late_event_rate, "%")}</td>
            <td className="whitespace-nowrap p-3" title={row.conflict?.reason_code ?? undefined}>{row.conflict ? `CONFLICT (${row.conflict.delta_student_days})` : "—"}</td>
          </tr>)}</tbody>
        </table>
        {!report.attendance.classes.length && <EmptyState title="No classes in this report scope" description="Check the Academic Year, scope, and class filters." />}
      </div>
      <p className="text-xs text-muted-foreground">DECLARED values come from submitted Sakit/Izin/Alfa totals. Presumed Hadir is calculated and is not an observed attendance event. Lateness is unavailable without canonical arrival evidence.</p>
    </CardContent>
  </Card>;
}

function AcademicSection({ report }: { report: MonthlyReportResponse }) {
  const academic = report.academic_summary;
  return <Card>
    <CardHeader><CardTitle>Academic Snapshot — Academic Year Records</CardTitle><p className="text-sm text-muted-foreground">{report.report_period.sections.academics.label}. Grades have no assessment-month field, so these values are not month-bound.</p></CardHeader>
    <CardContent>
      {!academic.availability ? <p role="status" className="rounded-md bg-surface-muted p-4 text-sm">{academic.reason ?? "Academic data is unavailable."}</p> : <>
        <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><dt className="text-muted-foreground">Sumatif Average</dt><dd className="font-bold">{value(academic.sumatif_average)}</dd></div>
          <div><dt className="text-muted-foreground">Formatif Average</dt><dd className="font-bold">{value(academic.formatif_average)}</dd></div>
          <div><dt className="text-muted-foreground">Below KKM</dt><dd className="font-bold">{academic.below_kkm_count}</dd></div>
        </dl>
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-3">Subject</th><th className="p-3">Jenjang</th><th className="p-3">Sumatif</th><th className="p-3">Formatif</th><th className="p-3">Below KKM</th></tr></thead><tbody>{academic.by_subject.map((row) => <tr className="border-b" key={`${row.subject_id}-${row.jenjang}`}><th className="p-3 text-left">{row.subject_name}</th><td className="p-3">{row.jenjang}</td><td className="p-3">{value(row.sumatif_average)}</td><td className="p-3">{value(row.formatif_average)}</td><td className="p-3">{row.below_kkm_count}</td></tr>)}</tbody></table></div>
      </>}
    </CardContent>
  </Card>;
}

function MonthlyReportView({ report }: { report: MonthlyReportResponse }) {
  const quality = report.data_quality;
  return <div className="space-y-6" aria-live="polite">
    <p className="text-sm text-muted-foreground">{report.report_period.sections.population.label}: <strong className="text-foreground">{report.population.total_students} students</strong> across <strong className="text-foreground">{report.population.total_classes} classes</strong>.</p>
    <AttendanceSection report={report} />
    <AcademicSection report={report} />
    <Card><CardHeader><CardTitle>Data Quality</CardTitle><p className="text-sm text-muted-foreground">Summary signals for this report scope.</p></CardHeader><CardContent className="space-y-4">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Observed Classes With Gaps</dt><dd className="font-bold">{quality.partial_observed_classes}</dd></div>
        <div><dt className="text-muted-foreground">Not Reported Classes</dt><dd className="font-bold">{quality.not_reported_classes}</dd></div>
        <div><dt className="text-muted-foreground">Empty Grade Cells</dt><dd className="font-bold">{quality.empty_grade_cells}</dd></div>
      </dl>
      {quality.warnings.map((warning) => <p className="text-sm text-muted-foreground" key={warning}>{warning}</p>)}
      <div className="flex flex-wrap gap-4 text-sm font-semibold"><Link className="text-primary underline" to="/analytics/data-quality">Review Data Quality</Link><Link className="text-primary underline" to="/analytics/recapitulation">Open Population Overview</Link></div>
    </CardContent></Card>
  </div>;
}

export default function MonthlyReport() {
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [month, setMonth] = useState(""); const [scope, setScope] = useState<ReportScope>(defaultScope);
  const [classId, setClassId] = useState<number | null>(null); const [subjectId, setSubjectId] = useState<number | null>(null);
  const [generatedQuery, setGeneratedQuery] = useState<ReportQuery | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null); const [exportError, setExportError] = useState<string | null>(null);
  const filtersQuery = useReportFilters(academicYearId, scope); const filters: ReportFiltersResponse | undefined = filtersQuery.data;
  const draftQuery = useMemo<ReportQuery | null>(() => academicYearId && month
    ? { academic_year_id: academicYearId, scope, month, class_id: classId ?? undefined, subject_id: subjectId ?? undefined } : null,
  [academicYearId, classId, month, scope, subjectId]);
  const query = draftQuery && filters?.months.some((item) => item.value === draftQuery.month) ? draftQuery : null;
  const isStale = Boolean(generatedQuery && (!draftQuery || JSON.stringify(normalizeReportQuery(generatedQuery)) !== JSON.stringify(normalizeReportQuery(draftQuery))));
  const reportQuery = useMonthlyReport(generatedQuery);
  const report = generatedQuery && !isStale ? reportQuery.data : undefined;

  useEffect(() => { if (!filters) return; const defaults = selectReportFilterDefaults(filters); if (academicYearId === null && defaults.academicYearId) setAcademicYearId(defaults.academicYearId); setMonth((current) => filters.months.some((item) => item.value === current) ? current : defaults.month); }, [academicYearId, filters]);
  useEffect(() => { if (classId !== null && filters && !filters.class_options.some((item) => item.id === classId)) setClassId(null); }, [classId, filters]);
  useEffect(() => { if (subjectId !== null && filters && !filters.subjects.some((item) => item.id === subjectId)) setSubjectId(null); }, [filters, subjectId]);

  const changeYear = (id: number) => { setAcademicYearId(id); setClassId(null); setSubjectId(null); };
  const changeScope = (value: ReportScope) => { setScope(value); setClassId(null); setSubjectId(null); };
  const generate = async () => {
    if (!query) return;
    const normalized = { ...query, ...normalizeReportQuery(query) };
    setExportError(null);
    if (generatedQuery && JSON.stringify(normalizeReportQuery(generatedQuery)) === JSON.stringify(normalizeReportQuery(normalized))) await reportQuery.refetch();
    else setGeneratedQuery(normalized);
  };
  const runExport = async (format: "pdf" | "xlsx") => {
    if (!generatedQuery || isStale) return;
    setExporting(format); setExportError(null);
    try { const file = await exportMonthlyReport(format, generatedQuery); downloadReportBlob(file.blob, file.filename); }
    catch { setExportError(`${format === "pdf" ? "PDF" : "Excel"} export failed. Please try again.`); }
    finally { setExporting(null); }
  };

  const actions = <div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" disabled={!report || Boolean(exporting)} onClick={() => window.print()}><Printer className="mr-2 size-4" />Print</Button><Button variant="outline" disabled={!report || Boolean(exporting)} onClick={() => void runExport("pdf")}>{exporting === "pdf" ? "Exporting…" : <><Download className="mr-2 size-4" />PDF</>}</Button><Button disabled={!report || Boolean(exporting)} onClick={() => void runExport("xlsx")}>{exporting === "xlsx" ? "Exporting…" : <><Download className="mr-2 size-4" />Excel</>}</Button></div>;
  const error = filtersQuery.error ? "Report filters could not be loaded." : reportQuery.error ? "The report could not be generated. Review the selected scope and try again." : null;
  return <div className="space-y-6 pb-12 print:p-0">
    <PageHeader title="Monthly Report" description="Management review for one selected calendar month." actions={actions} />
    {exportError && <Alert variant="danger"><AlertTitle>Export unavailable</AlertTitle><AlertDescription>{exportError}</AlertDescription></Alert>}
    <FilterBar className="space-y-4"><h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Report Filters</h2>
      {filtersQuery.isPending ? <LoadingState title="Loading report filters" /> : filtersQuery.error ? <ErrorState title="Report filters unavailable" description="The report scope could not be selected." action={<Button onClick={() => void filtersQuery.refetch()}>Retry</Button>} /> : <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <FormField id="monthly-report-year"><FieldLabel>Academic Year</FieldLabel><NativeSelect value={academicYearId ?? ""} onChange={(event) => changeYear(Number(event.target.value))}>{filters?.academic_years.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_default ? " (Default)" : ""}</option>)}</NativeSelect></FormField>
          <FormField id="monthly-report-month"><FieldLabel>Month</FieldLabel><NativeSelect value={month} onChange={(event) => setMonth(event.target.value)}>{filters?.months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></FormField>
          <FormField id="monthly-report-scope"><FieldLabel>Scope</FieldLabel><NativeSelect value={scope} onChange={(event) => changeScope(event.target.value as ReportScope)}>{filters?.scopes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></FormField>
          <FormField id="monthly-report-class"><FieldLabel>Class</FieldLabel><NativeSelect value={classId ?? ""} onChange={(event) => setClassId(Number(event.target.value) || null)}><option value="">All Classes</option>{filters?.class_options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></FormField>
          <FormField id="monthly-report-subject"><FieldLabel>Subject</FieldLabel><NativeSelect value={subjectId ?? ""} onChange={(event) => setSubjectId(Number(event.target.value) || null)}><option value="">All Subjects</option>{filters?.subjects.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.jenjang_name}</option>)}</NativeSelect></FormField>
        </div>
        <Button onClick={() => void generate()} disabled={!query || reportQuery.isFetching}>{reportQuery.isFetching ? "Generating…" : <><RefreshCw className="mr-2 size-4" />Generate Report</>}</Button>
      </>}
    </FilterBar>
    {isStale && <Alert variant="warning"><AlertTitle>Report scope changed</AlertTitle><AlertDescription>Generate again to update the report and its export scope.</AlertDescription></Alert>}
    {report && <MonthlyReportView report={report} />}
    {generatedQuery && !isStale && (reportQuery.isPending || reportQuery.isFetching) && <LoadingState title="Generating monthly report" description="Reading canonical attendance, academic, and data-quality sources." />}
    {!report && !generatedQuery && !filtersQuery.isPending && !error && <EmptyState title="Generate a monthly report" description="Select a valid Academic Year and month, then generate the report." />}
    {!report && error && <ErrorState title="The report could not be generated" description={error} action={generatedQuery ? <Button onClick={() => void reportQuery.refetch()}>Retry</Button> : undefined} />}
  </div>;
}
