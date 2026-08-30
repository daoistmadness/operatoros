import { useEffect, useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";
import type { StudentTrendInsightsResponse, StudentTrendMetric } from "@operatoros/contracts/analytics";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery, useStudentTrendInsightsQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import type { StudentTrendFilters } from "../api/studentTrends";

type Sort = NonNullable<StudentTrendFilters["sort"]>;
type TrendRow = StudentTrendInsightsResponse["rows"][number];
const column = createColumnHelper<TrendRow>();

function id(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function metricValue(metric: StudentTrendMetric | null, empty = "Insufficient comparison data") {
  if (!metric || metric.current === null || metric.previous === null) return empty;
  const format = metric.unit === "percent" ? (value: number) => `${value.toFixed(2)}%` : (value: number) => value.toFixed(1);
  const delta = metric.unit === "percent" ? `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(2)} pp` : `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(1)}`;
  return `${format(metric.previous)} → ${format(metric.current)} (${delta})`;
}

function MetricCell({ metric }: { metric: StudentTrendMetric | null }) {
  return <span className="whitespace-nowrap" title={metric ? `Current sample ${metric.currentSampleSize}; previous sample ${metric.previousSampleSize}` : undefined}>{metricValue(metric)}</span>;
}

export default function StudentTrendInsights() {
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
  const classes = attendanceOptions.data?.classes ?? academicOptions.data?.classes ?? [];
  const jenjangs = filtersQuery.data?.jenjangs ?? attendanceOptions.data?.jenjangs ?? academicOptions.data?.jenjangs ?? [];

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

  const filters = useMemo<StudentTrendFilters | null>(() => academicYearId === null ? null : { window, academic_year_id: academicYearId, jenjang_id: jenjangId, class_id: classId, search, sort, order, page, page_size: 25 }, [academicYearId, classId, jenjangId, order, page, search, sort, window]);
  const trendQuery = useStudentTrendInsightsQuery(filters, allowed);
  const toggleSort = (next: Sort) => { if (sort === next) setOrder((value) => value === "asc" ? "desc" : "asc"); else { setSort(next); setOrder("asc"); } setPage(1); };
  const columns = useMemo(() => [
    column.accessor("studentName", { header: () => <button onClick={() => toggleSort("name")} className="font-black underline-offset-4 hover:underline">Student</button>, cell: ({ row }) => <Link className="font-black text-brand hover:underline" to={`/students/${row.original.studentId}`}>{row.original.studentName}</Link> }),
    column.accessor("className", { header: "Class", cell: (info) => info.getValue() ?? "Unassigned" }),
    column.accessor("attendance", { header: () => <button onClick={() => toggleSort("attendance_delta")} className="font-black underline-offset-4 hover:underline">Attendance</button>, cell: (info) => <MetricCell metric={info.getValue()} /> }),
    column.accessor("academic", { header: () => <button onClick={() => toggleSort("academic_delta")} className="font-black underline-offset-4 hover:underline">Academic</button>, cell: (info) => <MetricCell metric={info.getValue()} /> }),
    column.accessor("tardiness", { header: () => <button onClick={() => toggleSort("tardiness_delta")} className="font-black underline-offset-4 hover:underline">Tardiness</button>, cell: (info) => <MetricCell metric={info.getValue()} /> }),
    column.accessor("alfa", { header: () => <button onClick={() => toggleSort("alfa_delta")} className="font-black underline-offset-4 hover:underline">Alfa</button>, cell: (info) => <MetricCell metric={info.getValue()} /> }),
  ], [order, sort]);
  const table = useReactTable({ data: trendQuery.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true });
  const pageCount = Math.max(1, Math.ceil((trendQuery.data?.totalStudents ?? 0) / (trendQuery.data?.pageSize ?? 25)));

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view student trends." />;
  if (filtersQuery.isPending || (academicYearId !== null && attendanceOptions.isPending && can("view_attendance"))) return <LoadingState title="Loading student trends" description="Preparing the available scope." />;
  if (filtersQuery.error || attendanceOptions.error || academicOptions.error) return <ErrorState title="Student trends could not be loaded" description="The available analytics scope could not be loaded." />;
  if (years.length === 0) return <EmptyState title="No academic year is configured" description="Configure an academic year before opening trends." />;
  if (trendQuery.error) return <ErrorState title="Student trends could not be loaded" description="The server could not load this comparison." action={<Button onClick={() => { void trendQuery.refetch(); }}>Try again</Button>} />;
  if (trendQuery.isPending || !trendQuery.data) return <LoadingState title="Loading student trends" description="Comparing canonical attendance and academic periods." />;
  const data = trendQuery.data;
  return <div className="space-y-7">
    <PageHeader eyebrow="Management Analytics" title="Student Trends" description="Descriptive changes between comparable periods. The values do not classify students." actions={<Link className="text-sm font-bold text-brand hover:underline" to={`/analytics/indicators?academic_year_id=${data.scope.academicYearId}&window=${data.window.kind}`}>View Student Indicators</Link>} />
    <Card><CardHeader><CardTitle>Comparison scope</CardTitle><p className="text-sm text-muted-foreground">Attendance windows use calendar dates. Academic scores are shown as insufficient because canonical grade rows have no date or term field.</p></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <div><FieldLabel htmlFor="trend-window">Window</FieldLabel><NativeSelect id="trend-window" value={window} onChange={(event) => { setWindow(event.target.value as typeof window); setPage(1); }}><option value="rolling_4w">Rolling 4 Weeks</option><option value="term">Current Term</option></NativeSelect></div>
      <div><FieldLabel htmlFor="trend-year">Academic year</FieldLabel><NativeSelect id="trend-year" value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setJenjangId(null); setClassId(null); setPage(1); }}>{years.map((year) => <option value={year.id} key={year.id}>{year.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="trend-jenjang">Jenjang</FieldLabel><NativeSelect id="trend-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(event.target.value ? Number(event.target.value) : null); setClassId(null); setPage(1); }}><option value="">All jenjang</option>{jenjangs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="trend-class">Class / Rombel</FieldLabel><NativeSelect id="trend-class" value={classId ?? ""} onChange={(event) => { setClassId(event.target.value ? Number(event.target.value) : null); setPage(1); }}><option value="">All classes</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="trend-search">Search student</FieldLabel><Input id="trend-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Student name" /></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Period comparison</CardTitle><p className="text-sm text-muted-foreground">{data.window.currentStart} – {data.window.currentEnd} compared with {data.window.previousStart && data.window.previousEnd ? `${data.window.previousStart} – ${data.window.previousEnd}` : "no previous period"}. Samples are available from each metric header.</p></CardHeader><CardContent>{data.rows.length === 0 ? <EmptyState title="No students found" description="No canonical students match this scope." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Student trend comparison</caption><thead><tr className="border-b border-border text-left">{table.getHeaderGroups().flatMap((group) => group.headers).map((header) => <th scope="col" className="py-3 pr-5" key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr className="border-b border-border" key={row.id}>{row.getVisibleCells().map((cell) => <td className="py-3 pr-5" key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {data.totalStudents} students</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || trendQuery.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" disabled={page >= pageCount || trendQuery.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Reading the comparison</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground"><li>Positive and negative values show arithmetic direction only.</li><li>Missing previous values show as insufficient comparison data.</li><li>Academic trend comparison requires a canonical dated or term-linked score source.</li></ul></CardContent></Card>
  </div>;
}
