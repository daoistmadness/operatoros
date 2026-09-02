import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { MachineImportPreviewResponse } from "@operatoros/contracts/attendance";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { applyMachineAttendance, previewMachineAttendance } from "../api/machineAttendancePreview";
import { createStudent, linkDeviceIdentity, searchMachineImportStudents } from "../api/students";
import { isApiError, getPageApiError } from "../lib/api/errors";
import { invalidateAttendanceQueries } from "../lib/query/attendanceInvalidation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const stateLabel: Record<string, string> = {
  SCAN_PRESENT: "Scan present", NO_SCAN: "No scan", MULTIPLE_SCANS: "Multiple scans", INVALID_SCAN_VALUE: "Invalid scan value", UNSUPPORTED_SOURCE_STATUS: "Unsupported source status",
  EXPECTED: "Expected", NOT_EXPECTED: "Not expected", UNKNOWN: "Expectation unknown",
  SCAN_EXPECTED: "Scan on expected date", NO_SCAN_EXPECTED: "No scan on expected date", NO_SCAN_NOT_EXPECTED: "No scan on non-school date",
  SCAN_NOT_EXPECTED: "Scan on non-school date", EXPECTATION_UNKNOWN: "Expectation unknown", INVALID_SCAN: "Invalid scan evidence",
  MATCHED: "Matched", UNMAPPED: "Unmapped", AMBIGUOUS: "Ambiguous", INVALID_IDENTIFIER: "Invalid identifier", INVALID_SOURCE_ROW: "Invalid source row",
  ELIGIBLE_CREATE: "Eligible to create", NOOP_ALREADY_CANONICAL: "Already canonical", CONFLICT_EXISTING_ATTENDANCE: "Existing attendance conflict", CONFLICT_EXISTING_OVERRIDE: "Existing override conflict",
  BLOCKED_NO_SCAN: "No scan", BLOCKED_MULTIPLE_SCANS_UNCLEAR: "Multiple scans need review", BLOCKED_INVALID_SCAN: "Invalid scan", BLOCKED_UNSUPPORTED_SOURCE_STATUS: "Unsupported source status", BLOCKED_UNMAPPED: "Unmapped", BLOCKED_AMBIGUOUS: "Ambiguous", BLOCKED_NO_ACTIVE_ENROLLMENT: "No active enrollment", BLOCKED_AMBIGUOUS_ENROLLMENT: "Ambiguous enrollment", BLOCKED_OUT_OF_SCOPE: "Out of scope", BLOCKED_CALENDAR_NOT_EXPECTED: "Calendar not expected", BLOCKED_CALENDAR_UNKNOWN: "Calendar unknown", BLOCKED_FUTURE_DATE: "Future date", BLOCKED_FINALIZED_PERIOD: "Finalized date", BLOCKED_INCOMPLETE_SCAN: "Incomplete scan", BLOCKED_INVALID_SOURCE_ROW: "Invalid source row",
};
const resolutionLabels: Record<string, string> = {
  ATTENDANCE_REVIEW: "Attendance review", ATTENDANCE_CORRECTION: "Attendance correction", STUDENT_DATA_RESOLUTION: "Student/device mapping",
  ENROLLMENT_RESOLUTION: "Enrollment resolution", CALENDAR_RESOLUTION: "Calendar resolution", SOURCE_FILE_REVIEW: "Source-file review",
  NO_ACTION_REQUIRED: "No action required", NOT_RESOLVABLE_IN_OPERATOROS: "No supported resolution",
};

type IdentityReview = MachineImportPreviewResponse["identityReview"][number];
type IdentityAction = { item: IdentityReview; mode: "link" | "create" };

function label(value: string): string { return stateLabel[value] ?? value.replaceAll("_", " "); }

