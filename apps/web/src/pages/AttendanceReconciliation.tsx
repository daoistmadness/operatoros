import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AttendanceReconciliationQuery, AttendanceReconciliationResponse } from "@operatoros/contracts/analytics";
import { useReportFilters } from "../hooks/useReportQueries";
import type { ReportScope } from "../api/reports";
import { useAttendanceReconciliationQuery } from "../hooks/useAttendanceReconciliationQuery";
import { selectReportFilterDefaults } from "../lib/defaultReportMonth";
import { getPageApiError } from "../lib/api/errors";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { FieldLabel, FormField } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";

const scopes: ReportScope[] = ["combined", "early_year", "primary", "secondary"];
const scopeLabel: Record<ReportScope, string> = { combined: "All programs", early_year: "TK / KB", primary: "SD", secondary: "SMP" };
type Reconciliation = AttendanceReconciliationResponse;
type StudentRow = Reconciliation["students"][number];

function comparisonLabel(status: StudentRow["comparison"]["status"], reason: StudentRow["comparison"]["reason_code"]) {
  if (status === "MATCH") return "Totals match";
  if (status === "MISMATCH") return "Totals differ";
  if (status === "NOT_REPORTED") return "Book totals not reported";
  if (reason === "CLASS_TOTALS_ONLY") return "Class totals only";
  return "Not comparable";
}

function statusLabel(value: string | null) {
  if (value === "on-time" || value === "late") return value === "late" ? "Present · late" : "Present";
  if (value === "sakit") return "Sakit";
  if (value === "izin") return "Izin";
  if (value === "alfa") return "Alfa";
  return value ? `Needs review · ${value}` : "Unresolved · no dated record";
}

function count(value: number | null) {
  return value === null ? "—" : value.toLocaleString("id-ID");
}

