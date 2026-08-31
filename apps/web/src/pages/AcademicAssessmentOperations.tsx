import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import { useAssessmentOperationsQuery } from "../hooks/useAssessmentOperationsQuery";
import type { AssessmentOperationsFilters } from "../api/grades";

type SortKey = NonNullable<AssessmentOperationsFilters["sort"]>;
type Order = "asc" | "desc";
type Coverage = NonNullable<AssessmentOperationsFilters["coverage_state"]>;

const number = (value: number) => value.toLocaleString();
const queryId = (value: string | null) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; };

function stateLabel(value: string): string {
  return value === "NONE" ? "No scores" : value === "EMPTY" ? "No applicable students" : value[0] + value.slice(1).toLowerCase();
}

function linkWith(path: string, params: Record<string, string | number | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== null && value !== "") query.set(key, String(value)); });
  return `${path}?${query}`;
}

export default function AcademicAssessmentOperations() {
  const { user } = useAuth();
  const allowed = user?.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => queryId(searchParams.get("academic_year_id")));
  const [term, setTerm] = useState<AssessmentOperationsFilters["term"]>(() => (searchParams.get("term") as AssessmentOperationsFilters["term"]) ?? null);
  const [classId, setClassId] = useState<number | null>(() => queryId(searchParams.get("class_id")));
  const [subjectId, setSubjectId] = useState<number | null>(() => queryId(searchParams.get("subject_id")));
  const [coverageState, setCoverageState] = useState<Coverage>(() => (searchParams.get("coverage_state") as Coverage) || "ALL");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [sort, setSort] = useState<SortKey>((searchParams.get("sort") as SortKey) || "assessment_date");
  const [order, setOrder] = useState<Order>(searchParams.get("order") === "desc" ? "desc" : "asc");
  const [page, setPage] = useState(Number(searchParams.get("page")) > 0 ? Number(searchParams.get("page")) : 1);
  const filtersQuery = useAnalyticsFiltersQuery({}, allowed);
  const years = filtersQuery.data?.academic_years ?? [];
  const selectedYear = academicYearId ?? (years.find((value) => value.is_default) ?? years[0])?.id ?? null;
  const options = useAcademicAnalyticsOptionsQuery(selectedYear, null, allowed);
  const classes = options.data?.classes ?? [];
  const subjects = options.data?.subjects ?? [];
  const filters = useMemo<AssessmentOperationsFilters | null>(() => selectedYear === null ? null : ({
    academic_year_id: selectedYear, term, class_id: classId, subject_id: subjectId,
    coverage_state: coverageState, search, sort, order, page, page_size: 25,
  }), [classId, coverageState, order, page, search, selectedYear, sort, subjectId, term]);
  const operations = useAssessmentOperationsQuery(filters, allowed);

  useEffect(() => { if (academicYearId === null && selectedYear !== null) setAcademicYearId(selectedYear); }, [academicYearId, selectedYear]);
  useEffect(() => { if (classId !== null && options.data && !classes.some((value) => value.id === classId)) setClassId(null); }, [classId, classes, options.data]);
  useEffect(() => { if (subjectId !== null && options.data && !subjects.some((value) => value.id === subjectId)) setSubjectId(null); }, [options.data, subjectId, subjects]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedYear !== null) next.set("academic_year_id", String(selectedYear));
    if (term) next.set("term", term);
    if (classId !== null) next.set("class_id", String(classId));
    if (subjectId !== null) next.set("subject_id", String(subjectId));
    if (coverageState !== "ALL") next.set("coverage_state", coverageState);
    if (search) next.set("search", search);
    if (sort !== "assessment_date") next.set("sort", sort);
    if (order !== "asc") next.set("order", order);
    if (page > 1) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [classId, coverageState, order, page, search, selectedYear, setSearchParams, sort, subjectId, term]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Assessment operations are available to administrators with the current grade-entry authority." />;
  if (filtersQuery.isPending || options.isPending) return <LoadingState title="Loading assessment operations" description="Preparing academic sessions and filters." />;
  if (filtersQuery.error || options.error) return <ErrorState title="Assessment operations unavailable" description="The academic filter options could not be loaded." action={<Button onClick={() => { void filtersQuery.refetch(); void options.refetch(); }}>Try again</Button>} />;
  if (years.length === 0) return <SetupRequiredState title="Academic setup required" description="Add an academic year before opening assessment operations." />;
  if (!filters || operations.isPending) return <LoadingState title="Loading assessment operations" description="Computing score-entry coverage on the server." />;
  if (operations.error) return <ErrorState title="Assessment operations unavailable" description="The server could not calculate this academic scope." action={<Button onClick={() => void operations.refetch()}>Try again</Button>} />;
  if (!operations.data) return <LoadingState title="Loading assessment operations" description="Computing score-entry coverage on the server." />;

  const data = operations.data;
  const pageCount = Math.max(1, Math.ceil(data.total / data.page_size));
  const reset = () => { setAcademicYearId((years.find((value) => value.is_default) ?? years[0])?.id ?? null); setTerm(null); setClassId(null); setSubjectId(null); setCoverageState("ALL"); setSearch(""); setSort("assessment_date"); setOrder("asc"); setPage(1); };
  const toggleSort = (next: SortKey) => { if (sort === next) setOrder((value) => value === "asc" ? "desc" : "asc"); else { setSort(next); setOrder("asc"); } setPage(1); };
  const sortButton = (label: string, key: SortKey) => <button type="button" className="inline-flex items-center gap-1 font-black underline-offset-4 hover:underline" onClick={() => toggleSort(key)}>{label}{sort === key && (order === "asc" ? <ArrowUp className="size-3" aria-label="ascending" /> : <ArrowDown className="size-3" aria-label="descending" />)}</button>;
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Academic Operations" title="Assessment Operations" description="Review score-entry coverage for canonical assessment sessions. Coverage describes recorded score presence only; it does not indicate failure, overdue work, or academic concern." actions={<Button variant="outline" onClick={reset} className="gap-2"><RotateCcw className="size-4" aria-hidden="true" />Reset filters</Button>} />
    <Card><CardHeader><CardTitle>Scope</CardTitle><p className="text-sm text-muted-foreground">Only session-backed assessments are shown. Legacy scores with unknown period attribution are excluded, and an absent assessment date is not replaced with a creation timestamp.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
      <div><FieldLabel htmlFor="assessment-year">Academic year</FieldLabel><NativeSelect id="assessment-year" value={selectedYear ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setTerm(null); setClassId(null); setSubjectId(null); setPage(1); }}><option value="">Select year</option>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="assessment-term">Term</FieldLabel><NativeSelect id="assessment-term" value={term ?? ""} onChange={(event) => { setTerm((event.target.value || null) as AssessmentOperationsFilters["term"]); setPage(1); }}><option value="">All terms</option>{[1, 2, 3, 4].map((value) => <option key={value} value={`term_${value}`}>Term {value}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="assessment-class">Class / Rombel</FieldLabel><NativeSelect id="assessment-class" value={classId ?? ""} onChange={(event) => { setClassId(Number(event.target.value) || null); setPage(1); }}><option value="">All classes</option>{classes.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="assessment-subject">Subject</FieldLabel><NativeSelect id="assessment-subject" value={subjectId ?? ""} onChange={(event) => { setSubjectId(Number(event.target.value) || null); setPage(1); }}><option value="">All subjects</option>{subjects.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="assessment-coverage">Coverage</FieldLabel><NativeSelect id="assessment-coverage" value={coverageState} onChange={(event) => { setCoverageState(event.target.value as Coverage); setPage(1); }}><option value="ALL">All states</option><option value="COMPLETE">Complete</option><option value="PARTIAL">Partial</option><option value="NONE">No scores</option><option value="EMPTY">No applicable students</option></NativeSelect></div>
      <div><FieldLabel htmlFor="assessment-search">Search session</FieldLabel><Input id="assessment-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Assessment, class, subject" /></div>
    </div></CardContent></Card>
    <section aria-label="Assessment coverage summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Summary label="Assessment sessions" value={number(data.totals.assessment_sessions)} /><Summary label="Complete scopes" value={number(data.totals.complete_scopes)} /><Summary label="Partial scopes" value={number(data.totals.partial_scopes)} /><Summary label="No-score scopes" value={number(data.totals.no_score_scopes)} /><Summary label="Recorded / applicable" value={`${number(data.totals.recorded_scores)} / ${number(data.totals.applicable_students)}`} /></section>
    <Card><CardHeader><CardTitle>Score-entry coverage</CardTitle><p className="text-sm text-muted-foreground">A row represents one assessment session, class, and subject scope because the current session authority does not store class or subject ownership.</p></CardHeader><CardContent>{data.sessions.length === 0 ? <EmptyState title="No assessment scopes found" description="No session-backed assessments match the selected filters." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><caption className="sr-only">Assessment score-entry coverage</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">{sortButton("Assessment", "assessment")}</th><th scope="col" className="px-2 py-3">{sortButton("Subject", "subject")}</th><th scope="col" className="px-2 py-3">{sortButton("Class", "class")}</th><th scope="col" className="px-2 py-3">{sortButton("Term", "term")}</th><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Applicable</th><th scope="col" className="px-2 py-3">Recorded</th><th scope="col" className="px-2 py-3">Not recorded</th><th scope="col" className="px-2 py-3">{sortButton("Coverage", "coverage")}</th><th scope="col" className="px-2 py-3">Actions</th></tr></thead><tbody>{data.sessions.map((value) => <tr key={`${value.assessment_session_id}-${value.class_id}-${value.subject_id}`} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left font-bold">{value.assessment_label}</th><td className="px-2 py-3">{value.subject_name}</td><td className="px-2 py-3"><Link className="font-bold text-brand hover:underline" to={linkWith(`/classes/${value.class_id}`, { academic_year_id: value.academic_year_id, term: `term_${value.term_number}` })}>{value.class_name}</Link><span className="block text-xs text-muted-foreground">{value.jenjang}</span></td><td className="px-2 py-3">{value.term_label}</td><td className="px-2 py-3">{value.assessment_date ?? "Date not recorded"}</td><td className="px-2 py-3 tabular-nums">{value.applicable_student_count}</td><td className="px-2 py-3 tabular-nums">{value.recorded_score_count}</td><td className="px-2 py-3 tabular-nums">{value.unrecorded_score_count}</td><td className="px-2 py-3"><span>{stateLabel(value.coverage_state)}</span><span className="block text-xs text-muted-foreground">{value.coverage_percent === null ? "Not applicable" : `${value.coverage_percent}%`}</span></td><td className="px-2 py-3"><div className="flex min-w-44 flex-col items-start gap-1">{<Link className="font-bold text-brand hover:underline" to={linkWith("/grades", { academic_year_id: value.academic_year_id, jenjang_id: value.jenjang_id, assessment_session_id: value.assessment_session_id, subject_id: value.subject_id })}>{value.coverage_state === "COMPLETE" ? "Review scores" : "Continue score entry"}</Link>}<Link className="font-bold text-brand hover:underline" to={linkWith("/analytics/academic", { academic_year_id: value.academic_year_id, term: `term_${value.term_number}`, class_id: value.class_id, subject_id: value.subject_id })}>View Academic Analytics</Link></div></td></tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {number(data.total)} scopes</span><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next</Button></div></CardContent></Card>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></CardContent></Card>;
}
