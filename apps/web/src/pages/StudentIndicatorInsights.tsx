import { Link, useSearchParams } from "react-router-dom";
import type { StudentIndicatorValue } from "@operatoros/contracts/analytics";
import { Button } from "../components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { useStudentIndicatorInsightsQuery } from "../hooks/useAnalyticsQueries";
import type { StudentInsightsScopeFilters } from "./StudentInsights";
import type { StudentIndicatorFilters } from "../api/studentIndicators";

type Props = { filters: StudentInsightsScopeFilters; enabled: boolean };
type Sort = NonNullable<StudentIndicatorFilters["sort"]>;

function value(metric: StudentIndicatorValue | null): string {
  if (!metric || metric.current === null) return "Not available";
  return metric.unit === "percent" ? `${metric.current.toFixed(2)}%` : metric.current.toFixed(1);
}

export default function StudentIndicatorInsights({ filters, enabled }: Props) {
  const [params, setParams] = useSearchParams();
  const sortValue = params.get("sort") as Sort | null;
  const sort: Sort = sortValue && ["name", "attendance_rate", "tardiness_rate", "alfa_rate", "academic_average", "academic_participation"].includes(sortValue) ? sortValue : "name";
  const order = params.get("order") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const queryFilters: StudentIndicatorFilters | null = filters.academic_year_id === null ? null : {
    ...filters, academic_year_id: filters.academic_year_id, sort, order, page, page_size: 25,
  };
  const query = useStudentIndicatorInsightsQuery(queryFilters, enabled);
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
  const heading = (label: string, key: Sort) => <button className="font-bold hover:underline" onClick={() => toggleSort(key)}>{label}</button>;

  if (query.error) return <ErrorState title="Indicators could not be loaded" description="The server could not load the current measurements." action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />;
  if (query.isPending || !query.data) return <LoadingState title="Loading indicators" description="Reading measurements for the selected period." />;
  const data = query.data;
  const pageCount = Math.max(1, Math.ceil(data.totalStudents / data.pageSize));
  return <div aria-busy={query.isFetching} className="space-y-4">
    <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-bold">Current measurements</h2><p className="mt-1 text-sm text-muted-foreground">{data.window.currentStart}–{data.window.currentEnd}. These are observations, not student classifications.</p></section>
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4"><table className="min-w-[900px] w-full text-left text-sm"><caption className="sr-only">Current student measurements</caption><thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="p-3">{heading("Student", "name")}</th><th scope="col" className="p-3">Class</th><th scope="col" className="p-3">{heading("Attendance Rate", "attendance_rate")}</th><th scope="col" className="p-3">{heading("Late Event Rate", "tardiness_rate")}</th><th scope="col" className="p-3">{heading("Alfa Rate", "alfa_rate")}</th><th scope="col" className="p-3">{heading("Academic average", "academic_average")}</th><th scope="col" className="p-3">{heading("Academic participation", "academic_participation")}</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.studentId} className="border-b border-border/70"><th scope="row" className="p-3 text-left font-bold"><Link className="hover:underline" to={`/students/${row.studentId}`}>{row.studentName}</Link></th><td className="p-3">{row.className ?? "Unassigned"}</td><td className="p-3">{value(row.attendanceRate)}</td><td className="p-3">{value(row.tardinessRate)}</td><td className="p-3">{value(row.alfaRate)}</td><td className="p-3">{value(row.academicAverage)}</td><td className="p-3">{value(row.academicParticipation)}</td></tr>)}</tbody></table>
      {data.rows.length === 0 && <EmptyState className="mt-4" title="No students match the selected filters" description="Adjust the filters or select another academic year." />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>{data.totalStudents} students · Page {page} of {pageCount}</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setTableState({ page: page - 1 })}>Previous</Button><Button variant="outline" disabled={page >= pageCount || query.isFetching} onClick={() => setTableState({ page: page + 1 })}>Next</Button></div></div>
    </div>
    {data.limitations.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul>}
  </div>;
}
