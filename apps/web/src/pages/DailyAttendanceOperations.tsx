import { useEffect, useMemo, useState } from "react";
import { AppLink as Link } from '../components/AppLink';
import { useUrlSearchParams as useSearchParams } from '../lib/router/search';
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/common/page-header";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";
import { useDailyAttendanceQuery } from "../hooks/useDailyAttendanceQuery";
import { cn } from "../lib/utils";
import { schoolLocalDate } from "../lib/school-date";

const scopeLinkClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto px-2 text-center");

const isoToday = () => schoolLocalDate();
const number = (value: number) => value.toLocaleString();

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stateLabel(value: string): string {
  return value === "NONE" ? "No records" : value === "EMPTY_CLASS" ? "Empty class" : value[0] + value.slice(1).toLowerCase();
}

function expectationLabel(value: string): string {
  return value === "EXPECTED" ? "Attendance expected" : value === "NOT_EXPECTED" ? "Attendance not expected" : "Calendar expectation unavailable";
}

function timingLabel(value: string): string {
  return value === "BEFORE_DEADLINE" ? "Before deadline" : value === "DEADLINE_PASSED" ? "Submission deadline passed" : value === "NOT_APPLICABLE" ? "Not applicable" : "Submission deadline unavailable";
}

function classLink(classId: number, date: string): string {
  const query = new URLSearchParams({ attendance_date_from: date, attendance_date_to: date });
  return `/classes/${classId}?${query}`;
}

function entryLink(classId: number, date: string): string {
  return `/attendance/class-entry?class_id=${classId}&date=${date}`;
}

