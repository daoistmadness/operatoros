import { useEffect, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAuth } from "../context/AuthContext";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";
import StudentIndicatorInsights from "./StudentIndicatorInsights";
import StudentTrendInsights from "./StudentTrendInsights";

export type StudentInsightsScopeFilters = {
  academic_year_id: number | null;
  jenjang_id: number | null;
  class_id: number | null;
  window: "rolling_4w" | "term";
  search: string;
  student_id?: string;
};

function validId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function StudentInsights() {
  const { can } = useAuth();
  const allowed = can("view_student");
  const canAttendance = can("view_attendance");
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "indicators" ? "indicators" : "trends";
  const academicYearId = validId(params.get("academic_year_id"));
  const jenjangId = validId(params.get("jenjang_id"));
  const classId = validId(params.get("class_id"));
  const window = params.get("window") === "term" ? "term" : "rolling_4w";
  const search = params.get("search") ?? "";

  const filtersQuery = useAnalyticsFiltersQuery({}, allowed);
  const attendanceOptions = useAttendanceAnalyticsOptionsQuery(academicYearId, jenjangId, allowed && canAttendance);
  const academicOptions = useAcademicAnalyticsOptionsQuery(academicYearId, jenjangId, allowed);
  const years = filtersQuery.data?.academic_years ?? [];
  const classes = useMemo(() => {
    const primary = academicOptions.data?.classes ?? [];
    const known = new Set(primary.map((item) => item.id));
    return [...primary, ...(attendanceOptions.data?.classes ?? []).filter((item) => !known.has(item.id))];
  }, [academicOptions.data?.classes, attendanceOptions.data?.classes]);
  const jenjangs = filtersQuery.data?.jenjangs ?? academicOptions.data?.jenjangs ?? attendanceOptions.data?.jenjangs ?? [];

  useEffect(() => {
    if (params.has("view")) return;
    const next = new URLSearchParams(params);
    next.set("view", "trends");
    setParams(next, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    if (academicYearId !== null || years.length === 0) return;
    const next = new URLSearchParams(params);
    next.set("academic_year_id", String((years.find((year) => year.is_default) ?? years[0])!.id));
    setParams(next, { replace: true });
  }, [academicYearId, params, setParams, years]);
  useEffect(() => {
    if (classId === null || classes.some((item) => item.id === classId) || (!academicOptions.data && !attendanceOptions.data)) return;
    const next = new URLSearchParams(params);
    next.delete("class_id");
    setParams(next, { replace: true });
  }, [academicOptions.data, attendanceOptions.data, classId, classes, params, setParams]);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    for (const field of ["page", "sort", "order"]) next.delete(field);
    setParams(next, { replace: true });
  };
  const sharedFilters = useMemo(() => ({
    academic_year_id: academicYearId,
    jenjang_id: jenjangId,
    class_id: classId,
    window,
    search,
    student_id: params.get("student_id") ?? undefined,
  }), [academicYearId, classId, jenjangId, params, search, window]);
  const scopeError = (filtersQuery.error && !filtersQuery.data)
    || (academicOptions.error && !academicOptions.data && !attendanceOptions.data)
    || (canAttendance && attendanceOptions.error && !attendanceOptions.data && !academicOptions.data);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view student insights." />;
  if (scopeError) return <ErrorState title="Student Insights could not be loaded" description="The available analytics scope could not be loaded." action={<Button onClick={() => { void filtersQuery.refetch(); void attendanceOptions.refetch(); void academicOptions.refetch(); }}>Try again</Button>} />;

  return <main className="space-y-6 p-4 sm:p-6">
    <PageHeader title="Student Insights" description="Review Student trends over time and current measurable indicators." />
    <Card>
      <CardHeader><CardTitle>Shared filters</CardTitle><CardDescription>Comparison window means a date window. “Current Term Comparison” is not a configured Term ID.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-sm font-bold">Academic year<NativeSelect aria-label="Academic year" value={academicYearId ?? ""} disabled={filtersQuery.isPending || years.length === 0} onChange={(event) => { const next = new URLSearchParams(params); next.set("academic_year_id", event.target.value); next.delete("jenjang_id"); next.delete("class_id"); for (const field of ["page", "sort", "order"]) next.delete(field); setParams(next, { replace: true }); }}><option value="">{filtersQuery.isPending ? "Loading years…" : "Select year"}</option>{years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</NativeSelect></label>
        <label className="space-y-1 text-sm font-bold">Comparison window<NativeSelect aria-label="Comparison window" value={window} onChange={(event) => update("window", event.target.value)}><option value="rolling_4w">Rolling 4 Weeks</option><option value="term">Current Term Comparison</option></NativeSelect></label>
        <label className="space-y-1 text-sm font-bold">Jenjang<NativeSelect aria-label="Jenjang" value={jenjangId ?? ""} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set("jenjang_id", event.target.value); else next.delete("jenjang_id"); next.delete("class_id"); for (const field of ["page", "sort", "order"]) next.delete(field); setParams(next, { replace: true }); }}><option value="">All jenjang</option>{jenjangs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
        <label className="space-y-1 text-sm font-bold">Class<NativeSelect aria-label="Class" value={classId ?? ""} disabled={academicYearId === null} onChange={(event) => update("class_id", event.target.value || null)}><option value="">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
        <label className="space-y-1 text-sm font-bold">Student search<Input aria-label="Student search" value={search} onChange={(event) => update("search", event.target.value || null)} placeholder="Search name" /></label>
      </CardContent>
      {filtersQuery.isPending && <LoadingState title="Loading filters" description="Preparing academic year and jenjang options." />}
      {!filtersQuery.isPending && years.length === 0 && <EmptyState title="No academic year is configured" description="Configure an academic year before opening Student Insights." />}
    </Card>
    {academicYearId !== null && <Tabs value={view} onValueChange={(value) => {
      const next = new URLSearchParams(params);
      next.set("view", value);
      for (const field of ["page", "sort", "order"]) next.delete(field);
      setParams(next, { replace: false });
    }}>
      <TabsList aria-label="Student Insights views"><TabsTrigger value="trends">Trends</TabsTrigger><TabsTrigger value="indicators">Indicators</TabsTrigger></TabsList>
      <TabsContent value="trends"><StudentTrendInsights filters={sharedFilters as StudentInsightsScopeFilters} enabled={view === "trends"} /></TabsContent>
      <TabsContent value="indicators"><StudentIndicatorInsights filters={sharedFilters as StudentInsightsScopeFilters} enabled={view === "indicators"} /></TabsContent>
    </Tabs>}
  </main>;
}

export function StudentTrendsCompatibilityRedirect() {
  return <StudentInsightsCompatibilityRedirect view="trends" />;
}

export function StudentIndicatorsCompatibilityRedirect() {
  return <StudentInsightsCompatibilityRedirect view="indicators" />;
}

function StudentInsightsCompatibilityRedirect({ view }: { view: "trends" | "indicators" }) {
  const [params] = useSearchParams();
  const query = new URLSearchParams(params);
  query.set("view", view);
  return <NavigateWithQuery query={query} />;
}

function NavigateWithQuery({ query }: { query: URLSearchParams }) {
  return <Navigate to={`/analytics/student-insights?${query.toString()}`} replace />;
}
