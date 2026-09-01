import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";
import { useDailyAttendanceQuery } from "../hooks/useDailyAttendanceQuery";

const isoToday = () => new Date().toISOString().slice(0, 10);
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
  return <div className="space-y-7">
    <PageHeader eyebrow="Attendance Operations" title="Daily Attendance" description="Review attendance-recording coverage and calendar expectation for one selected date. These are separate descriptive states and do not establish a submission deadline." actions={<Button variant="outline" onClick={reset} className="gap-2"><RotateCcw className="size-4" aria-hidden="true" />Reset filters</Button>} />
    <Card><CardHeader><CardTitle>Scope</CardTitle><p className="text-sm text-muted-foreground">Coverage is based on active enrolled students and effective attendance records. Calendar expectation comes from the configured jenjang authority.</p></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><div><FieldLabel htmlFor="daily-date">Date</FieldLabel><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDateValue(shiftDate(date, -1))}><ArrowLeft className="size-4" aria-hidden="true" /></Button><input id="daily-date" type="date" value={date} onChange={(event) => setDateValue(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" /><Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDateValue(shiftDate(date, 1))}><ArrowRight className="size-4" aria-hidden="true" /></Button></div></div><div><FieldLabel htmlFor="daily-year">Academic year</FieldLabel><NativeSelect id="daily-year" value={selectedYear ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setJenjangId(null); setClassId(null); }}>{years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="daily-jenjang">Jenjang</FieldLabel><NativeSelect id="daily-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(Number(event.target.value) || null); setClassId(null); }}><option value="">All jenjang</option>{(filtersQuery.data?.jenjangs ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="daily-class">Class / Rombel</FieldLabel><NativeSelect id="daily-class" value={classId ?? ""} onChange={(event) => setClassId(Number(event.target.value) || null)}><option value="">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div><div className="flex items-end"><p className="text-sm text-muted-foreground">Selected: <strong>{value.scope.date}</strong><br />Calendar authority: available</p></div></div><p className="mt-4 text-sm text-muted-foreground">Calendar states: {value.totals.expectedClasses} expected · {value.totals.notExpectedClasses} not expected · {value.totals.unknownClasses} unavailable.</p></CardContent></Card>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Classes</p><p className="mt-2 text-3xl font-black">{number(value.totals.classes)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Complete</p><p className="mt-2 text-3xl font-black">{number(value.totals.completeClasses)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Partial</p><p className="mt-2 text-3xl font-black">{number(value.totals.partialClasses)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">No records</p><p className="mt-2 text-3xl font-black">{number(value.totals.noRecordClasses)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Recorded / expected</p><p className="mt-2 text-3xl font-black tabular-nums">{number(value.totals.recordedStudents)} / {number(value.totals.expectedStudents)}</p></CardContent></Card></div>
    {value.classes.length === 0 ? <EmptyState title="No classes in scope" description="No active classes match the selected filters." /> : <Card><CardHeader><CardTitle>Class coverage</CardTitle><p className="text-sm text-muted-foreground">Coverage and calendar expectation are shown independently for the selected date.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><caption className="sr-only">Daily attendance recording coverage and calendar expectation by class</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Class</th><th scope="col" className="px-2 py-3">Expectation</th><th scope="col" className="px-2 py-3">Students</th><th scope="col" className="px-2 py-3">Recorded</th><th scope="col" className="px-2 py-3">Unrecorded</th><th scope="col" className="px-2 py-3">Coverage</th><th scope="col" className="px-2 py-3">Present</th><th scope="col" className="px-2 py-3">Late</th><th scope="col" className="px-2 py-3">Sakit</th><th scope="col" className="px-2 py-3">Izin</th><th scope="col" className="px-2 py-3">Alfa</th><th scope="col" className="px-2 py-3">Actions</th></tr></thead><tbody>{value.classes.map((item) => <tr key={item.classId} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left"><Link className="font-bold text-brand hover:underline" to={classLink(item.classId, value.scope.date)}>{item.className}</Link><span className="block text-xs font-normal text-muted-foreground">{item.jenjang}</span></th><td className="px-2 py-3">{expectationLabel(item.attendanceExpectation.status)}<span className="block text-xs text-muted-foreground">{item.attendanceExpectation.reason === "OUTSIDE_ACADEMIC_YEAR" ? "Outside academic year" : item.attendanceExpectation.reason ? item.attendanceExpectation.reason.replaceAll("_", " ") : item.attendanceExpectation.source === "WEEKDAY_RULE" ? "Weekday rule" : "No configured rule"}</span></td><td className="px-2 py-3 tabular-nums">{item.expectedStudentCount}</td><td className="px-2 py-3 tabular-nums">{item.recordedStudentCount}</td><td className="px-2 py-3 tabular-nums">{item.unrecordedStudentCount}</td><td className="px-2 py-3"><span>{stateLabel(item.coverageState)}</span><span className="block text-xs text-muted-foreground">{item.coveragePercent === null ? "Not applicable" : `${item.coveragePercent}%`}</span></td><td className="px-2 py-3 tabular-nums">{item.counts.present}</td><td className="px-2 py-3 tabular-nums">{item.counts.late}</td><td className="px-2 py-3 tabular-nums">{item.counts.sakit}</td><td className="px-2 py-3 tabular-nums">{item.counts.izin}</td><td className="px-2 py-3 tabular-nums">{item.counts.alfa}</td><td className="px-2 py-3"><div className="flex min-w-40 flex-col items-start gap-1">{can("enter_assigned_class_attendance") && <Link className="font-bold text-brand hover:underline" to={entryLink(item.classId, value.scope.date)}>{item.periodFinalized ? "Review attendance" : item.coverageState === "COMPLETE" ? "Review attendance" : "Continue attendance"}</Link>}<Link className="font-bold text-brand hover:underline" to={classLink(item.classId, value.scope.date)}>Open class</Link></div></td></tr>)}</tbody></table></div></CardContent></Card>}
  </div>;
}
