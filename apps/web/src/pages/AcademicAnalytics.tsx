import { useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import { Download } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { Input } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { createDownloadUrl, revokeDownloadUrl } from "../lib/api/client";
import { downloadAcademicAnalytics, type AcademicAnalyticsFilters } from "../api/academicAnalytics";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAcademicAnalyticsOptionsQuery, useAcademicAnalyticsOverviewQuery, useAcademicAnalyticsStudentsQuery } from "../hooks/useAcademicAnalyticsQueries";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function score(value: number | null): string { return value === null ? "—" : value.toFixed(1); }
function pct(value: number): string { return `${value.toFixed(1)}%`; }
function queryId(value: string | null): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export default function AcademicAnalytics() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const allowed = can("view_student");
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => queryId(searchParams.get("academic_year_id")));
  const [jenjangId, setJenjangId] = useState<number | null>(() => queryId(searchParams.get("jenjang_id")));
  const [classId, setClassId] = useState<number | null>(() => queryId(searchParams.get("class_id")));
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [assessmentType, setAssessmentType] = useState<"sumatif" | "formatif" | null>(null);
  const [term, setTerm] = useState<"term_1" | "term_2" | "term_3" | "term_4" | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "average" | "formative" | "summative" | "missing">("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const filterQuery = useAnalyticsFiltersQuery({}, allowed);
  const years = filterQuery.data?.academic_years ?? [];
  useEffect(() => { if (academicYearId === null) setAcademicYearId((years.find((value) => value.is_default) ?? years[0])?.id ?? null); }, [academicYearId, years]);
  const options = useAcademicAnalyticsOptionsQuery(academicYearId, jenjangId, allowed);
  useEffect(() => { if (classId !== null && options.data && !options.data.classes.some((value) => value.id === classId)) setClassId(null); }, [classId, options.data]);
  useEffect(() => { if (subjectId !== null && options.data && !options.data.subjects.some((value) => value.id === subjectId)) setSubjectId(null); }, [options.data, subjectId]);
  useEffect(() => { setPage(1); }, [academicYearId, jenjangId, classId, subjectId, assessmentType, term, search, sort, order]);
  const filters: AcademicAnalyticsFilters | null = academicYearId === null ? null : { academic_year_id: academicYearId, jenjang_id: jenjangId, class_id: classId, subject_id: subjectId, assessment_type: assessmentType, term };
  const overview = useAcademicAnalyticsOverviewQuery(filters, allowed);
  const students = useAcademicAnalyticsStudentsQuery(filters ? { ...filters, search, sort, order, page, page_size: 25 } : null, allowed);
  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="You do not have permission to view academic analytics." />;
  if (filterQuery.isPending || options.isPending) return <LoadingState title="Loading academic analytics" description="Preparing academic filters and data." />;
  if (filterQuery.error || options.error) return <ErrorState title="Academic analytics unavailable" description="The academic filter options could not be loaded." action={<Button onClick={() => { void filterQuery.refetch(); void options.refetch(); }}>Try again</Button>} />;
  if (years.length === 0) return <SetupRequiredState title="Academic setup required" description="Add an academic year before opening academic analytics." action={<Button onClick={() => navigate("/academic-management")}>Open academic setup</Button>} />;
  if (!filters) return <LoadingState title="Loading academic analytics" />;
  if (overview.isPending || students.isPending) return <LoadingState title="Calculating academic analytics" description="The server is computing canonical aggregates." />;
  if (overview.error || students.error) return <ErrorState title="Academic analytics unavailable" description="The server could not calculate this scope." action={<Button onClick={() => { void overview.refetch(); void students.refetch(); }}>Try again</Button>} />;
  const data = overview.data!;
  const exportReport = async () => { setExportError(""); setExporting(true); try { const blob = await downloadAcademicAnalytics(filters); const url = createDownloadUrl(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `academic-analytics-${filters.academic_year_id}.xlsx`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); revokeDownloadUrl(url); } catch { setExportError("The Excel export could not be created."); } finally { setExporting(false); } };
  const toggleSort = (next: typeof sort) => { if (sort === next) setOrder((value) => value === "asc" ? "desc" : "asc"); else { setSort(next); setOrder("asc"); } };
  const pageCount = Math.max(1, Math.ceil((students.data?.total ?? 0) / (students.data?.pageSize ?? 25)));
  const chart = { labels: data.distribution.map((value) => value.bucket), datasets: [{ label: "Scores", data: data.distribution.map((value) => value.count), backgroundColor: "#1d4ed8" }] };
  return <div className="space-y-7">
    <PageHeader eyebrow="Management Analytics" title="Academic Analytics" description="Descriptive academic performance from canonical server-side score aggregates." actions={<Button onClick={() => void exportReport()} disabled={exporting || !can("export_student_data")}><Download className="h-4 w-4" aria-hidden="true" />{exporting ? "Exporting…" : "Export Academic Analytics"}</Button>} />
    {exportError && <ErrorState title="Export failed" description={exportError} />}
    <Card><CardHeader><CardTitle>Filters</CardTitle></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
      <div><FieldLabel htmlFor="academic-year">Academic year</FieldLabel><NativeSelect id="academic-year" value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setJenjangId(null); setClassId(null); setSubjectId(null); }}><option value="">Select year</option>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="academic-term">Term</FieldLabel><NativeSelect id="academic-term" value={term ?? ""} onChange={(event) => setTerm((event.target.value || null) as typeof term)}><option value="">All periods</option><option value="term_1">Term 1</option><option value="term_2">Term 2</option><option value="term_3">Term 3</option><option value="term_4">Term 4</option></NativeSelect></div>
      <div><FieldLabel htmlFor="academic-jenjang">Jenjang</FieldLabel><NativeSelect id="academic-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(event.target.value ? Number(event.target.value) : null); setClassId(null); setSubjectId(null); }}><option value="">All jenjang</option>{options.data?.jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="academic-class">Class / Rombel</FieldLabel><NativeSelect id="academic-class" value={classId ?? ""} onChange={(event) => setClassId(event.target.value ? Number(event.target.value) : null)}><option value="">All classes</option>{options.data?.classes.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="academic-subject">Subject</FieldLabel><NativeSelect id="academic-subject" value={subjectId ?? ""} onChange={(event) => setSubjectId(event.target.value ? Number(event.target.value) : null)}><option value="">All subjects</option>{options.data?.subjects.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="academic-type">Assessment type</FieldLabel><NativeSelect id="academic-type" value={assessmentType ?? ""} onChange={(event) => setAssessmentType((event.target.value || null) as typeof assessmentType)}><option value="">All types</option>{options.data?.assessmentTypes.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
    </div></CardContent></Card>
    <section aria-label="Academic summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[["Average score", score(data.summary.score.average)], ["Students", data.summary.students], ["Assessments", data.summary.assessments], ["Participation", pct(data.summary.participationPercentage)], ["Below threshold", data.summary.mastery.belowResults]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></CardContent></Card>)}</section>
    <div className="grid gap-7 xl:grid-cols-2"><Card><CardHeader><CardTitle>Score distribution</CardTitle></CardHeader><CardContent><div className="h-72"><Bar data={chart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div><table className="mt-4 w-full text-sm"><caption className="sr-only">Score distribution counts</caption><tbody>{data.distribution.map((value) => <tr key={value.bucket} className="border-b border-slate-100"><th className="py-2 text-left font-semibold">{value.bucket}</th><td className="py-2 text-right">{value.count}</td></tr>)}</tbody></table></CardContent></Card><Card><CardHeader><CardTitle>Scope and definitions</CardTitle></CardHeader><CardContent><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Academic year</dt><dd>{data.scope.academicYearLabel}</dd></div><div><dt className="font-semibold text-muted-foreground">Expected results</dt><dd>{data.summary.expectedResults}</dd></div><div><dt className="font-semibold text-muted-foreground">Scored results</dt><dd>{data.summary.scoredResults}</dd></div><div><dt className="font-semibold text-muted-foreground">Missing results</dt><dd>{data.summary.missingResults}</dd></div></dl><p className="mt-5 text-sm text-muted-foreground">{data.metricDefinitions.missing} {data.metricDefinitions.term}</p></CardContent></Card></div>
    <AnalyticsTable title="By Subject" headers={["Subject", "Students", "Assessments", "Average", "Formative", "Summative", "Participation", "Missing"]} rows={data.subjects.map((value) => [value.label, value.students, value.assessments, score(value.average), score(value.formativeAverage), score(value.summativeAverage), pct(value.participationPercentage), value.missingResults])} />
    <AnalyticsTable title="By Class" headers={["Class", "Students", "Assessments", "Average", "Participation", "Missing"]} rows={data.classes.map((value) => [value.label, value.students, value.assessments, score(value.average), pct(value.participationPercentage), value.missingResults])} />
    <AnalyticsTable title="By Jenjang" headers={["Jenjang", "Students", "Assessments", "Average", "Participation", "Missing"]} rows={data.jenjang.map((value) => [value.label, value.students, value.assessments, score(value.average), pct(value.participationPercentage), value.missingResults])} />
    <AnalyticsTable title="Assessments" headers={["Assessment", "Subject", "Type", "Participants", "Scored", "Missing", "Average", "Min", "Max"]} rows={data.assessments.map((value) => [value.label, value.subjectName, value.assessmentType, value.participants, value.scored, value.missing, score(value.average), score(value.min), score(value.max)])} />
    <Card><CardHeader><CardTitle>Students</CardTitle></CardHeader><CardContent><div className="mb-4 flex flex-wrap items-end gap-3"><div className="min-w-60 flex-1"><FieldLabel htmlFor="academic-search">Search student</FieldLabel><Input id="academic-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name" /></div><p className="text-sm text-muted-foreground">{students.data?.total ?? 0} students</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Student academic summaries</caption><thead><tr className="border-b border-slate-200 text-left">{[["Student", "name"], ["Class", null], ["Subjects", null], ["Assessments", null], ["Average", "average"], ["Formative", "formative"], ["Summative", "summative"], ["Missing", "missing"]].map(([label, key]) => <th scope="col" className="py-2 pr-4 font-black" key={String(label)}>{key ? <button className="underline-offset-4 hover:underline" onClick={() => toggleSort(key as typeof sort)}>{label}</button> : label}</th>)}</tr></thead><tbody>{students.data?.rows.map((value) => <tr key={value.studentId} className="border-b border-slate-100"><th scope="row" className="py-2 pr-4 text-left font-semibold">{value.studentName}</th><td className="py-2 pr-4">{value.className ?? "Unassigned"}</td><td className="py-2 pr-4">{value.subjectsIncluded}</td><td className="py-2 pr-4">{value.assessmentsIncluded}</td><td className="py-2 pr-4">{score(value.average)}</td><td className="py-2 pr-4">{score(value.formativeAverage)}</td><td className="py-2 pr-4">{score(value.summativeAverage)}</td><td className="py-2 pr-4">{value.missingAssessments}</td></tr>)}</tbody></table></div>{students.data?.rows.length === 0 && <EmptyState className="mt-4" title="No students found" description="No student scores match this scope." />}<div className="mt-4 flex items-center justify-between"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next</Button></div></CardContent></Card>
  </div>;
}

function AnalyticsTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{title}</caption><thead><tr className="border-b border-slate-200 text-left">{headers.map((value) => <th scope="col" className="py-2 pr-4 font-black" key={value}>{value}</th>)}</tr></thead><tbody>{rows.map((values, index) => <tr className="border-b border-slate-100" key={`${title}-${index}`}>{values.map((value, cell) => cell === 0 ? <th scope="row" className="py-2 pr-4 text-left font-semibold" key={cell}>{value}</th> : <td className="py-2 pr-4" key={cell}>{value}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <EmptyState className="mt-4" title={`No ${title.toLowerCase()} data`} description="No academic scores match this scope." />}</div></CardContent></Card>;
}
