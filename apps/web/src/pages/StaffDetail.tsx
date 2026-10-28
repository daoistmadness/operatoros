import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { cancelStaffSchoolUnitAssignment, closeStaffSchoolUnitAssignment, createStaffEducation, createStaffSchoolUnitAssignment, deleteStaffEducation, fetchJenjangOptions, fetchSchoolUnits, fetchSensitiveStaff, fetchStaffDetail, fetchStaffHistory, replaceStaffJenjangs, updateStaffEducation, updateStaffEmployment, type EducationRecord } from "../api/staff";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common/page-header";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { queryKeys } from "../lib/query/queryKeys";

const EDUCATION_LEVELS = ["SD", "SMP", "SMA", "SMK", "D1", "D2", "D3", "D4", "S1", "S2", "S3"];

function schoolToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function FieldValue({ label, value }: { label: string; value: unknown }) {
  const display = value === null || value === undefined || value === "" ? "—" : String(value);
  return <div><dt className="text-xs font-black uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{display}</dd></div>;
}

function educationPayload(record: Partial<EducationRecord>) {
  return {
    education_level: record.education_level || "S1",
    institution_name: record.institution_name || "",
    major: record.major || null,
    graduation_year: record.graduation_year || null,
    notes: record.notes || null,
  };
}