export default function DailyAttendanceOperations() {
  const { can } = useAuth();
  const allowed = can("view_attendance");
  const [searchParams, setSearchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get("date") ?? isoToday());
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => Number(searchParams.get("academic_year_id")) || null);
  const [jenjangId, setJenjangId] = useState<number | null>(() => Number(searchParams.get("jenjang_id")) || null);
  const [classId, setClassId] = useState<number | null>(() => Number(searchParams.get("class_id")) || null);
  const filtersQuery = useAnalyticsFiltersQuery({}, allowed);
  const years = filtersQuery.data?.academic_years ?? [];
  const selectedYear = academicYearId ?? (years.find((year) => year.is_default) ?? years[0])?.id ?? null;
  const optionsQuery = useAttendanceAnalyticsOptionsQuery(selectedYear, jenjangId, allowed);
  const classes = optionsQuery.data?.classes ?? [];
  const queryFilters = useMemo(() => ({ date, academic_year_id: selectedYear, jenjang_id: jenjangId, class_id: classId }), [date, selectedYear, jenjangId, classId]);
  const dailyQuery = useDailyAttendanceQuery(queryFilters, allowed && selectedYear !== null);

  useEffect(() => { if (academicYearId === null && selectedYear !== null) setAcademicYearId(selectedYear); }, [academicYearId, selectedYear]);
  useEffect(() => { if (classId !== null && !classes.some((item) => item.id === classId)) setClassId(null); }, [classId, classes]);
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("date", date);
    if (selectedYear !== null) next.set("academic_year_id", String(selectedYear));
    if (jenjangId !== null) next.set("jenjang_id", String(jenjangId));
    if (classId !== null) next.set("class_id", String(classId));
    setSearchParams(next, { replace: true });
  }, [date, selectedYear, jenjangId, classId, setSearchParams]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view daily attendance operations." />;
  if (filtersQuery.isPending) return <LoadingState title="Loading daily attendance" description="Preparing the available attendance scope." />;
  if (filtersQuery.error || dailyQuery.error) return <ErrorState title="Daily attendance could not be loaded" description="The selected attendance scope could not be loaded." action={<Button onClick={() => { void filtersQuery.refetch(); void dailyQuery.refetch(); }}>Try again</Button>} />;
  if (dailyQuery.isPending || !dailyQuery.data) return <LoadingState title="Loading daily attendance" description="Computing recording coverage on the server." />;
  const value = dailyQuery.data;
  const setDateValue = (next: string) => { if (next) setDate(next); };
  const reset = () => { setDate(isoToday()); setAcademicYearId((years.find((year) => year.is_default) ?? years[0])?.id ?? null); setJenjangId(null); setClassId(null); };
  return <div className="space-y-4">
    <PageHeader
      className="lg:flex-col"
      title="Daily Attendance"
      description="Review class coverage and submission timing for the selected date. “Not expected” means attendance is not required and does not mark students absent or Alfa."
      actions={
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Link className={scopeLinkClass} to="/attendance/calendar">Attendance Calendar</Link>
          {can("import_attendance") && <Link className={scopeLinkClass} to="/upload">Attendance Upload</Link>}
          {can("view_attendance_corrections") && <Link className={scopeLinkClass} to="/attendance/override-review">Correction Review</Link>}
          <Button variant="outline" onClick={reset} className="h-auto px-2"><RotateCcw className="size-4 shrink-0" aria-hidden="true" />Reset filters</Button>
        </div>
      }
    />
    <Card><CardHeader className="p-4"><CardTitle className="text-base font-semibold">Scope</CardTitle><p className="text-sm text-muted-foreground">Coverage is based on active enrolled students and effective attendance records. Calendar expectation comes from the configured jenjang authority.</p></CardHeader><CardContent className="px-4 pb-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.4fr)_repeat(3,minmax(0,1fr))] [&_select]:h-10"><div><FieldLabel htmlFor="daily-date">Date</FieldLabel><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDateValue(shiftDate(date, -1))}><ArrowLeft className="size-4" aria-hidden="true" /></Button><Input id="daily-date" type="date" value={date} onChange={(event) => setDateValue(event.target.value)} className="h-10 min-w-0 flex-1 px-2" /><Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDateValue(shiftDate(date, 1))}><ArrowRight className="size-4" aria-hidden="true" /></Button></div></div><div><FieldLabel htmlFor="daily-year">Academic year</FieldLabel><NativeSelect id="daily-year" value={selectedYear ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setJenjangId(null); setClassId(null); }}>{years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="daily-jenjang">Jenjang</FieldLabel><NativeSelect id="daily-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(Number(event.target.value) || null); setClassId(null); }}><option value="">All jenjang</option>{(filtersQuery.data?.jenjangs ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="daily-class">Class / Rombel</FieldLabel><NativeSelect id="daily-class" value={classId ?? ""} onChange={(event) => setClassId(Number(event.target.value) || null)}><option value="">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div></div><p className="mt-3 text-sm text-muted-foreground">Calendar states: {value.totals.expectedClasses} expected · {value.totals.notExpectedClasses} not expected · {value.totals.unknownClasses} unavailable.</p></CardContent></Card>
    <dl aria-label="Daily attendance summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-5">
      <div className="bg-surface p-3"><dt className="text-xs text-muted-foreground">Classes</dt><dd className="text-xl font-semibold tabular-nums">{number(value.totals.classes)}</dd></div>
      <div className="bg-surface p-3"><dt className="text-xs text-muted-foreground">Complete</dt><dd className="text-xl font-semibold tabular-nums">{number(value.totals.completeClasses)}</dd></div>
      <div className="bg-surface p-3"><dt className="text-xs text-muted-foreground">Partial</dt><dd className="text-xl font-semibold tabular-nums">{number(value.totals.partialClasses)}</dd></div>
      <div className="bg-surface p-3"><dt className="text-xs text-muted-foreground">No records</dt><dd className="text-xl font-semibold tabular-nums">{number(value.totals.noRecordClasses)}</dd></div>
      <div className="col-span-2 bg-surface p-3 sm:col-span-1"><dt className="text-xs text-muted-foreground">Recorded / expected</dt><dd className="text-xl font-semibold tabular-nums">{number(value.totals.recordedStudents)} / {number(value.totals.expectedStudents)}</dd></div>
    </dl>
    {value.classes.length === 0 ? <EmptyState title="No classes in scope" description="No active classes match the selected filters." /> : <Card><CardHeader className="p-4"><CardTitle className="text-base font-semibold">Class coverage</CardTitle><p className="text-sm text-muted-foreground">Expectation, recording coverage, and submission timing are independent server-derived states.</p></CardHeader><DataTableContainer role="region" aria-label="Class coverage results" tabIndex={0} className="rounded-none border-x-0 border-b-0 focus-visible:outline-offset-2"><DataTable className="w-full min-w-[64rem]"><caption className="sr-only">Daily attendance coverage, expectation, and submission timing by class</caption><DataTableHeader><DataTableRow><DataTableHead className="px-2">Class</DataTableHead><DataTableHead className="px-2">Expectation</DataTableHead><DataTableHead className="px-2">Submission</DataTableHead><DataTableHead className="px-2 text-right">Students</DataTableHead><DataTableHead className="px-2 text-right">Recorded</DataTableHead><DataTableHead className="px-2 text-right">Unrecorded</DataTableHead><DataTableHead className="px-2">Coverage</DataTableHead><DataTableHead className="px-2 text-right">Present</DataTableHead><DataTableHead className="px-2 text-right">Late</DataTableHead><DataTableHead className="px-2 text-right">Sakit</DataTableHead><DataTableHead className="px-2 text-right">Izin</DataTableHead><DataTableHead className="px-2 text-right">Alfa</DataTableHead><DataTableHead className="px-2">Actions</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{value.classes.map((item) => <DataTableRow key={item.classId}><th scope="row" className="px-2 py-2 text-left align-top"><Link className="font-bold text-brand hover:underline" to={classLink(item.classId, value.scope.date)}>{item.className}</Link><span className="block text-xs font-normal text-muted-foreground">{item.jenjang}</span></th><DataTableCell className="px-2">{expectationLabel(item.attendanceExpectation.status)}<span className="block text-xs text-muted-foreground">{item.attendanceExpectation.reason === "OUTSIDE_ACADEMIC_YEAR" ? "Outside academic year" : item.attendanceExpectation.reason ? item.attendanceExpectation.reason.replaceAll("_", " ") : item.attendanceExpectation.source === "WEEKDAY_RULE" ? "Weekday rule" : "No configured rule"}</span></DataTableCell><DataTableCell className="px-2"><span>{timingLabel(item.submissionTiming.status)}</span>{item.submissionTiming.deadlineLocalTime && <span className="block text-xs text-muted-foreground">{item.submissionTiming.deadlineLocalTime} Asia/Jakarta</span>}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.expectedStudentCount}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.recordedStudentCount}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.unrecordedStudentCount}</DataTableCell><DataTableCell className="px-2"><Badge variant={item.coverageState === "COMPLETE" ? "success" : item.coverageState === "PARTIAL" ? "warning" : "secondary"} className="rounded-sm px-2 whitespace-nowrap">{stateLabel(item.coverageState)}</Badge><span className="block text-xs text-muted-foreground">{item.coveragePercent === null ? "Not applicable" : `${item.coveragePercent}%`}</span></DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.counts.present}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.counts.late}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.counts.sakit}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.counts.izin}</DataTableCell><DataTableCell className="px-2 text-right tabular-nums">{item.counts.alfa}</DataTableCell><DataTableCell className="px-2"><div className="flex min-w-40 flex-col items-start gap-1">{can("enter_assigned_class_attendance") && <Link className="font-bold text-brand hover:underline" to={entryLink(item.classId, value.scope.date)}>{item.periodFinalized ? "Review attendance" : item.coverageState === "COMPLETE" ? "Review attendance" : "Continue attendance"}</Link>}<Link className="font-bold text-brand hover:underline" to={classLink(item.classId, value.scope.date)}>Open class</Link></div></DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer></Card>}
  </div>;
}
