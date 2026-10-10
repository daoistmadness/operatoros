import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table";
import type { StudentTrendInsightsResponse, StudentTrendMetric } from "@operatoros/contracts/analytics";
import { Button } from "../components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { useStudentTrendInsightsQuery } from "../hooks/useAnalyticsQueries";
import type { StudentInsightsScopeFilters } from "./StudentInsights";
import type { StudentTrendFilters } from "../api/studentTrends";

type Props = { filters: StudentInsightsScopeFilters; enabled: boolean };
type Sort = NonNullable<StudentTrendFilters["sort"]>;
type Row = StudentTrendInsightsResponse["rows"][number];
const column = createColumnHelper<Row>();

function metricText(metric: StudentTrendMetric | null): string {
  if (!metric) return "Unavailable";
  if (metric.current === null) return "Not available";
  const current = metric.unit === "percent" ? `${metric.current.toFixed(2)}%` : metric.current.toFixed(1);
  if (metric.previous === null) return `${current} · Insufficient comparison data`;
  const previous = metric.unit === "percent" ? `${metric.previous.toFixed(2)}%` : metric.previous.toFixed(1);
  const delta = metric.unit === "percent" ? `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(2)} pp` : `${metric.delta! > 0 ? "+" : ""}${metric.delta!.toFixed(1)}`;
  return `${previous} → ${current} (${delta})`;
}

function attendanceSampleText(metric: StudentTrendMetric | null, hasPreviousWindow: boolean): string | null {
  if (!metric || metric.currentRecordedStudentDays === undefined || metric.previousRecordedStudentDays === undefined) return null;
  const previous = hasPreviousWindow ? `${metric.previousRecordedStudentDays}/${metric.previousSampleSize} previous` : "no previous period";
  return `Attendance rows: ${metric.currentRecordedStudentDays}/${metric.currentSampleSize} expected Student-Days current, ${previous}`;
}

function academicSampleText(metric: StudentTrendMetric): string {
  return `Scored results: ${metric.currentSampleSize} current, ${metric.previousSampleSize} previous`;
}

export default function StudentTrendInsights({ filters, enabled }: Props) {
  const [params, setParams] = useSearchParams();
  const sortValue = params.get("sort") as Sort | null;
  const sort: Sort = sortValue && ["name", "attendance_delta", "academic_delta", "tardiness_delta", "alfa_delta"].includes(sortValue) ? sortValue : "name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const trendFilters: StudentTrendFilters | null = filters.academic_year_id === null ? null : {
    ...filters, academic_year_id: filters.academic_year_id, sort, order, page, page_size: 25,
  };
  const query = useStudentTrendInsightsQuery(trendFilters, enabled);
  const hasPreviousWindow = query.data?.window.previousStart !== null && query.data?.window.previousStart !== undefined;
  const setTableState = (next: { sort?: Sort; order?: "asc" | "desc"; page?: number }) => {
    const updated = new URLSearchParams(params);
    if (next.sort) updated.set("sort", next.sort);
    if (next.order) updated.set("order", next.order);
    if (next.page !== undefined) {
      if (next.page <= 1) updated.delete("page"); else updated.set("page", String(next.page));
    }
    setParams(updated, { replace: true });
  };
  const toggleSort = (next: Sort) => setTableState({ sort: next, order: sort === next && order === "asc" ? "desc" : "asc", page: 1 });
  const columns = useMemo(() => [
    column.accessor("studentName", { header: () => <button onClick={() => toggleSort("name")}>Student</button>, cell: ({ row }) => <Link className="font-bold text-brand hover:underline" to={`/students/${row.original.studentId}`}>{row.original.studentName}</Link> }),
    column.accessor("className", { header: "Class", cell: (info) => info.getValue() ?? "Unassigned" }),
    column.accessor("attendance", { header: () => <button onClick={() => toggleSort("attendance_delta")}>Attendance Rate change</button>, cell: (info) => <div>{metricText(info.getValue())}<p className="text-xs text-muted-foreground">{attendanceSampleText(info.getValue(), hasPreviousWindow)}</p></div> }),
    column.accessor("academic", { header: () => <button onClick={() => toggleSort("academic_delta")}>Academic change</button>, cell: (info) => <div>{metricText(info.getValue())}<p className="text-xs text-muted-foreground">{academicSampleText(info.getValue())}</p></div> }),
    column.accessor("tardiness", { header: () => <button onClick={() => toggleSort("tardiness_delta")}>Late Event Rate change</button>, cell: (info) => <div>{metricText(info.getValue())}<p className="text-xs text-muted-foreground">{attendanceSampleText(info.getValue(), hasPreviousWindow)}</p></div> }),
    column.accessor("alfa", { header: () => <button onClick={() => toggleSort("alfa_delta")}>Alfa Rate change</button>, cell: (info) => <div>{metricText(info.getValue())}<p className="text-xs text-muted-foreground">{attendanceSampleText(info.getValue(), hasPreviousWindow)}</p></div> }),
  ], [hasPreviousWindow, order, sort]);
  const table = useReactTable({ data: query.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true });

  if (query.error) return <ErrorState title="Trends could not be loaded" description="The server could not load this period comparison." action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />;
  if (query.isPending || !query.data) return <LoadingState title="Loading trends" description="Comparing the selected periods." />;
  const data = query.data;
  const pageCount = Math.max(1, Math.ceil(data.totalStudents / data.pageSize));
  return <div aria-busy={query.isFetching} className="space-y-4">
    <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-bold">Period comparison</h2><p className="mt-1 text-sm text-muted-foreground">{data.window.currentStart}–{data.window.currentEnd} compared with {data.window.previousStart && data.window.previousEnd ? `${data.window.previousStart}–${data.window.previousEnd}` : "no previous period"}. Attendance deltas are percentage-point changes.</p><p className="mt-1 text-sm text-muted-foreground">Academic change compares the latest observed grading period with its preceding period; it is not aligned to these attendance dates.</p></section>
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4"><table className="w-full text-left text-sm"><caption className="sr-only">Student trends by period comparison</caption><thead><tr className="border-b border-border text-muted-foreground">{table.getHeaderGroups().flatMap((group) => group.headers).map((header) => <th scope="col" className="py-3 pr-5" key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr className="border-b border-border" key={row.id}>{row.getVisibleCells().map((cell) => <td className="py-3 pr-5" key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>
      {data.rows.length === 0 && <EmptyState className="mt-4" title="No students match the selected filters" description="Adjust the filters or select another academic year." />}
      <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {data.totalStudents} students</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setTableState({ page: page - 1 })}>Previous</Button><Button variant="outline" disabled={page >= pageCount || query.isFetching} onClick={() => setTableState({ page: page + 1 })}>Next</Button></div></div>
    </div>
    <p className="text-sm text-muted-foreground">Direction describes the calculated change only. Missing period values remain unavailable.</p>
  </div>;
}