export default function StaffDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.staff.detail(id), queryFn: () => fetchStaffDetail(id), enabled: Boolean(id) });
  const sensitive = useQuery({ queryKey: queryKeys.staff.sensitive(id), queryFn: () => fetchSensitiveStaff(id), enabled: Boolean(id) && can("view_staff_sensitive") });
  const history = useQuery({ queryKey: queryKeys.staff.history(id), queryFn: () => fetchStaffHistory(id), enabled: Boolean(id) && can("view_staff_audit") });
  const schoolUnits = useQuery({ queryKey: queryKeys.staff.schoolUnits, queryFn: fetchSchoolUnits, enabled: Boolean(id) && can("view_staff") });
  const jenjangs = useQuery({ queryKey: queryKeys.academicMasters.jenjangs, queryFn: fetchJenjangOptions });
  const [selectedJenjangs, setSelectedJenjangs] = useState<number[]>([]);
  const [employmentStatus, setEmploymentStatus] = useState<"ACTIVE" | "FORMER">("ACTIVE");
  const [effectiveDate, setEffectiveDate] = useState(schoolToday);
  const [education, setEducation] = useState<Partial<EducationRecord>>({ education_level: "S1" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<EducationRecord | null>(null);
  const [assignmentUnitId, setAssignmentUnitId] = useState("");
  const [assignmentStartDate, setAssignmentStartDate] = useState(schoolToday);
  const [assignmentPtk, setAssignmentPtk] = useState<"APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN">("UNKNOWN");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [closeDrafts, setCloseDrafts] = useState<Record<number, { effective_to: string; reason: string }>>({});
  const [cancelReasons, setCancelReasons] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!detail.data) return;
    setSelectedJenjangs(detail.data.jenjangs.map((item) => item.id));
    setEmploymentStatus(detail.data.employment_status === "FORMER" ? "FORMER" : "ACTIVE");
  }, [detail.data]);
  const refresh = async () => Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.staff.detail(id) }), queryClient.invalidateQueries({ queryKey: queryKeys.staff.lists }), queryClient.invalidateQueries({ queryKey: queryKeys.staff.history(id) }), queryClient.invalidateQueries({ queryKey: ["staff", "analytics"] })]);
  const jenjangMutation = useMutation({ mutationFn: () => replaceStaffJenjangs(id, selectedJenjangs), onSuccess: refresh });
  const assignmentMutation = useMutation({
    mutationFn: () => createStaffSchoolUnitAssignment(id, { school_unit_id: Number(assignmentUnitId), effective_from: assignmentStartDate, ptk_applicability: assignmentPtk, reason: assignmentReason }),
    onSuccess: () => { setAssignmentReason(""); return refresh(); },
  });
  const closeAssignmentMutation = useMutation({
    mutationFn: ({ assignmentId, body }: { assignmentId: number; body: { effective_to: string; reason: string } }) => closeStaffSchoolUnitAssignment(id, assignmentId, body),
    onSuccess: (_result, { assignmentId }) => { setCloseDrafts((current) => { const next = { ...current }; delete next[assignmentId]; return next; }); return refresh(); },
  });
  const cancelAssignmentMutation = useMutation({
    mutationFn: ({ assignmentId, reason }: { assignmentId: number; reason: string }) => cancelStaffSchoolUnitAssignment(id, assignmentId, { reason }),
    onSuccess: (_result, { assignmentId }) => { setCancelReasons((current) => { const next = { ...current }; delete next[assignmentId]; return next; }); return refresh(); },
  });
  const employmentMutation = useMutation({ mutationFn: () => updateStaffEmployment(id, employmentStatus, effectiveDate), onSuccess: refresh });
  const educationMutation = useMutation({
    mutationFn: () => editingId ? updateStaffEducation(id, editingId, educationPayload(education)) : createStaffEducation(id, educationPayload(education)),
    onSuccess: () => { setEducation({ education_level: "S1" }); setEditingId(null); refresh(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (educationId: number) => deleteStaffEducation(id, educationId),
    onSuccess: () => { setDeleteConfirmation(null); return refresh(); },
  });
  if (detail.isPending) return <LoadingState title="Loading employee profile" />;
  if (detail.isError || !detail.data) return <ErrorState title="Employee profile could not be loaded" description={detail.error?.message} />;
  const member = detail.data;
  const activeJenjangs = jenjangs.data || [];
  const error = jenjangMutation.error || employmentMutation.error || assignmentMutation.error || closeAssignmentMutation.error || cancelAssignmentMutation.error || educationMutation.error;
  const assignmentHistory = history.data?.filter((event) => event.action === "STAFF_SCHOOL_UNIT_ASSIGNMENT_PERIOD") ?? [];
  const otherHistory = history.data?.filter((event) => event.action !== "STAFF_SCHOOL_UNIT_ASSIGNMENT_PERIOD") ?? [];
  return <div className="space-y-6">
    <Link to="/staff" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="size-4" />Back to Employee Directory</Link>
    <PageHeader eyebrow="Employee profile" title={member.full_name} description="Employment status and position changes are recorded in the employee history." actions={<div className="flex items-center gap-2"><Badge variant={member.employment_status === "ACTIVE" ? "success" : "secondary"}>{member.employment_status}</Badge>{can("manage_staff") && <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 py-2 text-sm font-bold" to={`/staff/${id}/edit`}>Edit profile</Link>}</div>} />
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{(error as Error).message}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Basic identity</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Source staff ID" value={member.source_staff_id} /><FieldValue label="Name" value={member.full_name} /><FieldValue label="NIP" value={member.identifiers.find((item) => item.identifier_type === "NIP")?.normalized_value} />{can("view_staff_sensitive") && <><FieldValue label="NIK" value={sensitive.data?.identifiers.find((item) => item.type === "NIK")?.normalized_value} /><FieldValue label="Birth place" value={sensitive.data?.birth_place} /><FieldValue label="Birth date" value={sensitive.data?.birth_date} /><FieldValue label="Age" value={sensitive.data?.age_years} /></>}</dl>{can("view_staff_sensitive") && sensitive.isError && <p role="alert" className="mt-3 text-sm text-rose-700">Sensitive identity information is unavailable.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Employment</CardTitle></CardHeader><CardContent className="space-y-4"><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Status" value={member.employment_status} /><FieldValue label="Position" value={member.job_title} /><FieldValue label="Start date" value={member.employment_start_date} /><FieldValue label="End date" value={member.employment_end_date} /><FieldValue label="Tenure" value={member.service_years !== null ? `${member.service_years} years ${member.service_months || 0} months` : "Unavailable"} /></dl>{can("manage_staff") && <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div><Label htmlFor="employment-status">Employment status</Label><NativeSelect id="employment-status" value={employmentStatus} onChange={(event) => setEmploymentStatus(event.target.value as "ACTIVE" | "FORMER")}><option value="ACTIVE">Active</option><option value="FORMER">Former</option></NativeSelect></div><div><Label htmlFor="employment-effective-date">Effective date</Label><Input id="employment-effective-date" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div><Button className="self-end" onClick={() => employmentMutation.mutate()} disabled={employmentMutation.isPending || !effectiveDate}>{employmentMutation.isPending ? "Saving…" : "Change status"}</Button></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>School unit assignments</CardTitle><p className="text-sm text-muted-foreground">Unit history is dated separately from jenjang and employment status.</p></CardHeader><CardContent className="space-y-4">
        {schoolUnits.isPending ? <LoadingState title="Loading school units" /> : schoolUnits.isError ? <p role="alert" className="text-sm text-rose-700">School units could not be loaded.</p> : null}
        {member.school_unit_assignments.length ? <div className="space-y-3">{member.school_unit_assignments.map((assignment) => {
          const draft = closeDrafts[assignment.id] ?? { effective_to: schoolToday(), reason: "" };
          const upcoming = assignment.effective_from > schoolToday();
          const cancelling = cancelAssignmentMutation.isPending && cancelAssignmentMutation.variables?.assignmentId === assignment.id;
          const closing = closeAssignmentMutation.isPending && closeAssignmentMutation.variables?.assignmentId === assignment.id;
          return <div key={assignment.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-black">{assignment.school_unit_name}</p>{upcoming && <Badge variant="secondary">Upcoming</Badge>}<Badge variant={assignment.school_unit_status === "ACTIVE" ? "success" : "secondary"}>{assignment.school_unit_status}</Badge><Badge variant={assignment.ptk_applicability === "APPLICABLE" ? "information" : assignment.ptk_applicability === "UNKNOWN" ? "warning" : "secondary"}>PTK {assignment.ptk_applicability.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{assignment.effective_from} through {assignment.effective_to ?? "Open"}</p><p className="mt-1 text-sm">Reason: {assignment.reason}</p>{can("manage_staff") && assignment.effective_to === null && (upcoming ? <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><div><Label htmlFor={`assignment-cancel-reason-${assignment.id}`}>Cancellation reason</Label><Input id={`assignment-cancel-reason-${assignment.id}`} value={cancelReasons[assignment.id] ?? ""} onChange={(event) => setCancelReasons((current) => ({ ...current, [assignment.id]: event.target.value }))} disabled={cancelling} /></div><Button className="self-end" variant="outline" onClick={() => cancelAssignmentMutation.mutate({ assignmentId: assignment.id, reason: cancelReasons[assignment.id] ?? "" })} disabled={cancelAssignmentMutation.isPending || !(cancelReasons[assignment.id] ?? "").trim()}>{cancelling ? "Saving…" : "Cancel assignment"}</Button></div> : <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div><Label htmlFor={`assignment-close-date-${assignment.id}`}>Effective through</Label><Input id={`assignment-close-date-${assignment.id}`} type="date" min={assignment.effective_from} value={draft.effective_to} onChange={(event) => setCloseDrafts((current) => ({ ...current, [assignment.id]: { ...draft, effective_to: event.target.value } }))} disabled={closing} /></div><div><Label htmlFor={`assignment-close-reason-${assignment.id}`}>Close reason</Label><Input id={`assignment-close-reason-${assignment.id}`} value={draft.reason} onChange={(event) => setCloseDrafts((current) => ({ ...current, [assignment.id]: { ...draft, reason: event.target.value } }))} disabled={closing} /></div><Button className="self-end" variant="outline" onClick={() => closeAssignmentMutation.mutate({ assignmentId: assignment.id, body: draft })} disabled={closeAssignmentMutation.isPending || !draft.effective_to || !draft.reason.trim()}>{closing ? "Saving…" : "Close assignment"}</Button></div>)}</div>;
        })}</div> : <p className="text-sm text-muted-foreground">No current or upcoming school unit assignments.</p>}
        {can("view_staff_audit") && <section aria-label="Assignment periods"><h3 className="text-sm font-bold">Assignment history</h3>{history.isPending ? <LoadingState title="Loading assignment history" /> : history.isError ? <p role="alert">Assignment history could not be loaded.</p> : assignmentHistory.length ? <ul className="mt-2 space-y-2">{assignmentHistory.map((event) => { const cancelled = typeof event.metadata.cancelled_at === "string"; return <li key={event.id} className="rounded-lg border border-border p-3 text-sm"><p className="flex items-center gap-2 font-bold">{String(event.metadata.school_unit_name)} · PTK {String(event.metadata.ptk_applicability).replaceAll("_", " ")}{cancelled && <Badge variant="warning">Cancelled</Badge>}</p><p>{String(event.metadata.effective_from)} through {String(event.metadata.effective_to ?? (cancelled ? "Cancelled" : "Open"))}</p><p>Reason: {String(event.metadata.assignment_reason ?? "")}</p>{typeof event.metadata.closed_reason === "string" && <p>Close reason: {event.metadata.closed_reason}</p>}{cancelled && <><p>Cancellation reason: {String(event.metadata.cancelled_reason ?? event.reason ?? "")}</p><p>Cancelled by {String(event.metadata.cancelled_by)} at {String(event.metadata.cancelled_at)}</p></>}</li>; })}</ul> : <p className="mt-2 text-sm text-muted-foreground">No assignment history yet.</p>}</section>}
        {can("manage_staff") && <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"><div><Label htmlFor="assignment-school-unit">School unit</Label><NativeSelect id="assignment-school-unit" value={assignmentUnitId} onChange={(event) => setAssignmentUnitId(event.target.value)} disabled={assignmentMutation.isPending}><option value="">Choose a unit</option>{schoolUnits.data?.filter((unit) => unit.status === "ACTIVE").map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</NativeSelect></div><div><Label htmlFor="assignment-start-date">Effective from</Label><Input id="assignment-start-date" type="date" value={assignmentStartDate} onChange={(event) => setAssignmentStartDate(event.target.value)} disabled={assignmentMutation.isPending} /></div><div><Label htmlFor="assignment-ptk">PTK applicability</Label><NativeSelect id="assignment-ptk" value={assignmentPtk} onChange={(event) => setAssignmentPtk(event.target.value as "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN")} disabled={assignmentMutation.isPending}><option value="UNKNOWN">Unknown</option><option value="APPLICABLE">Applicable</option><option value="NOT_APPLICABLE">Not applicable</option></NativeSelect></div><div><Label htmlFor="assignment-reason">Reason</Label><Input id="assignment-reason" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} disabled={assignmentMutation.isPending} /></div><div className="sm:col-span-2"><Button onClick={() => assignmentMutation.mutate()} disabled={assignmentMutation.isPending || !assignmentUnitId || !assignmentStartDate || !assignmentReason.trim()}>{assignmentMutation.isPending ? "Saving…" : "Add assignment"}</Button></div></div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>DAPODIK and NUPTK</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="DAPODIK status" value={member.dapodik_status.replaceAll("_", " ")} /><FieldValue label="NUPTK availability" value={member.has_nuptk ? "Available" : "Missing"} />{can("view_staff_sensitive") && <FieldValue label="NUPTK" value={sensitive.data?.identifiers.find((item) => item.type === "NUPTK")?.normalized_value} />}</dl></CardContent></Card>
      {can("view_staff_sensitive") && <Card><CardHeader><CardTitle>Contact</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Email" value={sensitive.data?.contact?.email} /><FieldValue label="Phone" value={sensitive.data?.contact?.phone} /><FieldValue label="Address" value={sensitive.data?.contact?.address} /></dl></CardContent></Card>}
    </div>
    <Card><CardHeader><CardTitle>Jenjang assignment</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Use canonical academic-master jenjangs. The source workbook does not assign an organizational unit.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{activeJenjangs.map((item) => { const checked = selectedJenjangs.includes(item.id); const assignedInactive = checked && !item.active; return <label key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm"><input type="checkbox" checked={checked} disabled={!can("manage_staff") || !item.active && !assignedInactive} onChange={() => setSelectedJenjangs((current) => checked ? current.filter((idValue) => idValue !== item.id) : [...current, item.id])} />{item.name}{assignedInactive && <Badge variant="warning">inactive</Badge>}</label>; })}</div>{can("manage_staff") && <Button onClick={() => jenjangMutation.mutate()} disabled={jenjangMutation.isPending}>{jenjangMutation.isPending ? "Saving assignments…" : "Save jenjang assignments"}</Button>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Education history</CardTitle></CardHeader><CardContent className="space-y-4">{can("manage_staff") && <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"><div><Label htmlFor="education-level">Education level</Label><NativeSelect id="education-level" value={education.education_level || "S1"} onChange={(event) => setEducation((current) => ({ ...current, education_level: event.target.value }))}>{EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</NativeSelect></div><div><Label htmlFor="education-institution">Institution</Label><Input id="education-institution" required value={education.institution_name || ""} onChange={(event) => setEducation((current) => ({ ...current, institution_name: event.target.value }))} /></div><div><Label htmlFor="education-major">Major</Label><Input id="education-major" value={education.major || ""} onChange={(event) => setEducation((current) => ({ ...current, major: event.target.value }))} /></div><div><Label htmlFor="education-year">Graduation year</Label><Input id="education-year" type="number" min="1900" max="2200" value={education.graduation_year || ""} onChange={(event) => setEducation((current) => ({ ...current, graduation_year: event.target.value ? Number(event.target.value) : null }))} /></div><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={() => educationMutation.mutate()} disabled={educationMutation.isPending || !education.institution_name}>{editingId ? <><Pencil className="size-4" />Update education</> : <><Plus className="size-4" />Add education</>}</Button>{editingId && <Button variant="outline" onClick={() => { setEditingId(null); setEducation({ education_level: "S1" }); }}>Cancel</Button>}</div></div>}<div className="rounded-xl border border-border p-4"><p className="text-sm font-black">Highest education: {member.highest_education_level || "—"}{member.highest_education_institution ? ` · ${member.highest_education_institution}` : ""}</p><div className="mt-3 space-y-2">{member.education_history.length ? member.education_history.map((record) => <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-3"><div><p className="font-black">{record.education_level} · {record.institution_name}</p><p className="text-sm text-muted-foreground">{record.major || "No major recorded"}{record.graduation_year ? ` · ${record.graduation_year}` : ""}</p></div>{can("manage_staff") && <div className="flex gap-2"><Button variant="outline" size="sm" aria-label={`Edit ${record.education_level}`} onClick={() => { setEditingId(record.id); setEducation(record); }}><Pencil className="size-4" /></Button><Button variant="danger" size="sm" aria-label={`Delete education record ${record.education_level}`} onClick={() => { deleteMutation.reset(); setDeleteConfirmation(record); }} disabled={deleteMutation.isPending}><Trash2 className="size-4" /></Button></div>}</div>) : <p className="text-sm text-muted-foreground">No education records yet. The workbook does not supply education history.</p>}</div></div></CardContent></Card>
    {can("view_staff_audit") && <Card><CardHeader><CardTitle>Employment and change history</CardTitle><p className="text-sm text-muted-foreground">A blank effective date means the workbook or earlier system did not provide a reliable date.</p></CardHeader><CardContent>{history.isPending ? <LoadingState title="Loading employee history" /> : history.isError ? <p role="alert" className="text-sm text-rose-700">History could not be loaded.</p> : otherHistory.length ? <ol className="space-y-3">{otherHistory.map((event) => <li key={event.id} className="rounded-lg border border-border p-3"><p className="font-bold">{event.action.replaceAll("_", " ")}</p><p className="text-sm text-muted-foreground">Effective: {event.effective_date ?? "Unknown"} · Recorded by {event.actor} · {event.created_at}</p>{typeof event.metadata.employment_status === "string" && <p className="mt-1 text-sm">{event.metadata.employment_status}{typeof event.metadata.position_title === "string" && event.metadata.position_title ? ` · ${event.metadata.position_title}` : ""}</p>}{event.reason && <p className="mt-1 text-sm">Reason: {event.reason}</p>}</li>)}</ol> : <p className="text-sm text-muted-foreground">No employment history is available.</p>}</CardContent></Card>}
    <Dialog open={Boolean(deleteConfirmation)} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteConfirmation(null); }}>
      <DialogContent role="alertdialog" showClose={false}>
        <DialogHeader>
          <DialogTitle>Delete education record?</DialogTitle>
          <DialogDescription>
            {deleteConfirmation
              ? `This permanently removes the ${deleteConfirmation.education_level} education record from the employee profile.`
              : "This permanently removes this education record from the employee profile."}
          </DialogDescription>
        </DialogHeader>
        {deleteMutation.error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{deleteMutation.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteConfirmation(null)} disabled={deleteMutation.isPending}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (deleteConfirmation && !deleteMutation.isPending) deleteMutation.mutate(deleteConfirmation.id); }} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting…" : "Delete record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
