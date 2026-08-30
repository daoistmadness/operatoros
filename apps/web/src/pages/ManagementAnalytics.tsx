import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import type { ManagementOverviewResponse } from "@operatoros/contracts/analytics";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery, useManagementOverviewQuery } from "../hooks/useAnalyticsQueries";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery } from "../hooks/useAttendanceAnalyticsQueries";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type AvailableAttendance = Extract<ManagementOverviewResponse["attendance"], { status: "available" }>;
type AvailableAcademic = Extract<ManagementOverviewResponse["academic"], { status: "available" }>;

function number(value: number | null): string { return value === null ? "—" : value.toLocaleString(); }
function percent(value: number): string { return `${value.toFixed(1)}%`; }

function sectionLink(path: string, scope: ManagementOverviewResponse["scope"]): string {
  const query = new URLSearchParams({ academic_year_id: String(scope.academicYearId) });
  if (scope.jenjangId !== null) query.set("jenjang_id", String(scope.jenjangId));
  if (scope.classId !== null) query.set("class_id", String(scope.classId));
  return `${path}?${query}`;
}

function Unavailable({ label }: { label: string }) { return <p className="rounded-md bg-surface-muted p-4 text-sm text-muted-foreground">{label} is not available for this account.</p>; }
function SectionLink({ href, children }: { href: string; children: string }) { return <Link className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline" to={href}>{children}<ArrowRight className="size-4" aria-hidden="true" /></Link>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md bg-surface-muted p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p></div>; }

function AttendanceSection({ value, scope }: { value: AvailableAttendance; scope: ManagementOverviewResponse["scope"] }) {
  const rows = ["present", "late", "sakit", "izin", "alfa"].map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1), value: value[key as keyof AvailableAttendance] as number }));
  return <Card><CardHeader><CardTitle>Attendance</CardTitle><p className="text-sm text-muted-foreground">Canonical attendance metrics for the selected academic year and date range.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Attendance rate" value={percent(value.attendanceRate)} /><Stat label="Present" value={value.present} /><Stat label="Late" value={value.late} /><Stat label="Alfa" value={value.alfa} /></div><div className="grid gap-6 lg:grid-cols-2"><div className="h-56" role="img" aria-label={`Attendance status distribution: ${rows.map((row) => `${row.label} ${row.value}`).join(", ")}`}><Bar data={{ labels: rows.map((row) => row.label), datasets: [{ label: "Records", data: rows.map((row) => row.value), backgroundColor: "#2563eb" }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div><table className="w-full text-sm"><caption className="sr-only">Attendance status distribution</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-2">Status</th><th scope="col" className="py-2 text-right">Records</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-b border-border"><th scope="row" className="py-2 text-left font-semibold">{row.label}</th><td className="py-2 text-right tabular-nums">{row.value}</td></tr>)}</tbody></table></div><p className="text-sm text-muted-foreground">{value.totalRecords} records · {value.overriddenRecords} override-corrected records.</p><SectionLink href={sectionLink("/analytics/attendance", scope)}>View Attendance Analytics</SectionLink></CardContent></Card>;
}