function difference(value: number | null) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value}`;
}

function summaryCards(data: Reconciliation) {
  return [
    ["Applicable students", data.summary.applicable_students],
    ["Need review", data.summary.students_needing_review],
    ["Book totals match", data.summary.matching_students],
    ["Book totals differ", data.summary.mismatched_students],
    ["Unresolved student-days", data.summary.unresolved_student_days],
    ["Book report", data.ledger.state === "SUBMITTED" ? "Submitted" : data.ledger.state === "OPEN" ? "Not submitted" : "Not reported"],
  ] as const;
}

function StudentEvidence({ row, data }: { row: StudentRow; data: Reconciliation }) {
  const reviewDate = row.first_review_date;
  const reviewHref = reviewDate ? `/attendance/class-entry?class_id=${data.class.id}&date=${reviewDate}` : null;
  const historyStart = reviewDate ?? data.period.start_date;
  const historyEnd = reviewDate ?? data.period.end_date;
  const correctionHref = `/attendance/override-review?academic_year_id=${data.academic_year.id}&class_id=${data.class.id}&date_from=${historyStart}&date_to=${historyEnd}`;
  const ledgerHref = `/attendance/monthly-recap?academic_year_id=${data.academic_year.id}&month=${data.month}&class_id=${data.class.id}`;
  return <>
    <details className="min-w-[12rem]">
      <summary className="cursor-pointer font-bold text-primary underline underline-offset-2">{row.daily_evidence.length} school days</summary>
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border">
        <DataTable>
          <DataTableHeader className="sticky top-0"><tr><DataTableHead>Date</DataTableHead><DataTableHead>Effective status</DataTableHead><DataTableHead>Sources</DataTableHead><DataTableHead>Review</DataTableHead></tr></DataTableHeader>
          <DataTableBody>{row.daily_evidence.map((day) => <DataTableRow key={day.date}>
            <DataTableCell className="whitespace-nowrap">{day.date}</DataTableCell>
            <DataTableCell>{statusLabel(day.effective_status)}</DataTableCell>
            <DataTableCell className="text-xs text-muted-foreground">
              {day.override_status ? `Correction: ${day.override_status}` : day.raw_status ? `Base: ${day.raw_status}` : "No dated record"}
              {day.machine_recorded && <span className="block">Machine source retained</span>}
            </DataTableCell>
            <DataTableCell><Link className="font-semibold text-primary underline" to={`/attendance/class-entry?class_id=${data.class.id}&date=${day.date}`}>Open date</Link></DataTableCell>
          </DataTableRow>)}</DataTableBody>
        </DataTable>
      </div>
      {row.machine_records.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground" aria-label="Imported machine records">
        {row.machine_records.map((record) => <li key={record.date}>{record.date}: {record.source_state === "CONFLICT" ? "Conflicting import" : record.source_state === "APPLIED" ? "Applied import" : "Unchanged import"}; {record.status}; scan in {record.scan_in ?? "not recorded"}; scan out {record.scan_out ?? "not recorded"}</li>)}
      </ul>}
      {row.contradictory_dates.length > 0 && <p className="mt-2 text-sm font-bold text-danger">Machine presence conflicts with effective status on {row.contradictory_dates.join(", ")}.</p>}
    </details>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
      {reviewHref ? <Link className="text-primary underline" to={reviewHref}>Attendance entry</Link>
        : row.comparison.status === "MISMATCH" && <span className="text-muted-foreground">Monthly totals do not identify a date to correct.</span>}
      <Link className="text-primary underline" to={correctionHref}>Correction history</Link>
      <Link className="text-primary underline" to={ledgerHref}>Monthly book totals</Link>
    </div>
  </>;
}

export default function AttendanceReconciliation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialScope = scopes.includes(searchParams.get("scope") as ReportScope) ? searchParams.get("scope") as ReportScope : "combined";
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => Number(searchParams.get("academic_year_id")) || null);
  const [month, setMonth] = useState(searchParams.get("month") ?? "");
  const [scope, setScope] = useState<ReportScope>(initialScope);
  const [classId, setClassId] = useState<number | null>(() => Number(searchParams.get("class_id")) || null);
  const [studentFilter, setStudentFilter] = useState("");
  const filtersQuery = useReportFilters(academicYearId, scope);
  const filters = filtersQuery.data;

  useEffect(() => {
    if (!filters) return;
    const defaults = selectReportFilterDefaults(filters);
    if (academicYearId === null && defaults.academicYearId !== null) setAcademicYearId(defaults.academicYearId);
    if (!filters.months.some((item) => item.value === month)) setMonth(defaults.month);
    if (classId !== null && !filters.class_options.some((item) => item.id === classId)) setClassId(null);
  }, [academicYearId, classId, filters, month]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const values: Record<string, string | number | null> = {
      academic_year_id: academicYearId,
      scope,
      class_id: classId,
      month: month || null,
    };
    for (const [key, value] of Object.entries(values)) value === null ? next.delete(key) : next.set(key, String(value));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [academicYearId, classId, month, scope, searchParams, setSearchParams]);

  const query = useMemo<AttendanceReconciliationQuery | null>(() => academicYearId && classId && month
    ? { academic_year_id: String(academicYearId), class_id: String(classId), month, scope }
    : null, [academicYearId, classId, month, scope]);
  const reconciliationQuery = useAttendanceReconciliationQuery(query);
  const data = reconciliationQuery.data;
  const students = data?.students.filter((row) => row.student_name.toLocaleLowerCase().includes(studentFilter.trim().toLocaleLowerCase())) ?? [];
  const error = filtersQuery.error ?? reconciliationQuery.error;

  return <div className="space-y-6">
    <PageHeader title="Monthly Attendance Reconciliation" description="Compare imported machine records, effective dated attendance, and teacher-book S/I/A totals for one class and month." actions={<>
      <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-bold text-foreground hover:bg-surface-muted" to="/upload?section=attendance">Machine import</Link>
      <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-bold text-foreground hover:bg-surface-muted" to="/reports?view=monthly">Attendance reports</Link>
      {data && <Button variant="outline" onClick={() => void reconciliationQuery.refetch()} disabled={reconciliationQuery.isFetching}>{reconciliationQuery.isFetching ? "Refreshing…" : "Refresh"}</Button>}
    </>} />

    <Card><CardHeader><CardTitle>Choose a class and month</CardTitle><CardDescription>Only administrator-authorized school scopes and classes are available.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FormField id="attendance-reconciliation-year"><FieldLabel>Academic year</FieldLabel><NativeSelect value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setClassId(null); }}>
          <option value="">Select year</option>{filters?.academic_years.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_default ? " (Default)" : ""}</option>)}
        </NativeSelect></FormField>
        <FormField id="attendance-reconciliation-scope"><FieldLabel>School / program</FieldLabel><NativeSelect value={scope} onChange={(event) => { setScope(event.target.value as ReportScope); setClassId(null); }}>
          {scopes.map((value) => <option key={value} value={value}>{scopeLabel[value]}</option>)}
        </NativeSelect></FormField>
        <FormField id="attendance-reconciliation-class"><FieldLabel>Class</FieldLabel><NativeSelect value={classId ?? ""} onChange={(event) => setClassId(Number(event.target.value) || null)}>
          <option value="">Select class</option>{filters?.class_options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect></FormField>
        <FormField id="attendance-reconciliation-month"><FieldLabel>Month</FieldLabel><NativeSelect value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="">Select month</option>{filters?.months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </NativeSelect></FormField>
      </CardContent>
    </Card>

    {filtersQuery.isPending && <LoadingState title="Loading attendance filters" />}
    {filtersQuery.error && <ErrorState title="Attendance filters unavailable" description={getPageApiError(filtersQuery.error, "The authorized class and month options could not be loaded.")} action={<Button variant="outline" onClick={() => void filtersQuery.refetch()}>Retry</Button>} />}
    {query === null && !filtersQuery.isPending && !filtersQuery.error && <EmptyState title="Choose a class and month" description="Select an academic year, program, class, and month to open the read-only reconciliation worklist." />}
    {reconciliationQuery.isPending && query && <LoadingState title="Loading monthly reconciliation" description="Reading effective dated attendance and separate teacher-book totals." />}
    {reconciliationQuery.error && <ErrorState title="Reconciliation unavailable" description={getPageApiError(reconciliationQuery.error, "The selected class and month could not be reconciled.")} action={<Button variant="outline" onClick={() => void reconciliationQuery.refetch()}>Retry</Button>} />}

    {data && <>
      <Alert variant={data.evidence.status === "CONTRADICTORY" ? "warning" : data.evidence.status === "INCOMPLETE" ? "information" : "success"}>
        <AlertTitle>{data.class.name} · {data.month} · {data.evidence.status === "CLEAR" ? "No identified evidence conflicts" : data.evidence.status === "CONTRADICTORY" ? "Evidence needs investigation" : "Evidence is incomplete"}</AlertTitle>
        <AlertDescription>
          Machine records: {data.machine_evidence.recorded_student_days} dated scans; coverage is not tracked. Missing scans remain unresolved and are never counted as Alfa. A monthly totals match does not resolve a dated machine/book conflict.
          {data.ledger.state !== "SUBMITTED" && <> Teacher-book monthly totals are {data.ledger.state === "OPEN" ? "saved but not submitted" : "not reported"}; they are not treated as zero.</>}
          {data.evidence.unknown_calendar_dates.length > 0 && <> Calendar coverage is unknown for {data.evidence.unknown_calendar_dates.length} date(s), so comparisons may be incomplete.</>}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {summaryCards(data).map(([title, value]) => <Card key={title} className="p-4"><p className="text-xs font-black uppercase tracking-wide text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-black">{value}</p></Card>)}
      </div>

      <Card><CardHeader><CardTitle>Monthly comparison</CardTitle><CardDescription>
        {data.ledger.state === "SUBMITTED" ? `Teacher book reported S/I/A: ${count(data.ledger.reported.sakit)} / ${count(data.ledger.reported.izin)} / ${count(data.ledger.reported.alfa)}.` : "Teacher-book totals are not submitted; no zero totals are assumed."}
        {` Effective dated S/I/A: ${data.canonical.sakit_count} / ${data.canonical.izin_count} / ${data.canonical.alfa_count}.`}
        {` ${data.calendar.expected_school_days} expected school days; ${data.calendar.non_school_days} non-school days.`}
      </CardDescription><p className="text-sm font-bold">Class comparison: {comparisonLabel(data.ledger.comparison.status, data.ledger.comparison.reason_code)}
        {data.ledger.comparison.differences.sakit !== null && <> · Δ S/I/A {difference(data.ledger.comparison.differences.sakit)} / {difference(data.ledger.comparison.differences.izin)} / {difference(data.ledger.comparison.differences.alfa)}</>}
      </p></CardHeader><CardContent>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <FormField id="attendance-reconciliation-student-filter" className="max-w-sm"><FieldLabel>Filter students</FieldLabel><input id="attendance-reconciliation-student-filter" className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Search by student name" /></FormField>
          <p className="text-sm text-muted-foreground">{data.summary.unresolved_student_days} unresolved expected student-days · {data.summary.contradictory_student_days} dated machine conflicts</p>
        </div>
        {students.length === 0 ? <EmptyState title="No students match this filter" description="Clear the student filter or select another class/month." /> : <DataTableContainer>
          <DataTable>
            <DataTableHeader className="sticky top-0 z-10"><tr>
              <DataTableHead>Student</DataTableHead><DataTableHead>Machine records</DataTableHead>
              <DataTableHead>Effective S / I / A</DataTableHead><DataTableHead>Book S / I / A</DataTableHead>
              <DataTableHead>Comparison</DataTableHead><DataTableHead>Daily review and actions</DataTableHead>
            </tr></DataTableHeader>
            <DataTableBody>{students.map((row) => <DataTableRow key={row.enrollment_id}>
              <DataTableCell className="min-w-44 font-bold">{row.student_name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{row.expected_student_days} expected student-days</span></DataTableCell>
              <DataTableCell className="whitespace-nowrap">{row.machine_records.length} scan day(s)</DataTableCell>
              <DataTableCell className="whitespace-nowrap">{row.effective.sakit} / {row.effective.izin} / {row.effective.alfa}<span className="mt-1 block text-xs text-muted-foreground">{row.effective.unresolved} unresolved · {row.effective.present} present</span></DataTableCell>
              <DataTableCell className="whitespace-nowrap">{row.book_totals.sakit === null ? "—" : `${row.book_totals.sakit} / ${row.book_totals.izin} / ${row.book_totals.alfa}`}</DataTableCell>
              <DataTableCell><span className={row.comparison.status === "MATCH" ? "font-bold text-success" : row.comparison.status === "MISMATCH" ? "font-bold text-danger" : "font-semibold text-muted-foreground"}>{comparisonLabel(row.comparison.status, row.comparison.reason_code)}</span>
                {row.differences.sakit !== null && <span className="mt-1 block text-xs text-muted-foreground">Δ S/I/A {difference(row.differences.sakit)} / {difference(row.differences.izin)} / {difference(row.differences.alfa)}</span>}
                {(row.unresolved_dates.length > 0 || row.unknown_calendar_dates.length > 0 || row.contradictory_dates.length > 0) && <span className="mt-1 block text-xs font-semibold text-warning">{row.unresolved_dates.length} unresolved · {row.contradictory_dates.length} conflicts</span>}
              </DataTableCell>
              <DataTableCell><StudentEvidence row={row} data={data} /></DataTableCell>
            </DataTableRow>)}</DataTableBody>
          </DataTable>
        </DataTableContainer>}
      </CardContent></Card>
    </>}
  </div>;
}
