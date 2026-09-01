import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { fetchAssignedClasses, type AssignedClassSummary } from "../api/teacherClassAssignments";
import { useAttendanceCorrectionReviewQuery } from "../hooks/useAttendanceCorrectionReviewQuery";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";

type Status = "on-time" | "late" | "absent" | "incomplete" | "sakit" | "izin" | "alfa";
const statuses: Status[] = ["on-time", "late", "absent", "incomplete", "sakit", "izin", "alfa"];
const statusLabels: Record<Status, string> = { "on-time": "Present", late: "Late", absent: "Absent", incomplete: "Incomplete", sakit: "Sakit", izin: "Izin", alfa: "Alfa" };

function queryId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function statusLabel(value: string): string { return statusLabels[value as Status] ?? value; }

function linkClass(path: string | null, className: string): ReactNode {
  return path === null ? className : <Link className="font-bold text-brand hover:underline" to={path}>{className}</Link>;
}

export default function AttendanceCorrectionReview() {
  const { can } = useAuth();
  const allowed = can("view_attendance_corrections");
  const [searchParams, setSearchParams] = useSearchParams();
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => queryId(searchParams.get("academic_year_id")));
  const [jenjangId, setJenjangId] = useState<number | null>(() => queryId(searchParams.get("jenjang_id")));
  const [classId, setClassId] = useState<number | null>(() => queryId(searchParams.get("class_id")));
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") ?? "");
  const [baseStatus, setBaseStatus] = useState(searchParams.get("base_status") ?? "");
  const [effectiveStatus, setEffectiveStatus] = useState(searchParams.get("effective_status") ?? "");
  const [studentSearch, setStudentSearch] = useState(searchParams.get("student_search") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) > 0 ? Number(searchParams.get("page")) : 1);

  const filtersQuery = useAnalyticsFiltersQuery({}, allowed);
  const years = filtersQuery.data?.academic_years ?? [];
  const selectedYear = academicYearId ?? (years.find((value) => value.is_default) ?? years[0])?.id ?? null;
  const classesQuery = useAttendanceCorrectionReviewClasses(selectedYear, allowed);
  const jenjangs = filtersQuery.data?.jenjangs ?? [];
  const classes = classesQuery.data ?? [];
  const filters = useMemo(() => selectedYear === null ? null : ({
    academic_year_id: selectedYear,
    jenjang_id: jenjangId,
    class_id: classId,
    date_from: dateFrom || null,
    date_to: dateTo || null,
    base_status: baseStatus || null,
    effective_status: effectiveStatus || null,
    student_search: studentSearch || null,
    page,
    page_size: 25,
  }), [baseStatus, classId, dateFrom, dateTo, effectiveStatus, jenjangId, page, selectedYear, studentSearch]);
  const review = useAttendanceCorrectionReviewQuery(filters, allowed);

  useEffect(() => { if (academicYearId === null && selectedYear !== null) setAcademicYearId(selectedYear); }, [academicYearId, selectedYear]);
  useEffect(() => { if (classId !== null && classesQuery.data && !classes.some((value) => value.id === classId)) setClassId(null); }, [classId, classes, classesQuery.data]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedYear !== null) next.set("academic_year_id", String(selectedYear));
    if (jenjangId !== null) next.set("jenjang_id", String(jenjangId));
    if (classId !== null) next.set("class_id", String(classId));
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    if (baseStatus) next.set("base_status", baseStatus);
    if (effectiveStatus) next.set("effective_status", effectiveStatus);
    if (studentSearch) next.set("student_search", studentSearch);
    if (page > 1) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [baseStatus, classId, dateFrom, dateTo, effectiveStatus, jenjangId, page, selectedYear, setSearchParams, studentSearch]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot review attendance corrections." />;
  if (filtersQuery.isPending || classesQuery.isPending) return <LoadingState title="Loading correction review" description="Preparing the authorized attendance scope." />;
  if (filtersQuery.error || classesQuery.error) return <ErrorState title="Correction review unavailable" description="The attendance scope could not be loaded." action={<Button onClick={() => { void filtersQuery.refetch(); void classesQuery.refetch(); }}>Try again</Button>} />;
  if (!years.length) return <SetupRequiredState title="Academic setup required" description="Add an academic year before reviewing attendance corrections." />;
  if (review.isPending) return <LoadingState title="Loading correction review" description="Reading current attendance overrides from the server." />;
  if (review.error || !review.data) return <ErrorState title="Correction review unavailable" description="The server could not load this correction scope." action={<Button onClick={() => void review.refetch()}>Try again</Button>} />;

  const data = review.data;
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const reset = () => { setAcademicYearId((years.find((value) => value.is_default) ?? years[0])?.id ?? null); setJenjangId(null); setClassId(null); setDateFrom(""); setDateTo(""); setBaseStatus(""); setEffectiveStatus(""); setStudentSearch(""); setPage(1); };
  const setFilter = (change: () => void) => { change(); setPage(1); };

  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Attendance Operations" title="Correction Review" description="Review current attendance overrides from canonical records. This workspace provides context and navigation; it does not score staff performance or label corrections as violations." actions={<Button variant="outline" onClick={reset}><RotateCcw className="size-4" aria-hidden="true" />Reset filters</Button>} />
    <Card><CardHeader><CardTitle>Scope</CardTitle><p className="text-sm text-muted-foreground">Only current override rows appear. Correction history remains available through the canonical attendance review workflow.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div><FieldLabel htmlFor="correction-year">Academic year</FieldLabel><NativeSelect id="correction-year" value={selectedYear ?? ""} onChange={(event) => setFilter(() => { setAcademicYearId(Number(event.target.value) || null); setJenjangId(null); setClassId(null); setDateFrom(""); setDateTo(""); })}><option value="">Select year</option>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="correction-jenjang">Jenjang</FieldLabel><NativeSelect id="correction-jenjang" value={jenjangId ?? ""} onChange={(event) => setFilter(() => { setJenjangId(Number(event.target.value) || null); setClassId(null); })}><option value="">All jenjang</option>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="correction-class">Class / Rombel</FieldLabel><NativeSelect id="correction-class" value={classId ?? ""} onChange={(event) => setFilter(() => setClassId(Number(event.target.value) || null))}><option value="">All authorized classes</option>{classes.map((value) => <option key={value.id} value={value.id}>{value.class_name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="correction-search">Search student</FieldLabel><Input id="correction-search" value={studentSearch} onChange={(event) => setFilter(() => setStudentSearch(event.target.value))} placeholder="Name" /></div>
      <div><FieldLabel htmlFor="correction-from">Date from</FieldLabel><Input id="correction-from" type="date" value={dateFrom} onChange={(event) => setFilter(() => setDateFrom(event.target.value))} /></div>
      <div><FieldLabel htmlFor="correction-to">Date to</FieldLabel><Input id="correction-to" type="date" value={dateTo} onChange={(event) => setFilter(() => setDateTo(event.target.value))} /></div>
      <div><FieldLabel htmlFor="correction-base-status">Original status</FieldLabel><NativeSelect id="correction-base-status" value={baseStatus} onChange={(event) => setFilter(() => setBaseStatus(event.target.value))}><option value="">All original statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="correction-effective-status">Effective status</FieldLabel><NativeSelect id="correction-effective-status" value={effectiveStatus} onChange={(event) => setFilter(() => setEffectiveStatus(event.target.value))}><option value="">All effective statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</NativeSelect></div>
    </div></CardContent></Card>
    <Card><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">Corrections in scope</p><p className="mt-2 text-2xl font-black tabular-nums">{data.summary.corrections}</p><p className="mt-2 text-sm text-muted-foreground">Original and effective statuses are descriptive attendance data. They do not imply fault, suspicion, or risk.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Current corrections</CardTitle></CardHeader><CardContent>{data.items.length === 0 ? <EmptyState title="No current corrections found" description="No canonical attendance overrides match this authorized scope." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><caption className="sr-only">Current attendance corrections</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Student</th><th scope="col" className="px-2 py-3">Class</th><th scope="col" className="px-2 py-3">Original</th><th scope="col" className="px-2 py-3">Effective</th><th scope="col" className="px-2 py-3">Correction details</th><th scope="col" className="px-2 py-3">Actions</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.attendanceId} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left font-bold">{item.date}</th><td className="px-2 py-3"><Link className="font-bold text-brand hover:underline" to={item.links.student360}>{item.studentName}</Link><span className="block text-xs text-muted-foreground">Attendance #{item.attendanceId}</span></td><td className="px-2 py-3">{linkClass(item.links.class360, item.className)}<span className="block text-xs text-muted-foreground">{item.jenjang ?? "Jenjang not recorded"}</span></td><td className="px-2 py-3"><span className="font-semibold">Original</span><span className="block">{statusLabel(item.baseStatus)}</span></td><td className="px-2 py-3"><span className="font-semibold">Effective</span><span className="block">{statusLabel(item.effectiveStatus)}</span></td><td className="px-2 py-3"><p>{item.correction.note}</p><p className="mt-1 text-xs text-muted-foreground">Reviewed {item.correction.reviewedAt} by {item.correction.reviewedBy}</p></td><td className="px-2 py-3"><div className="flex min-w-44 flex-col items-start gap-1">{item.canEdit && item.links.editCorrection ? <Link className="font-bold text-brand hover:underline" to={item.links.editCorrection}>Edit correction</Link> : <span className="text-xs text-muted-foreground">View context only</span>}<Link className="font-bold text-brand hover:underline" to={item.links.dailyAttendance}>Open attendance for date</Link>{item.links.class360 && <Link className="font-bold text-brand hover:underline" to={item.links.class360}>Open Class 360</Link>}</div></td></tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ArrowLeft className="size-4" aria-hidden="true" />Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {data.total} corrections</span><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next<ArrowRight className="size-4" aria-hidden="true" /></Button></div></CardContent></Card>
    <p className="text-sm text-muted-foreground">Changing a correction remains owned by the existing attendance correction workflow. Calendar expectation and submission timing do not change correction meaning.</p>
  </div>;
}

function useAttendanceCorrectionReviewClasses(academicYearId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["attendance", "correction-review", "classes", academicYearId],
    queryFn: fetchAssignedClasses,
    enabled: enabled && academicYearId !== null,
    select: (values: AssignedClassSummary[]) => values.filter((value) => value.academic_year_id === academicYearId),
  });
}
