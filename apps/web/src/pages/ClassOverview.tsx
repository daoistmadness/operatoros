import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ClassOverviewResponse } from "@operatoros/contracts/classes";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useClassOverviewQuery } from "../hooks/useClassOverviewQuery";

type AvailableAttendance = Extract<ClassOverviewResponse["attendance"], { status: "available" }>;
type AvailableAcademic = Extract<ClassOverviewResponse["academic"], { status: "available" }>;
type AvailableQuality = Extract<ClassOverviewResponse["dataQuality"], { status: "available" }>;
type Term = "term_1" | "term_2" | "term_3" | "term_4";

function score(value: number | null): string { return value === null ? "—" : value.toFixed(1); }
function percent(value: number): string { return `${value.toFixed(1)}%`; }

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-surface-muted p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p></div>;
}

function SectionLink({ href, children }: { href: string; children: string }) {
  return <Link className="text-sm font-bold text-brand hover:underline" to={href}>{children}</Link>;
}

function AttendanceSection({ value, link }: { value: AvailableAttendance; link: string }) {
  const rows = [["Present", value.counts.present], ["Late", value.counts.late], ["Sakit", value.counts.sakit], ["Izin", value.counts.izin], ["Alfa", value.counts.alfa], ["Incomplete", value.counts.incomplete]] as const;
  return <Card><CardHeader><CardTitle>Attendance</CardTitle><p className="text-sm text-muted-foreground">Canonical attendance metrics for the selected class and date range.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Attendance rate" value={percent(value.attendanceRate)} /><Metric label="Present" value={value.counts.present} /><Metric label="Late" value={value.counts.late} /><Metric label="Alfa" value={value.counts.alfa} /></div><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Class attendance status counts</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-2">Status</th><th scope="col" className="py-2 text-right">Records</th></tr></thead><tbody>{rows.map(([label, count]) => <tr className="border-b border-border" key={label}><th scope="row" className="py-2 text-left font-semibold">{label}</th><td className="py-2 text-right tabular-nums">{count}</td></tr>)}</tbody></table></div><p className="text-sm text-muted-foreground">{value.totalRecords} records · {value.overriddenRecords} override-corrected records · tardiness {percent(value.tardinessRate)}.</p><SectionLink href={link}>View Attendance Analytics</SectionLink></CardContent></Card>;
}

function AcademicSection({ value, link }: { value: AvailableAcademic; link: string }) {
  return <Card><CardHeader><CardTitle>Academic</CardTitle><p className="text-sm text-muted-foreground">Canonical academic aggregates for the selected period.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Average score" value={score(value.average)} /><Metric label="Students" value={value.students} /><Metric label="Participation" value={percent(value.participationPercentage)} /></div><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Assessments</dt><dd className="font-black">{value.assessments}</dd></div><div><dt className="font-semibold text-muted-foreground">Period</dt><dd className="font-black">{value.term === null ? "All periods" : `Term ${value.term}`}</dd></div></dl><p className="text-sm text-muted-foreground">{value.periodNote}</p><SectionLink href={link}>View Academic Analytics</SectionLink></CardContent></Card>;
}

function QualitySection({ value, link }: { value: AvailableQuality; link: string }) {
  return <Card><CardHeader><CardTitle>Data Completeness</CardTitle><p className="text-sm text-muted-foreground">Student master-data context for this class. These measurements do not classify students.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Students" value={value.totalStudents} /><Metric label="Complete records" value={value.cleanRecords} /><Metric label="Required issues" value={value.recordsWithRequiredIssues} /><Metric label="Optional issues" value={value.recordsWithOptionalIssues} /></div><SectionLink href={link}>View Data Quality</SectionLink></CardContent></Card>;
}

