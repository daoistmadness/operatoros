import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { StudentIndicatorInsightsResponse, StudentIndicatorValue } from "@operatoros/contracts/analytics";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery, useStudentIndicatorInsightsQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import type { StudentIndicatorFilters } from "../api/studentIndicators";

type Sort = NonNullable<StudentIndicatorFilters["sort"]>;
type Row = StudentIndicatorInsightsResponse["rows"][number];

function id(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function format(metric: StudentIndicatorValue, academic = false): string {
  if (metric.current === null) return "No data";
  const current = metric.unit === "percent" ? `${metric.current.toFixed(2)}%` : metric.current.toFixed(1);
  if (metric.previous === null) return `${current} · ${academic ? "Academic trend unavailable" : "Insufficient comparison data"}`;
  const previous = metric.unit === "percent" ? `${metric.previous.toFixed(2)}%` : metric.previous.toFixed(1);
  const delta = metric.unit === "percent" ? `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(2)} pp` : `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(1)}`;
  return `${previous} → ${current} (${delta})`;
}

function MetricCell({ metric, academic = false }: { metric: StudentIndicatorValue | null; academic?: boolean }) {
  if (!metric) return <span>Unavailable</span>;
  return <span className="whitespace-nowrap" title={`Current sample ${metric.currentSampleSize}; previous sample ${metric.previousSampleSize}`}>{format(metric, academic)}</span>;
}

export default function StudentIndicatorInsights() {
  const { can } = useAuth();
  const allowed = can("view_student");
  const [searchParams, setSearchParams] = useSearchParams();
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => id(searchParams.get("academic_year_id")));
  const [jenjangId, setJenjangId] = useState<number | null>(() => id(searchParams.get("jenjang_id")));
  const [classId, setClassId] = useState<number | null>(() => id(searchParams.get("class_id")));
  const [window, setWindow] = useState<"rolling_4w" | "term">(searchParams.get("window") === "term" ? "term" : "rolling_4w");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [sort, setSort] = useState<Sort>((searchParams.get("sort") as Sort) || "name");
  const [order, setOrder] = useState<"asc" | "desc">(searchParams.get("order") === "desc" ? "desc" : "asc");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const filtersQuery = useAnalyticsFiltersQuery({}, allowed);
  const attendanceOptions = useAttendanceAnalyticsOptionsQuery(academicYearId, jenjangId, can("view_attendance"));
  const academicOptions = useAcademicAnalyticsOptionsQuery(academicYearId, jenjangId, allowed);
  const years = filtersQuery.data?.academic_years ?? [];
  const classes = academicOptions.data?.classes ?? attendanceOptions.data?.classes ?? [];
  const jenjangs = filtersQuery.data?.jenjangs ?? academicOptions.data?.jenjangs ?? attendanceOptions.data?.jenjangs ?? [];

  useEffect(() => { if (academicYearId === null) setAcademicYearId((years.find((item) => item.is_default) ?? years[0])?.id ?? null); }, [academicYearId, years]);
  useEffect(() => { if (classId !== null && !classes.some((item) => item.id === classId)) setClassId(null); }, [classId, classes]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (academicYearId !== null) next.set("academic_year_id", String(academicYearId));
    if (jenjangId !== null) next.set("jenjang_id", String(jenjangId));
    if (classId !== null) next.set("class_id", String(classId));
    next.set("window", window);
    if (search) next.set("search", search);
    if (sort !== "name") next.set("sort", sort);
    if (order !== "asc") next.set("order", order);
    if (page > 1) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [academicYearId, classId, jenjangId, order, page, search, setSearchParams, sort, window]);

  const filters = useMemo<StudentIndicatorFilters | null>(() => academicYearId === null ? null : { window, academic_year_id: academicYearId, jenjang_id: jenjangId, class_id: classId, search, sort, order, page, page_size: 25 }, [academicYearId, classId, jenjangId, order, page, search, sort, window]);
  const query = useStudentIndicatorInsightsQuery(filters, allowed);
  const toggleSort = (next: Sort) => { if (sort === next) setOrder((value) => value === "asc" ? "desc" : "asc"); else { setSort(next); setOrder("desc"); } setPage(1); };

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view student indicators." />;
  if (filtersQuery.isPending || (academicYearId !== null && academicOptions.isPending)) return <LoadingState title="Loading student indicators" description="Preparing the available scope." />;
  if (filtersQuery.error || academicOptions.error || attendanceOptions.error) return <ErrorState title="Student indicators could not be loaded" description="The available analytics scope could not be loaded." />;
  if (years.length === 0) return <EmptyState title="No academic year is configured" description="Configure an academic year before opening student indicators." />;
  if (query.error) return <ErrorState title="Student indicators could not be loaded" description="The server could not load the selected measurements." action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />;
  if (query.isPending || !query.data) return <LoadingState title="Loading student indicators" description="Reading canonical attendance and academic measurements." />;
  const response = query.data;

  return <main className="space-y-6 p-4 sm:p-6" aria-busy={query.isFetching}>
    <PageHeader title="Student Indicators" description="Observable attendance and academic measurements for staff review. These values are not automatic classifications." actions={<Link className="text-sm font-bold text-brand hover:underline" to={`/analytics/trends?academic_year_id=${response.scope.academicYearId}&window=${response.window.kind}`}>View Student Trends</Link>} />
    <Card><CardHeader><CardTitle>Scope</CardTitle><CardDescription>Compare attendance windows and view current academic measurements.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <label className="space-y-1 text-sm font-bold">Academic year<NativeSelect value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setPage(1); }}><option value="">Select year</option>{years.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></label>
      <label className="space-y-1 text-sm font-bold">Window<NativeSelect value={window} onChange={(event) => { setWindow(event.target.value as "rolling_4w" | "term"); setPage(1); }}><option value="rolling_4w">Rolling 4 Weeks</option><option value="term">Current Term</option></NativeSelect></label>
      <label className="space-y-1 text-sm font-bold">Jenjang<NativeSelect value={jenjangId ?? ""} onChange={(event) => { setJenjangId(event.target.value ? Number(event.target.value) : null); setClassId(null); setPage(1); }}><option value="">All jenjang</option>{jenjangs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label className="space-y-1 text-sm font-bold">Class<NativeSelect value={classId ?? ""} onChange={(event) => { setClassId(event.target.value ? Number(event.target.value) : null); setPage(1); }}><option value="">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label className="space-y-1 text-sm font-bold">Student search<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name" /></label>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Candidate measurements</CardTitle><CardDescription>{response.window.currentStart} to {response.window.currentEnd}. Previous comparison: {response.window.previousStart ? `${response.window.previousStart} to ${response.window.previousEnd}` : "not available"}.</CardDescription></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-sm"><caption className="sr-only">Student observable attendance and academic measurements</caption><thead><tr className="border-b text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("name")}>Student</button></th><th className="p-3">Class</th><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("attendance_rate")}>Attendance</button></th><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("tardiness_rate")}>Tardiness</button></th><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("alfa_rate")}>Alfa</button></th><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("academic_average")}>Academic average</button></th><th className="p-3"><button className="font-black hover:underline" onClick={() => toggleSort("academic_participation")}>Participation</button></th></tr></thead><tbody>{response.rows.map((row: Row) => <tr key={row.studentId} className="border-b border-border/70"><th scope="row" className="p-3 font-bold"><Link className="hover:underline" to={`/students/${row.studentId}`}>{row.studentName}</Link></th><td className="p-3">{row.className ?? "Unassigned"}</td><td className="p-3"><MetricCell metric={row.attendanceRate} /></td><td className="p-3"><MetricCell metric={row.tardinessRate} /></td><td className="p-3"><MetricCell metric={row.alfaRate} /></td><td className="p-3"><MetricCell metric={row.academicAverage} academic /></td><td className="p-3"><MetricCell metric={row.academicParticipation} academic /></td></tr>)}</tbody></table></div>
      {response.rows.length === 0 && <EmptyState className="mt-4" title="No students in this scope" description="Adjust the filters or select another academic year." />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-muted-foreground"><span>{response.totalStudents} students · Page {response.page}</span><div className="flex gap-2"><Button variant="outline" disabled={response.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button variant="outline" disabled={response.rows.length < response.pageSize} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Interpretation notes</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">{response.limitations.map((item) => <li key={item}>{item}</li>)}</ul></CardContent></Card>
  </main>;
}