function AcademicSection({ value, scope }: { value: AvailableAcademic; scope: ManagementOverviewResponse["scope"] }) {
  return <Card><CardHeader><CardTitle>Academic</CardTitle><p className="text-sm text-muted-foreground">Canonical score averages and participation for the selected academic year.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Stat label="Average score" value={number(value.average)} /><Stat label="Students" value={value.students} /><Stat label="Participation" value={percent(value.participationPercentage)} /></div><div className="h-56" role="img" aria-label={`Academic averages by jenjang: ${value.byJenjang.map((row) => `${row.label} ${number(row.average)}`).join(", ")}`}><Bar data={{ labels: value.byJenjang.map((row) => row.label), datasets: [{ label: "Average score", data: value.byJenjang.map((row) => row.average ?? 0), backgroundColor: "#0f766e" }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div><table className="w-full text-sm"><caption className="sr-only">Academic average by jenjang</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-2">Jenjang</th><th scope="col" className="py-2 text-right">Students</th><th scope="col" className="py-2 text-right">Average</th></tr></thead><tbody>{value.byJenjang.map((row) => <tr key={row.label} className="border-b border-border"><th scope="row" className="py-2 text-left font-semibold">{row.label}</th><td className="py-2 text-right">{row.students}</td><td className="py-2 text-right">{number(row.average)}</td></tr>)}</tbody></table><p className="text-sm text-muted-foreground">{value.assessments} assessment components are in scope. Missing scores are excluded from averages.</p><SectionLink href={sectionLink("/analytics/academic", scope)}>View Academic Analytics</SectionLink></CardContent></Card>;
}

export default function ManagementAnalytics() {
  const { can } = useAuth();
  const canStudent = can("view_student");
  const canStaff = can("view_staff");
  const canAttendance = can("view_attendance");
  const canAny = canStudent || canStaff || canAttendance;
  const filtersQuery = useAnalyticsFiltersQuery({}, canAny);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [classId, setClassId] = useState<number | null>(null);
  const academicOptionsQuery = useAcademicAnalyticsOptionsQuery(academicYearId, jenjangId, canStudent);
  const attendanceOptionsQuery = useAttendanceAnalyticsOptionsQuery(academicYearId, jenjangId, canAttendance);
  const years = filtersQuery.data?.academic_years ?? [];
  const classes = academicOptionsQuery.data?.classes ?? attendanceOptionsQuery.data?.classes ?? [];
  const jenjangs = filtersQuery.data?.jenjangs ?? academicOptionsQuery.data?.jenjangs ?? attendanceOptionsQuery.data?.jenjangs ?? [];
  const params = useMemo(() => academicYearId === null ? null : ({ academic_year_id: academicYearId, jenjang_id: jenjangId, class_id: classId }), [academicYearId, jenjangId, classId]);
  const overviewQuery = useManagementOverviewQuery(params, canAny);

  useEffect(() => { if (academicYearId === null) setAcademicYearId((years.find((year) => year.is_default) ?? years[0])?.id ?? null); }, [academicYearId, years]);
  useEffect(() => { if (classId !== null && !classes.some((value) => value.id === classId)) setClassId(null); }, [classId, classes]);

  if (!canAny) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view management analytics." />;
  if (filtersQuery.isPending) return <LoadingState title="Loading management analytics" description="Preparing the available scope." />;
  if (filtersQuery.error) return <ErrorState title="Management analytics could not be loaded" description="The available analytics scope could not be loaded." action={<Button onClick={() => { void filtersQuery.refetch(); }}>Try again</Button>} />;
  if (years.length === 0) return <EmptyState title="No academic year is configured" description="Configure an academic year before opening management analytics." />;
  if (overviewQuery.isPending || overviewQuery.isFetching) return <LoadingState title="Loading management overview" description="Combining canonical analytics on the server." />;
  if (overviewQuery.error || !overviewQuery.data) return <ErrorState title="Management overview could not be loaded" description="The server could not load this scope." action={<Button onClick={() => { void overviewQuery.refetch(); }}>Try again</Button>} />;

  const overview = overviewQuery.data;
  const reset = () => { setJenjangId(null); setClassId(null); setAcademicYearId((years.find((year) => year.is_default) ?? years[0])?.id ?? null); };
  return <div className="space-y-7">
    <PageHeader eyebrow="Management Analytics" title="Management Overview" description="A concise descriptive view from the current canonical student, attendance, academic, and data-quality analytics." actions={<Button variant="outline" onClick={reset} className="gap-2"><RotateCcw className="size-4" aria-hidden="true" />Reset filters</Button>} />
    <Card><CardHeader><CardTitle>Filters</CardTitle><p className="text-sm text-muted-foreground">Academic year, jenjang, and class narrow student, attendance, academic, and student-quality sections. Staff totals use the current staff authority and apply jenjang where supported. Attendance uses the full academic-year date range.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-3"><div><FieldLabel htmlFor="management-year">Academic year</FieldLabel><NativeSelect id="management-year" value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value) || null); setJenjangId(null); setClassId(null); }}>{years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="management-jenjang">Jenjang</FieldLabel><NativeSelect id="management-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(event.target.value ? Number(event.target.value) : null); setClassId(null); }}><option value="">All jenjang</option>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div><div><FieldLabel htmlFor="management-class">Class / Rombel</FieldLabel><NativeSelect id="management-class" value={classId ?? ""} onChange={(event) => setClassId(event.target.value ? Number(event.target.value) : null)}><option value="">All classes</option>{classes.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div></div></CardContent></Card>
    <section aria-labelledby="school-snapshot"><h2 id="school-snapshot" className="mb-3 text-xl font-black">School Snapshot</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">Active students</p>{overview.school.students.status === "available" ? <p className="mt-2 text-3xl font-black">{overview.school.students.activeStudents}</p> : <Unavailable label="Student snapshot" />}</CardContent></Card><Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">Active staff</p>{overview.school.staff.status === "available" ? <p className="mt-2 text-3xl font-black">{overview.school.staff.activeStaff}</p> : <Unavailable label="Staff snapshot" />}</CardContent></Card><Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">Jenjang</p>{overview.school.students.status === "available" ? <p className="mt-2 text-3xl font-black">{overview.school.students.jenjangCount}</p> : <Unavailable label="Jenjang snapshot" />}</CardContent></Card><Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">Classes / Rombel</p>{overview.school.students.status === "available" ? <p className="mt-2 text-3xl font-black">{overview.school.students.classCount}</p> : <Unavailable label="Class snapshot" />}</CardContent></Card></div>{overview.school.students.status === "available" && <div className="mt-4 flex flex-wrap gap-3">{overview.school.students.byJenjang.map((row) => <span className="rounded-md border border-border px-3 py-2 text-sm" key={row.label}>{row.label}: <strong>{row.count}</strong> ({percent(row.percentage)})</span>)}<SectionLink href={sectionLink(overview.links.recapitulation, overview.scope)}>View Data Recapitulation</SectionLink></div>}</section>
    <div className="grid gap-7 xl:grid-cols-2"><section aria-labelledby="attendance-summary">{overview.attendance.status === "available" ? <AttendanceSection value={overview.attendance} scope={overview.scope} /> : <Card><CardHeader><CardTitle id="attendance-summary">Attendance</CardTitle></CardHeader><CardContent><Unavailable label="Attendance summary" /></CardContent></Card>}</section><section aria-labelledby="academic-summary">{overview.academic.status === "available" ? <AcademicSection value={overview.academic} scope={overview.scope} /> : <Card><CardHeader><CardTitle id="academic-summary">Academic</CardTitle></CardHeader><CardContent><Unavailable label="Academic summary" /></CardContent></Card>}</section></div>
    <section aria-labelledby="quality-summary"><Card><CardHeader><CardTitle id="quality-summary">Data Quality</CardTitle><p className="text-sm text-muted-foreground">Current record completeness from the canonical data-quality analytics.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2">{["students", "staff"].map((kind) => { const value = overview.dataQuality[kind as "students" | "staff"]; return <div className="rounded-md border border-border p-4" key={kind}><h3 className="font-black">{kind === "students" ? "Students" : "Staff"}</h3>{value.status === "available" ? <dl className="mt-3 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-muted-foreground">Records</dt><dd className="font-black">{value.total}</dd></div><div><dt className="text-muted-foreground">Issues</dt><dd className="font-black">{value.issueCount}</dd></div><div><dt className="text-muted-foreground">Complete</dt><dd className="font-black">{percent(value.completenessPercentage)}</dd></div></dl> : <div className="mt-3"><Unavailable label={`${kind[0].toUpperCase()}${kind.slice(1)} quality`} /></div>}</div>; })}</div><div className="mt-5"><SectionLink href={sectionLink(overview.links.dataQuality, overview.scope)}>View Data Quality</SectionLink></div></CardContent></Card></section>
  </div>;
}