export default function AttendanceMachineImportPreview() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const allowed = can("import_attendance");
  const filters = useAnalyticsFiltersQuery({}, allowed);
  const years = filters.data?.academic_years ?? [];
  const jenjangs = filters.data?.jenjangs ?? [];
  const [yearId, setYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [identityAction, setIdentityAction] = useState<IdentityAction | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const preview = useMutation({ mutationFn: ({ file: selected, year, jenjang, page: selectedPage }: { file: File; year: number; jenjang: number; page: number }) => previewMachineAttendance(selected, year, jenjang, selectedPage) });
  const studentResults = useQuery({
    queryKey: ["machine-import", "student-search", studentSearch, yearId, jenjangId],
    queryFn: () => searchMachineImportStudents({ search: studentSearch, academicYearId: yearId!, jenjangId: jenjangId! }),
    enabled: identityAction?.mode === "link" && can("manage_device_identity") && yearId !== null && jenjangId !== null,
  });
  const refreshPreview = async () => {
    await invalidateAttendanceQueries(queryClient);
    setIdentityAction(null);
    setSelectedStudentId(null);
    if (file && yearId !== null && jenjangId !== null) await preview.mutateAsync({ file, year: yearId, jenjang: jenjangId, page });
  };
  const apply = useMutation({
    mutationFn: ({ file: selected, year, jenjang, digest }: { file: File; year: number; jenjang: number; digest: string }) => applyMachineAttendance(selected, year, jenjang, digest),
    onSuccess: async () => { await invalidateAttendanceQueries(queryClient); if (file && yearId !== null && jenjangId !== null) preview.mutate({ file, year: yearId, jenjang: jenjangId, page }); },
  });
  const link = useMutation({ mutationFn: (payload: Parameters<typeof linkDeviceIdentity>[0]) => linkDeviceIdentity(payload), onSuccess: refreshPreview });
  const create = useMutation({
    mutationFn: ({ item, fullName }: { item: IdentityReview; fullName: string }) => createStudent({
      identity: { full_name: fullName, preferred_name: null, nipd: null, nisn: null, nik: null, birth_place: null, birth_date: null, gender: null, religion: null, student_status: "active" },
      contact: null, guardians: [], health: null, document_status: null,
      device_identity: { device_identifier: item.deviceIdentifier, device_source: "attendance_machine", effective_from: item.effectiveFrom ?? new Date().toISOString().slice(0, 10), reason: "Linked from attendance machine identity review" },
      enrollment: null, duplicate_override_reason: null,
    }),
    onSuccess: refreshPreview,
  });

  useEffect(() => { if (yearId === null && years.length) setYearId((years.find((value) => value.is_default) ?? years[0]).id); }, [yearId, years]);
  useEffect(() => { if (jenjangId === null && jenjangs.length) setJenjangId(jenjangs[0].id); }, [jenjangId, jenjangs]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot preview attendance-machine workbooks." />;
  if (filters.isPending) return <LoadingState title="Loading import scope" description="Preparing academic-year and jenjang choices." />;
  if (filters.error) return <ErrorState title="Import scope unavailable" description="The server could not load the academic scope." action={<Button onClick={() => void filters.refetch()}>Try again</Button>} />;
  if (!years.length || !jenjangs.length) return <SetupRequiredState title="Academic setup required" description="Add an academic year and active jenjang before previewing a machine workbook." />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file || yearId === null || jenjangId === null) return;
    preview.mutate({ file, year: yearId, jenjang: jenjangId, page });
  };
  const openIdentityAction = (item: IdentityReview, mode: IdentityAction["mode"]) => {
    setIdentityAction({ item, mode });
    setStudentSearch(mode === "link" ? item.machineName ?? "" : "");
    setSelectedStudentId(null);
    setCreateName(item.machineName ?? "");
    setCreateConfirmed(false);
    link.reset();
    create.reset();
  };
  const closeIdentityAction = () => { if (!link.isPending && !create.isPending) setIdentityAction(null); };
  const data = preview.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize)) : 1;
  const selectedStudent = studentResults.data?.items.find((item) => item.id === selectedStudentId);
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Attendance Operations" title="Machine Import Preview" description="Inspect scan evidence and calendar reconciliation before an explicit, controlled import. The browser never decides what may be written." />
    <Card><CardHeader><CardTitle>Preview only</CardTitle><p className="text-sm text-muted-foreground">No attendance, student, enrollment, calendar, deadline, or mapping records will be changed.</p><p className="text-sm text-muted-foreground">Students without machine scans are not automatically marked Alfa.</p></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-4 md:items-end" onSubmit={submit}>
      <div><FieldLabel htmlFor="machine-preview-file">Attendance-machine XLSX</FieldLabel><input id="machine-preview-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); preview.reset(); link.reset(); create.reset(); setPage(1); }} className="block w-full text-sm" required /></div>
      <div><FieldLabel htmlFor="machine-preview-year">Academic year</FieldLabel><NativeSelect id="machine-preview-year" value={yearId ?? ""} onChange={(event) => { setYearId(Number(event.target.value) || null); preview.reset(); link.reset(); create.reset(); setPage(1); }}>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="machine-preview-jenjang">Jenjang</FieldLabel><NativeSelect id="machine-preview-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(Number(event.target.value) || null); preview.reset(); link.reset(); create.reset(); setPage(1); }}>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <Button type="submit" disabled={!file || preview.isPending}>{preview.isPending ? "Preparing preview…" : "Preview workbook"}</Button>
    </form>{preview.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{preview.error.message}</p>}</CardContent></Card>
    {preview.isPending && <LoadingState title="Preparing workbook preview" description="Parsing scan evidence and applying the selected calendar authority." />}
    {data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        ["Matched students", data.summary.matchedStudents], ["Unmapped identifiers", data.summary.unmappedStudents], ["Scan facts", data.summary.scanFacts], ["Eligible creates", data.summary.eligibleCreates], ["Already canonical", data.summary.alreadyCanonical], ["Conflicts", data.summary.conflicts], ["Blocked", data.summary.blocked], ["Expected dates without scan", data.summary.expectedNoScan],
      ].map(([title, value]) => <Card key={String(title)}><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></CardContent></Card>)}</div>
      {data.identityReview.length > 0 && <Card><CardHeader><CardTitle>Identity mapping review</CardTitle><p className="text-sm text-muted-foreground">Resolve each unique unmatched Device ID once. Machine names are context only and never select a student automatically.</p><p className="text-sm text-amber-700">This Device ID is not linked to an active student. Link an existing OperatorOS student, or create one.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><caption className="sr-only">Unique unmatched attendance Device IDs</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Device ID</th><th scope="col" className="px-2 py-3">Machine name</th><th scope="col" className="px-2 py-3">Rows</th><th scope="col" className="px-2 py-3">Action</th></tr></thead><tbody>{data.identityReview.map((item) => <tr key={item.deviceIdentifier} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left">{item.deviceIdentifier}</th><td className="px-2 py-3">{item.machineName ?? "Not recorded"}</td><td className="px-2 py-3">{item.occurrences}</td><td className="px-2 py-3"><div className="flex flex-wrap gap-2">{can("manage_device_identity") && <Button size="sm" onClick={() => openIdentityAction(item, "link")}>Link existing student</Button>}{can("create_student") && <Button size="sm" variant="outline" onClick={() => openIdentityAction(item, "create")}>Create student</Button>}<Link className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-bold hover:bg-surface-muted" to="/students">Open Student Management</Link></div><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-semibold">Technical details</summary><dl className="mt-2 grid gap-1"><div><dt className="inline font-semibold">Source date: </dt><dd className="inline">{item.effectiveFrom ?? "Not recorded"}</dd></div><div><dt className="inline font-semibold">Occurrences: </dt><dd className="inline">{item.occurrences}</dd></div><div><dt className="inline font-semibold">State: </dt><dd className="inline">DEVICE_IDENTITY_UNMATCHED</dd></div></dl></details></td></tr>)}</tbody></table></div></CardContent></Card>}
      <Card><CardHeader><CardTitle>Workbook recognized</CardTitle><p className="text-sm text-muted-foreground">{data.workbook.sheet} · {data.workbook.dimensions} · {data.workbook.sourceRows} source rows · {data.workbook.dateCoverage.from ?? "No dates"} to {data.workbook.dateCoverage.to ?? "No dates"}</p>{data.workbook.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700">{warning}</p>)}</CardHeader><CardContent>{data.rows.length === 0 ? <EmptyState title="No preview rows" description="The workbook contains no usable machine rows." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-sm"><caption className="sr-only">Machine attendance preview reconciliation, canonical context, and resolution</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Student</th><th scope="col" className="px-2 py-3">Mapping</th><th scope="col" className="px-2 py-3">Machine evidence</th><th scope="col" className="px-2 py-3">Calendar</th><th scope="col" className="px-2 py-3">Reconciliation</th><th scope="col" className="px-2 py-3">Existing attendance</th><th scope="col" className="px-2 py-3">Resolution</th><th scope="col" className="px-2 py-3">Apply classification</th></tr></thead><tbody>{data.rows.map((item, index) => <tr key={`${item.machineStudentIdentifier ?? "invalid"}-${item.date ?? "row"}-${index}`} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left">{item.date ?? "Invalid date"}</th><td className="px-2 py-3"><span className="font-semibold">{item.student?.name ?? item.sourceStudentName ?? "Unknown student"}</span><span className="block text-xs text-muted-foreground">Machine ID: {item.machineStudentIdentifier ?? "Not recorded"}</span></td><td className="px-2 py-3">{label(item.matchingState)}</td><td className="px-2 py-3">{label(item.machineEvidence)}{item.scanTimes.length > 0 && <span className="block text-xs text-muted-foreground">{item.scanTimes.join(" · ")}</span>}</td><td className="px-2 py-3">{label(item.expectation.status)}{item.expectation.reason && <span className="block text-xs text-muted-foreground">{label(item.expectation.reason)}</span>}</td><td className="px-2 py-3">{label(item.reconciliationState)}{item.canonicalStatus && <span className="block text-xs text-muted-foreground">Canonical target: {label(item.canonicalStatus)}</span>}</td><td className="px-2 py-3">{item.existingAttendance ? <><span className="block">Original: {label(item.existingAttendance.baseStatus)}</span><span className="block">Effective: {label(item.existingAttendance.effectiveStatus)}</span>{item.existingAttendance.hasOverride && <span className="block text-xs text-muted-foreground">Canonical override present</span>}</> : <span className="text-muted-foreground">No record</span>}</td><td className="px-2 py-3"><span className="font-semibold">{resolutionLabels[item.resolution.class] ?? label(item.resolution.class)}</span><span className="block text-xs text-muted-foreground">{item.matchingState === "UNMAPPED" ? "Resolve this unique Device ID in Identity Mapping Review above." : item.resolution.note}</span>{item.matchingState === "UNMAPPED" ? <Link className="mt-1 inline-block font-bold text-brand hover:underline" to="/students">Review student mapping</Link> : item.resolution.target && <Link className="mt-1 inline-block font-bold text-brand hover:underline" to={item.resolution.target.path}>{item.resolution.target.label}</Link>}</td><td className="px-2 py-3 font-semibold">{label(item.applyClassification)}</td></tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between"><Button variant="outline" disabled={page <= 1 || preview.isPending || apply.isPending} onClick={() => { const next = page - 1; setPage(next); if (file && yearId && jenjangId) preview.mutate({ file, year: yearId, jenjang: jenjangId, page: next }); }}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {data.pagination.total} logical rows</span><Button variant="outline" disabled={page >= pageCount || preview.isPending || apply.isPending} onClick={() => { const next = page + 1; setPage(next); if (file && yearId && jenjangId) preview.mutate({ file, year: yearId, jenjang: jenjangId, page: next }); }}>Next</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Explicit confirmation</CardTitle><p className="text-sm text-muted-foreground">Preview only until you confirm. Students without machine scans are not automatically marked Alfa.</p></CardHeader><CardContent><p className="text-sm">This import will create <strong>{data.summary.eligibleCreates}</strong> attendance records. Already canonical: <strong>{data.summary.alreadyCanonical}</strong>. Conflicts: <strong>{data.summary.conflicts}</strong>. Blocked: <strong>{data.summary.blocked}</strong>.</p><Button className="mt-4" disabled={!data.summary.eligibleCreates || apply.isPending || !file} onClick={() => { if (file && yearId && jenjangId) apply.mutate({ file, year: yearId, jenjang: jenjangId, digest: data.previewDigest }); }}>{apply.isPending ? "Applying…" : `Create ${data.summary.eligibleCreates} attendance records`}</Button>{apply.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{isApiError(apply.error) && apply.error.code === "PREVIEW_STALE" ? "Attendance data changed after this preview. Review the updated preview before importing." : getPageApiError(apply.error, "The machine attendance import could not be applied.")}</p>}{apply.data && <><p role="status" className="mt-4 text-sm font-semibold text-emerald-700">Import applied: {apply.data.summary.created} created, {apply.data.summary.alreadyCanonical} already canonical, {apply.data.summary.conflicts} conflicts, {apply.data.summary.blocked} blocked.</p><nav className="mt-3 flex flex-wrap gap-3 text-sm" aria-label="After import actions"><Link className="font-bold text-brand hover:underline" to="/attendance/daily">Open Daily Attendance</Link>{can("view_attendance_corrections") && <Link className="font-bold text-brand hover:underline" to="/attendance/override-review">Review correction overrides</Link>}</nav></>}</CardContent></Card>
    </>}
    <Dialog open={identityAction?.mode === "link"} onOpenChange={(open) => { if (!open) closeIdentityAction(); }}>
      <DialogContent><DialogHeader><DialogTitle>Link attendance Device ID</DialogTitle><DialogDescription>Machine information is context only. Select the canonical OperatorOS student and confirm the link.</DialogDescription></DialogHeader>{identityAction && <div className="mt-5 space-y-4"><dl className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"><div><dt className="text-xs font-bold text-muted-foreground">Device ID</dt><dd className="font-bold">{identityAction.item.deviceIdentifier}</dd></div><div><dt className="text-xs font-bold text-muted-foreground">Machine name</dt><dd>{identityAction.item.machineName ?? "Not recorded"}</dd></div></dl><div><FieldLabel htmlFor="machine-student-search">Search active student</FieldLabel><Input id="machine-student-search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setSelectedStudentId(null); }} placeholder="Search by canonical name or identifier" autoComplete="off" />{studentResults.isPending && <p className="mt-2 text-sm text-muted-foreground">Searching canonical students…</p>}{studentResults.error && <p role="alert" className="mt-2 text-sm text-rose-700">{getPageApiError(studentResults.error, "Student search is unavailable.")}</p>}<div className="mt-2 space-y-2" role="listbox" aria-label="Canonical student search results">{studentResults.data?.items.map((student) => <button key={student.id} type="button" role="option" aria-selected={selectedStudentId === student.id} className={`block w-full rounded-lg border p-3 text-left ${selectedStudentId === student.id ? "border-brand bg-brand/5" : "border-border hover:bg-surface-muted"}`} onClick={() => setSelectedStudentId(student.id)}><span className="font-bold">{student.full_name}</span><span className="block text-xs text-muted-foreground">{student.current_jenjang ?? "No jenjang"} · {student.current_class ?? "No class"}</span></button>)}{!studentResults.isPending && studentResults.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No active student found in the selected import scope.</p>}</div></div>{selectedStudent && <p className="rounded-lg bg-surface-muted p-3 text-sm">Selected student: <strong>{selectedStudent.full_name}</strong>. Device ID will be linked only after you confirm.</p>}{link.error && <p role="alert" className="text-sm font-semibold text-rose-700">{getPageApiError(link.error, "The Device ID could not be linked.")}</p>}</div>}<DialogFooter><Button variant="outline" onClick={closeIdentityAction} disabled={link.isPending}>Cancel</Button><Button disabled={!identityAction || !selectedStudentId || link.isPending} onClick={() => { if (identityAction && selectedStudentId && identityAction.item.effectiveFrom) link.mutate({ device_identifier: identityAction.item.deviceIdentifier, student_master_id: selectedStudentId, effective_from: identityAction.item.effectiveFrom, confirmation: "LINK_ATTENDANCE_DEVICE_ID" }); }}>{link.isPending ? "Linking…" : "Link Device ID"}</Button></DialogFooter></DialogContent>
    </Dialog>
    <Dialog open={identityAction?.mode === "create"} onOpenChange={(open) => { if (!open) closeIdentityAction(); }}>
      <DialogContent><DialogHeader><DialogTitle>Create student and link Device ID</DialogTitle><DialogDescription>Create the canonical student through the existing student authority. Only the machine name is prefilled, and all other canonical fields remain operator-owned.</DialogDescription></DialogHeader>{identityAction && <div className="mt-5 space-y-4"><dl className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"><div><dt className="text-xs font-bold text-muted-foreground">Device ID</dt><dd className="font-bold">{identityAction.item.deviceIdentifier}</dd></div><div><dt className="text-xs font-bold text-muted-foreground">Source date</dt><dd>{identityAction.item.effectiveFrom ?? "Not recorded"}</dd></div></dl><div><FieldLabel htmlFor="machine-new-student-name">Canonical student name</FieldLabel><Input id="machine-new-student-name" value={createName} onChange={(event) => setCreateName(event.target.value)} required autoFocus /></div><label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"><input type="checkbox" checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} className="mt-1" /> <span>I confirm this is a new canonical student. The machine name is only a suggested value.</span></label><p className="text-sm text-muted-foreground">No NIS, NISN, birth date, gender, or enrollment is fabricated. Add any required enrollment through the canonical student workflow after creation.</p>{create.error && <p role="alert" className="text-sm font-semibold text-rose-700">{getPageApiError(create.error, "The student could not be created.")}</p>}</div>}<DialogFooter><Button variant="outline" onClick={closeIdentityAction} disabled={create.isPending}>Cancel</Button><Button disabled={!identityAction || !createName.trim() || !createConfirmed || create.isPending} onClick={() => { if (identityAction && createName.trim()) create.mutate({ item: identityAction.item, fullName: createName.trim() }); }}>{create.isPending ? "Creating student…" : "Create student and link Device ID"}</Button></DialogFooter></DialogContent>
    </Dialog>
  </div>;
}