export default function ClassOverview() {
  const { can } = useAuth();
  const allowed = can("view_student");
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const term = (searchParams.get("term") as Term | null) ?? null;
  const dateFrom = searchParams.get("attendance_date_from") ?? "";
  const dateTo = searchParams.get("attendance_date_to") ?? "";
  const search = searchParams.get("search") ?? "";
  const query = useClassOverviewQuery(id ?? null, { term, attendance_date_from: dateFrom || null, attendance_date_to: dateTo || null, search: search || null }, allowed);

  const updateFilter = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot view class details." />;
  if (!id) return <ErrorState title="Class not found" description="The class identifier is missing." />;
  if (query.isPending) return <LoadingState title="Loading class overview" description="Combining the canonical class, roster, attendance, academic, and quality data." />;
  if (query.error || !query.data) return <ErrorState title="Class overview unavailable" description="The server could not load this class scope." action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />;

  const data = query.data;
  return <div className="space-y-7">
    <PageHeader eyebrow="Classes" title={data.class.name} description={`${data.class.jenjang} · ${data.class.grade} · ${data.class.academicYearLabel}`} actions={<>{can("enter_assigned_class_attendance") && <Link className="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-surface-muted" to={`/attendance/class-entry?class_id=${data.class.id}`}>Open attendance entry</Link>}</>} />
    <Card><CardHeader><CardTitle>Class scope</CardTitle><p className="text-sm text-muted-foreground">Filters narrow this class view. Academic terms use session-backed period attribution. Attendance uses the selected date range.</p></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><div><FieldLabel htmlFor="class-term">Academic term</FieldLabel><NativeSelect id="class-term" value={term ?? ""} onChange={(event) => updateFilter("term", event.target.value)}><option value="">All periods</option><option value="term_1">Term 1</option><option value="term_2">Term 2</option><option value="term_3">Term 3</option><option value="term_4">Term 4</option></NativeSelect></div><div><FieldLabel htmlFor="class-date-from">Attendance date from</FieldLabel><Input id="class-date-from" type="date" value={dateFrom} onChange={(event) => updateFilter("attendance_date_from", event.target.value)} /></div><div><FieldLabel htmlFor="class-date-to">Attendance date to</FieldLabel><Input id="class-date-to" type="date" value={dateTo} onChange={(event) => updateFilter("attendance_date_to", event.target.value)} /></div><div className="md:col-span-3"><FieldLabel htmlFor="class-student-search">Search roster</FieldLabel><Input id="class-student-search" value={search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Student name" /></div></CardContent></Card>
    <section aria-label="Class summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Students" value={data.roster.total} />{data.attendance.status === "available" && <Metric label="Attendance rate" value={percent(data.attendance.attendanceRate)} />}{data.academic.status === "available" && <Metric label="Academic average" value={score(data.academic.average)} />}{data.academic.status === "available" && <Metric label="Participation" value={percent(data.academic.participationPercentage)} />}</section>
    <Card><CardHeader><CardTitle>Roster</CardTitle><p className="text-sm text-muted-foreground">Canonical student-master and enrollment roster. Open a student for the full Student 360 view.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Students enrolled in this class</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-3 pr-4">Student</th><th scope="col" className="py-3 pr-4">Enrollment</th><th scope="col" className="py-3 pr-4">Data completeness</th></tr></thead><tbody>{data.roster.rows.map((student) => <tr className="border-b border-border" key={student.studentId}><th scope="row" className="py-3 pr-4 text-left"><Link className="font-black text-brand hover:underline" to={student.student360Link}>{student.studentName}</Link></th><td className="py-3 pr-4">{student.enrollmentStatus}</td><td className="py-3 pr-4">{student.dataQualityIssueCount === 0 ? "Complete" : `${student.dataQualityIssueCount} data item(s)`}</td></tr>)}</tbody></table></div>{data.roster.rows.length === 0 && <EmptyState className="mt-4" title="No students found" description="No canonical students match this class and search." />}</CardContent></Card>
    <div className="grid gap-7 xl:grid-cols-2"><section aria-label="Attendance summary">{data.attendance.status === "available" ? <AttendanceSection value={data.attendance} link={data.links.attendance} /> : <Card><CardHeader><CardTitle>Attendance</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Attendance is not available for this account.</p></CardContent></Card>}</section><section aria-label="Academic summary">{data.academic.status === "available" ? <AcademicSection value={data.academic} link={data.links.academic} /> : <Card><CardHeader><CardTitle>Academic</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Academic data is not available for this account.</p></CardContent></Card>}</section></div>
    {data.dataQuality.status === "available" && <QualitySection value={data.dataQuality} link={data.links.dataQuality} />}
  </div>;
}
