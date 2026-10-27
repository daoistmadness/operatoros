import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Edit, Link2, MoveRight, FileText, CheckCircle2, AlertCircle, Clock, Download, Upload, Plus } from "lucide-react";
import { useAddStudentGuardian, useCreateEnrollment, useDeleteStudentGuardian, useEndEnrollment, useLegacyLinkStatus, useLinkLegacyStudent, useReassignDevice, useReplaceDevice, useRetireDevice, useStudent, useStudentEnrollments, useStudentHistory, useStudentOverview, useTransferEnrollment, useUpdateStudent, useUpdateStudentDocuments, useUpdateStudentGuardian, useUpdateStudentHealth, useUpdateIdentityVerification, useUpdateDapodikStatus, useUploadIomDocument, useUpdateIomDocument } from "../hooks/useStudentQueries";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { useAuth } from "../context/AuthContext";
import { createDownloadUrl, revokeDownloadUrl } from "../lib/api/client";
import { downloadStudentAttendanceHistoryExcel } from "../lib/api/endpoints";
import { downloadIomDocumentBlob } from "../api/students";
import { Student360Overview } from "../components/students/Student360Overview";

const today = new Date().toISOString().slice(0, 10);
const identityFields = ["full_name", "preferred_name", "nipd", "nisn", "nik", "birth_place", "birth_date", "gender", "religion", "citizenship", "blood_type", "student_status", "admission_date", "admission_type", "previous_school"];

function DefinitionList({ values }: { values: Record<string, unknown> }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(values).map(([key, value]) => <div key={key}><dt className="text-xs font-black uppercase tracking-wide text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd className="mt-1 break-words text-sm text-foreground">{String(value || "Not provided")}</dd></div>)}</dl>;
}

function ProfileEditDialog({ id, profile, open, onOpenChange }: any) {
  const update = useUpdateStudent(id);
  const [identity, setIdentity] = useState<Record<string, any>>({});
  const [contact, setContact] = useState<Record<string, any>>({});
  useEffect(() => { if (open) { setIdentity({ ...profile.identity }); setContact({ ...profile.contact }); } }, [open, profile]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await update.mutateAsync({ record_version: profile.record_version, identity, contact, guardians: profile.guardians, reason: "Updated from Student Profile" });
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Edit student profile</DialogTitle><DialogDescription>Canonical UUID and historical records cannot be changed here. Stale forms are rejected.</DialogDescription></DialogHeader>
    {update.error && <Alert variant="danger"><AlertTitle>Profile was not saved</AlertTitle><AlertDescription>{update.error.message}</AlertDescription></Alert>}
    <form id="profile-edit-form" className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      {identityFields.map((field) => field === "student_status" ? <div key={field}><Label htmlFor={`edit-${field}`}>Student status</Label><NativeSelect id={`edit-${field}`} value={identity[field] || "active"} onChange={(event) => setIdentity((current) => ({ ...current, [field]: event.target.value }))}><option value="active">Active</option><option value="pending_review">Pending review</option><option value="inactive">Inactive</option><option value="transferred">Transferred</option><option value="withdrawn">Withdrawn</option><option value="graduated">Graduated</option><option value="archived">Archived</option></NativeSelect></div> : <div key={field}><Label htmlFor={`edit-${field}`}>{field.replaceAll("_", " ")}</Label><Input id={`edit-${field}`} required={field === "full_name"} type={field.includes("date") ? "date" : "text"} value={identity[field] || ""} onChange={(event) => setIdentity((current) => ({ ...current, [field]: event.target.value || null }))} /></div>)}
      {["address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code", "student_phone", "student_email"].map((field) => <div key={field}><Label htmlFor={`edit-${field}`}>{field.replaceAll("_", " ")}</Label><Input id={`edit-${field}`} type={field === "student_email" ? "email" : "text"} value={contact[field] || ""} onChange={(event) => setContact((current) => ({ ...current, [field]: event.target.value || null }))} /></div>)}
    </form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancel</Button><Button type="submit" form="profile-edit-form" disabled={update.isPending}>{update.isPending ? "Saving profile…" : "Save profile"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function GuardianManager({ id, guardians }: { id: string; guardians: Array<Record<string, any>> }) {
  const add = useAddStudentGuardian(id); const update = useUpdateStudentGuardian(id); const remove = useDeleteStudentGuardian(id);
  const empty = { guardian_type: "guardian", name: "", phone: "", email: "" };
  const [values, setValues] = useState(empty); const [editingId, setEditingId] = useState<number | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (editingId) await update.mutateAsync({ guardianId: editingId, payload: values }); else await add.mutateAsync(values); setValues(empty); setEditingId(null); };
  const pending = add.isPending || update.isPending || remove.isPending;
  return <div className="space-y-4"><div className="space-y-3">{guardians.map((guardian) => <div key={String(guardian.id)} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4"><DefinitionList values={guardian} /><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setEditingId(Number(guardian.id)); setValues({ guardian_type: String(guardian.guardian_type || "guardian"), name: String(guardian.name || ""), phone: String(guardian.phone || ""), email: String(guardian.email || "") }); }}>Edit</Button><Button variant="danger" size="sm" disabled={pending} onClick={() => { if (window.confirm("Remove this guardian?")) void remove.mutateAsync(Number(guardian.id)); }}>Remove</Button></div></div>)}</div><form className="grid gap-3 rounded-xl border border-dashed border-border p-4 sm:grid-cols-4" onSubmit={save}><div><Label htmlFor="guardian-type">Relationship</Label><NativeSelect id="guardian-type" value={values.guardian_type} onChange={(event) => setValues((current) => ({ ...current, guardian_type: event.target.value }))}><option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option></NativeSelect></div><div><Label htmlFor="guardian-name">Name</Label><Input id="guardian-name" required value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></div><div><Label htmlFor="guardian-phone">Phone</Label><Input id="guardian-phone" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} /></div><div><Label htmlFor="guardian-email">Email</Label><Input id="guardian-email" type="email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} /></div><div className="sm:col-span-4 flex gap-2"><Button type="submit" disabled={pending}>{editingId ? "Save guardian" : "Add guardian"}</Button>{editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setValues(empty); }}>Cancel</Button>}</div></form></div>;
}

function SensitiveProfileEditor({ id, profile }: { id: string; profile: any }) {
  const saveHealth = useUpdateStudentHealth(id); const saveDocuments = useUpdateStudentDocuments(id);
  const [health, setHealth] = useState({ allergy: profile.health?.allergy || "", medical_condition: profile.health?.medical_condition || "", special_needs: profile.health?.special_needs || "" });
  const [documents, setDocuments] = useState<Record<string, boolean>>({ ...(profile.document_status || {}) });
  const documentFields = ["family_card_received", "birth_certificate_received", "parent_id_received", "school_agreement_received", "publication_consent_received"];
  return <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Health profile</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); await saveHealth.mutateAsync(health); }}><div><Label htmlFor="health-allergy">Allergies</Label><Input id="health-allergy" value={health.allergy} onChange={(event) => setHealth((current) => ({ ...current, allergy: event.target.value }))} /></div><div><Label htmlFor="health-medical">Medical notes</Label><Input id="health-medical" value={health.medical_condition} onChange={(event) => setHealth((current) => ({ ...current, medical_condition: event.target.value }))} /></div><div><Label htmlFor="health-needs">Special needs</Label><Input id="health-needs" value={health.special_needs} onChange={(event) => setHealth((current) => ({ ...current, special_needs: event.target.value }))} /></div><Button type="submit" disabled={saveHealth.isPending}>{saveHealth.isPending ? "Saving…" : "Save health profile"}</Button></form></CardContent></Card><Card><CardHeader><CardTitle>Document status</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); await saveDocuments.mutateAsync(documents); }}><div className="grid gap-2">{documentFields.map((field) => <label key={field} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span>{field.replaceAll("_", " ")}</span><NativeSelect aria-label={field} value={documents[field] ? "received" : "missing"} onChange={(event) => setDocuments((current) => ({ ...current, [field]: event.target.value === "received" }))}><option value="received">Received</option><option value="missing">Missing</option></NativeSelect></label>)}</div><Button type="submit" disabled={saveDocuments.isPending}>{saveDocuments.isPending ? "Saving…" : "Save document status"}</Button></form></CardContent></Card></div>;
}

function DeviceDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const replace = useReplaceDevice(id); const reassign = useReassignDevice(id);
  const [deviceId, setDeviceId] = useState(""); const [effective, setEffective] = useState(today); const [reason, setReason] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); await replace.mutateAsync({ device_identifier: deviceId, device_source: "attendance_machine", effective_from: effective, reason, confirmation: "REPLACE_ATTENDANCE_DEVICE_ID" }); onOpenChange(false); };
  const detail = (replace.error as any)?.data?.detail;
  const conflictStudentId = detail?.code === "DEVICE_ID_IN_USE" ? detail.student_master_id : null;
  const guardedReassign = async () => { await reassign.mutateAsync({ device_identifier: deviceId, device_source: "attendance_machine", effective_from: effective, reason, previous_student_master_id: conflictStudentId, confirmation: "REASSIGN_ATTENDANCE_DEVICE_ID" }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Assign or replace Attendance Device ID</DialogTitle><DialogDescription>The previous mapping is retired and retained. Historical attendance is not rewritten.</DialogDescription></DialogHeader>{replace.error && <Alert variant="danger"><AlertTitle>{conflictStudentId ? "Attendance Device ID already in use" : "Device ID was not changed"}</AlertTitle><AlertDescription>{conflictStudentId ? <>This active ID belongs to another canonical student. <Link className="font-bold underline" to={`/students/${conflictStudentId}`}>Open linked student</Link> before reassignment.</> : replace.error.message}</AlertDescription></Alert>}<form id="device-form" className="mt-5 space-y-4" onSubmit={submit}><div><Label htmlFor="profile-device-id">New Attendance Device ID</Label><Input id="profile-device-id" inputMode="numeric" required value={deviceId} onChange={(event) => setDeviceId(event.target.value)} /></div><div><Label htmlFor="profile-device-date">Effective from</Label><Input id="profile-device-date" type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} /></div><div><Label htmlFor="profile-device-reason">Reason</Label><Input id="profile-device-reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div></form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>{conflictStudentId ? <Button variant="danger" onClick={guardedReassign} disabled={reassign.isPending || reason.length < 3}>{reassign.isPending ? "Reassigning Device ID…" : "Confirm guarded reassignment"}</Button> : <Button type="submit" form="device-form" disabled={replace.isPending}>{replace.isPending ? "Updating device…" : "Confirm device change"}</Button>}</DialogFooter></DialogContent></Dialog>;
}

function EnrollmentDialog({ studentId, current, open, onOpenChange }: any) {
  const create = useCreateEnrollment(studentId); const transfer = useTransferEnrollment(studentId);
  const [yearId, setYearId] = useState(""); const [classId, setClassId] = useState(""); const [effective, setEffective] = useState(today); const [reason, setReason] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (current) await transfer.mutateAsync({ id: current.id, payload: { target_class_id: Number(classId), effective_date: effective, reason, confirmation: "TRANSFER_STUDENT_ENROLLMENT" } }); else await create.mutateAsync({ academic_year_id: Number(yearId), academic_class_id: Number(classId), effective_from: effective }); onOpenChange(false); };
  const pending = create.isPending || transfer.isPending; const error = create.error || transfer.error;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{current ? "Transfer academic class" : "Create academic enrollment"}</DialogTitle><DialogDescription>{current ? "The previous class period remains in enrollment history." : "Academic enrollment can be created before an Attendance Device ID is linked."}</DialogDescription></DialogHeader>{error && <Alert variant="danger"><AlertTitle>Enrollment was not changed</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}<form id="enrollment-form" className="mt-5 space-y-4" onSubmit={submit}>{!current && <div><Label htmlFor="profile-year-id">Academic year ID</Label><Input id="profile-year-id" type="number" min="1" required value={yearId} onChange={(event) => setYearId(event.target.value)} /></div>}<div><Label htmlFor="profile-class-id">Target academic class ID</Label><Input id="profile-class-id" type="number" min="1" required value={classId} onChange={(event) => setClassId(event.target.value)} /></div><div><Label htmlFor="profile-transfer-date">Effective date</Label><Input id="profile-transfer-date" type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} /></div>{current && <div><Label htmlFor="profile-transfer-reason">Transfer reason</Label><Input id="profile-transfer-reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div>}</form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" form="enrollment-form" disabled={pending}>{pending ? "Saving enrollment…" : current ? "Confirm transfer" : "Create enrollment"}</Button></DialogFooter></DialogContent></Dialog>;
}

function RetireDeviceDialog({ studentId, device, open, onOpenChange }: any) {
  const retire = useRetireDevice(studentId); const [effective, setEffective] = useState(today); const [reason, setReason] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); await retire.mutateAsync({ identityId: device.id, payload: { effective_to: effective, reason, confirmation: "RETIRE_ATTENDANCE_DEVICE_ID" } }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Retire Attendance Device ID</DialogTitle><DialogDescription>Retiring {device?.device_identifier} prevents future matching through this mapping. Historical attendance remains intact.</DialogDescription></DialogHeader><form id="retire-device-form" className="mt-5 space-y-4" onSubmit={submit}><div><Label htmlFor="retire-device-date">Effective to</Label><Input id="retire-device-date" type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} /></div><div><Label htmlFor="retire-device-reason">Reason</Label><Input id="retire-device-reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div></form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" type="submit" form="retire-device-form" disabled={retire.isPending}>{retire.isPending ? "Retiring Device ID…" : "Confirm retirement"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EndEnrollmentDialog({ studentId, enrollment, open, onOpenChange }: any) {
  const end = useEndEnrollment(studentId); const [effective, setEffective] = useState(today); const [reason, setReason] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); await end.mutateAsync({ id: enrollment.id, payload: { effective_date: effective, reason, confirmation: "END_STUDENT_ENROLLMENT" } }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent role="alertdialog" showClose={false}><DialogHeader><DialogTitle>End academic enrollment?</DialogTitle><DialogDescription>This closes the current enrollment and class-history period. It does not delete the student or academic history.</DialogDescription></DialogHeader><form id="end-enrollment-form" className="mt-5 space-y-4" onSubmit={submit}><div><Label htmlFor="end-enrollment-date">Effective date</Label><Input id="end-enrollment-date" type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} /></div><div><Label htmlFor="end-enrollment-reason">Reason</Label><Input id="end-enrollment-reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div></form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" type="submit" form="end-enrollment-form" disabled={end.isPending}>{end.isPending ? "Ending enrollment…" : "Confirm end enrollment"}</Button></DialogFooter></DialogContent></Dialog>;
}

function LegacyLinkDialog({ id, status, open, onOpenChange }: { id: string; status: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const link = useLinkLegacyStudent(id);
  const [legacyId, setLegacyId] = useState("");
  const [reason, setReason] = useState("");
  const candidates = status?.candidates || [];
  useEffect(() => {
    if (open) setLegacyId(candidates[0]?.legacy_student_id ? String(candidates[0].legacy_student_id) : "");
  }, [open, status]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await link.mutateAsync({ legacy_student_id: Number(legacyId), reason, confirmation: "LINK_LEGACY_STUDENT" });
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Review attendance identity link</DialogTitle><DialogDescription>Link one existing legacy student only after confirming the candidate. Attendance history and device identifiers are never rewritten.</DialogDescription></DialogHeader>{link.error && <Alert variant="danger"><AlertTitle>Legacy link was not changed</AlertTitle><AlertDescription>{link.error.message}</AlertDescription></Alert>}<form id="legacy-link-form" className="mt-5 space-y-4" onSubmit={submit}><div><Label htmlFor="legacy-link-candidate">Legacy candidate</Label><NativeSelect id="legacy-link-candidate" required value={legacyId} onChange={(event) => setLegacyId(event.target.value)}><option value="">Select a reviewed candidate</option>{candidates.map((candidate: any) => <option key={candidate.legacy_student_id} value={candidate.legacy_student_id}>{candidate.name} · {candidate.jenjang || "Unknown Jenjang"} · {candidate.class_name || "Unassigned"} · {candidate.attendance_count} attendance records</option>)}</NativeSelect></div><div><Label htmlFor="legacy-link-reason">Review reason</Label><Input id="legacy-link-reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div></form><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" form="legacy-link-form" disabled={link.isPending || !legacyId || reason.length < 3}>{link.isPending ? "Linking…" : "Confirm reviewed link"}</Button></DialogFooter></DialogContent></Dialog>;
}


function IdentityVerificationDialog({ id, type, current, open, onOpenChange }: { id: string; type: "NIK" | "KK"; current?: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateIdentityVerification(id);
  const [status, setStatus] = useState<string>("UNVERIFIED");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const transitions: Record<string, string[]> = {
    UNVERIFIED: ["UNVERIFIED", "IDENTIFIER_ENTERED", "NEEDS_CORRECTION"],
    IDENTIFIER_ENTERED: ["IDENTIFIER_ENTERED", "UNVERIFIED", "VERIFIED", "NEEDS_CORRECTION"],
    VERIFIED: ["VERIFIED", "IDENTIFIER_ENTERED", "NEEDS_CORRECTION"],
    NEEDS_CORRECTION: ["NEEDS_CORRECTION", "UNVERIFIED", "IDENTIFIER_ENTERED"],
  };
  const allowedStatuses = transitions[current?.verification_status || "UNVERIFIED"] ?? ["UNVERIFIED"];

  useEffect(() => {
    if (open) {
      setStatus(current?.verification_status || "UNVERIFIED");
      setNotes(current?.notes || "");
      setReason(current?.correction_reason || "");
    }
  }, [open, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      identifier_type: type,
      verification_status: status,
      notes: notes || null,
      correction_reason: reason || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {type} Verification</DialogTitle>
          <DialogDescription>
            Record whether the {type} identifier is entered, verified, or needs correction. Document receipt is tracked separately.
          </DialogDescription>
        </DialogHeader>
        {update.error && (
          <Alert variant="danger">
            <AlertTitle>Verification update failed</AlertTitle>
            <AlertDescription>{update.error.message}</AlertDescription>
          </Alert>
        )}
        <form id={"verify-" + type + "-form"} className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor={"verify-" + type + "-status"}>Verification Status</Label>
            <NativeSelect
              id={"verify-" + type + "-status"}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {allowedStatuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </NativeSelect>
          </div>
          {status === "NEEDS_CORRECTION" && (
            <div>
              <Label htmlFor={"verify-" + type + "-reason"}>Correction Reason (Required)</Label>
              <Input
                id={"verify-" + type + "-reason"}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason why correction is needed"
              />
            </div>
          )}
          <div>
            <Label htmlFor={"verify-" + type + "-notes"}>Notes (Optional)</Label>
            <Input
              id={"verify-" + type + "-notes"}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional verification details"
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form={"verify-" + type + "-form"}
            disabled={update.isPending || (status === "NEEDS_CORRECTION" && !reason.trim())}
          >
            {update.isPending ? "Saving..." : "Save Verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DapodikStatusDialog({ id, current, open, onOpenChange }: { id: string; current?: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateDapodikStatus(id);
  const [status, setStatus] = useState<string>("NOT_STARTED");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const transitions: Record<string, string[]> = {
    NOT_STARTED: ["NOT_STARTED", "PENDING_EXTERNAL_PROCESSING"],
    PENDING_EXTERNAL_PROCESSING: ["PENDING_EXTERNAL_PROCESSING", "ENTERED", "NEEDS_CORRECTION"],
    ENTERED: ["ENTERED", "SYNCHRONIZED", "NEEDS_CORRECTION"],
    SYNCHRONIZED: ["SYNCHRONIZED", "NEEDS_CORRECTION"],
    NEEDS_CORRECTION: ["NEEDS_CORRECTION", "PENDING_EXTERNAL_PROCESSING"],
  };
  const allowedStatuses = transitions[current?.status || "NOT_STARTED"] ?? ["NOT_STARTED"];

  useEffect(() => {
    if (open) {
      setStatus(current?.status || "NOT_STARTED");
      setRef(current?.external_reference || "");
      setNotes(current?.notes || "");
      setReason(current?.correction_reason || "");
    }
  }, [open, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      status,
      external_reference: ref || null,
      notes: notes || null,
      correction_reason: reason || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update DAPODIK Registration Status</DialogTitle>
          <DialogDescription>
            Record manual DAPODIK progress. “Synchronized” means an operator confirmed the external action; OperatorOS does not synchronize with DAPODIK.
          </DialogDescription>
        </DialogHeader>
        {update.error && (
          <Alert variant="danger">
            <AlertTitle>DAPODIK update failed</AlertTitle>
            <AlertDescription>{update.error.message}</AlertDescription>
          </Alert>
        )}
        <form id="dapodik-status-form" className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="dapodik-status-select">Registration Status</Label>
            <NativeSelect
              id="dapodik-status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {allowedStatuses.map((value) => <option key={value} value={value}>{value === "SYNCHRONIZED" ? "Synchronized (confirmed externally)" : value.replaceAll("_", " ")}</option>)}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="dapodik-ext-ref">External Reference ID (Optional)</Label>
            <Input
              id="dapodik-ext-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="DAPODIK registrant / reference ID"
            />
          </div>
          {status === "NEEDS_CORRECTION" && (
            <div>
              <Label htmlFor="dapodik-reason">Correction Reason (Required)</Label>
              <Input
                id="dapodik-reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason why DAPODIK entry needs correction"
              />
            </div>
          )}
          <div>
            <Label htmlFor="dapodik-notes">Notes (Optional)</Label>
            <Input
              id="dapodik-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Operator confirmation notes"
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form="dapodik-status-form"
            disabled={update.isPending || (status === "NEEDS_CORRECTION" && !reason.trim())}
          >
            {update.isPending ? "Saving..." : "Save Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IomUploadDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const upload = useUploadIomDocument(id);
  const [iomType, setIomType] = useState<string>("TRANSFER_IN");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIomType("TRANSFER_IN");
      setDescription("");
      setFile(null);
      setFileError(null);
    }
  }, [open]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setFileError("File exceeds the maximum 25MB limit");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setFileError("Only PDF files (.pdf) are supported");
      return;
    }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFileError("Please select a PDF file to upload");
      return;
    }
    const fd = new FormData();
    fd.set("iom_type", iomType);
    fd.set("description", description.trim());
    fd.set("file", file);
    await upload.mutateAsync(fd);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Inter Office Memo (IOM) PDF</DialogTitle>
          <DialogDescription>
            Archive an official CSO Inter Office Memo for transfer in or transfer out.
          </DialogDescription>
        </DialogHeader>
        {(upload.error || fileError) && (
          <Alert variant="danger">
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{fileError || upload.error?.message}</AlertDescription>
          </Alert>
        )}
        <form id="iom-upload-form" className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="iom-type-select">IOM Direction</Label>
            <NativeSelect
              id="iom-type-select"
              value={iomType}
              onChange={(e) => setIomType(e.target.value)}
            >
              <option value="TRANSFER_IN">Transfer In (Incoming Student)</option>
              <option value="TRANSFER_OUT">Transfer Out (Outgoing Student)</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="iom-description">Description (Required)</Label>
            <Input
              id="iom-description"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Memo CSO No. 124/CSO/X/2026"
            />
          </div>
          <div>
            <Label htmlFor="iom-file">PDF Document (Max 25MB)</Label>
            <Input
              id="iom-file"
              type="file"
              accept=".pdf,application/pdf"
              required
              onChange={onFileChange}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form="iom-upload-form"
            disabled={upload.isPending || !file || !description.trim()}
          >
            {upload.isPending ? "Uploading..." : "Upload Memo PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IomEditDialog({ studentId, document, open, onOpenChange }: { studentId: string; document: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateIomDocument(studentId);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open && document) {
      setDescription(document.description || "");
    }
  }, [open, document]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document) return;
    await update.mutateAsync({ docId: document.id, payload: { description: description.trim() } });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit IOM Document Description</DialogTitle>
          <DialogDescription>
            Update memo description. Document file content and hash remain immutable.
          </DialogDescription>
        </DialogHeader>
        {update.error && (
          <Alert variant="danger">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{update.error.message}</AlertDescription>
          </Alert>
        )}
        <form id="iom-edit-form" className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <Label htmlFor="iom-edit-desc">Description</Label>
            <Input
              id="iom-edit-desc"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form="iom-edit-form"
            disabled={update.isPending || !description.trim()}
          >
            {update.isPending ? "Saving..." : "Save Description"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CanonicalStudentProfile() {
  const { id = "" } = useParams(); const student = useStudent(id); const overview = useStudentOverview(id); const legacyLink = useLegacyLinkStatus(id); const history = useStudentHistory(id); const enrollmentHistory = useStudentEnrollments(id);
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false); const [deviceOpen, setDeviceOpen] = useState(false); const [enrollmentOpen, setEnrollmentOpen] = useState(false); const [retireOpen, setRetireOpen] = useState(false); const [endOpen, setEndOpen] = useState(false); const [legacyLinkOpen, setLegacyLinkOpen] = useState(false); const [attendanceExporting, setAttendanceExporting] = useState(false); const [attendanceExportError, setAttendanceExportError] = useState<string | null>(null);
  const [verifyNikOpen, setVerifyNikOpen] = useState(false);
  const [verifyKkOpen, setVerifyKkOpen] = useState(false);
  const [dapodikOpen, setDapodikOpen] = useState(false);
  const [iomUploadOpen, setIomUploadOpen] = useState(false);
  const [iomEditingDoc, setIomEditingDoc] = useState<any>(null);
  if (student.isPending) return <LoadingState title="Loading Student Profile" />;
  if (student.isError || !student.data) return <ErrorState title="Student Profile could not be loaded" description={student.error?.message} />;
  const profile = student.data; const activeEnrollment = profile.enrollments.find((item) => item.active); const activeDevice = profile.device_identities.find((item) => item.is_active); const attendanceIdentity = legacyLink.data || profile.attendance_identity || { status: "NOT_LINKED", candidates: [] };
  const handleDownloadIom = async (docId: string, filename: string) => {
    try {
      const blob = await downloadIomDocumentBlob(id, docId);
      const url = createDownloadUrl(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      revokeDownloadUrl(url);
    } catch {
      alert("Could not download document file.");
    }
  };
  const handleExportAttendance = async () => {
    if (!profile) return;
    setAttendanceExporting(true); setAttendanceExportError(null);
    try {
      const now = new Date();
      const blob = await downloadStudentAttendanceHistoryExcel({ studentMasterId: profile.id, month: now.getMonth() + 1, year: now.getFullYear() });
      const url = createDownloadUrl(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = `absensi_${(profile.identity.full_name || "student").replace(/[^A-Za-z0-9_-]+/g, "-")}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.xlsx`;
      link.click(); revokeDownloadUrl(url);
    } catch (error) {
      setAttendanceExportError((error as { message?: string })?.message || "Attendance history could not be exported.");
    } finally {
      setAttendanceExporting(false);
    }
  };
  return <div className="space-y-6"><Link to="/students" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="size-4" />Back to Student Management</Link><PageHeader eyebrow="Student Profile" title={profile.identity.full_name || "Student"} description="Current enrollment, attendance, academic measurements, trends, and profile information." actions={<>{can("edit_student") && <Button variant="outline" onClick={() => setEditOpen(true)}><Edit className="size-4" />Edit profile</Button>}{can("manage_device_identity") && <Button variant="outline" onClick={() => setDeviceOpen(true)}><Link2 className="size-4" />Manage Device ID</Button>}{can("manage_enrollment") && <Button onClick={() => setEnrollmentOpen(true)}><MoveRight className="size-4" />{activeEnrollment ? "Transfer class" : "Create enrollment"}</Button>}</>} />
    <Tabs defaultValue="overview"><TabsList className="flex max-w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="personal">Personal Data</TabsTrigger><TabsTrigger value="contact">Contact & Guardians</TabsTrigger><TabsTrigger value="enrollment">Academic Enrollment</TabsTrigger><TabsTrigger value="device">Attendance Device</TabsTrigger><TabsTrigger value="quality">Data Quality</TabsTrigger>{can("view_sensitive_student_fields") && <TabsTrigger value="iom">IOM Documents</TabsTrigger>}<TabsTrigger value="history">Change History</TabsTrigger></TabsList>
      <TabsContent value="overview">{overview.isPending ? <LoadingState title="Loading student overview" /> : overview.isError || !overview.data ? <ErrorState title="Student overview could not be loaded" description={overview.error?.message} /> : <><Student360Overview overview={overview.data} exporting={attendanceExporting} exportError={attendanceExportError} onExport={handleExportAttendance} showExport={false} /><Card><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Attendance identity</CardTitle>{can("resolve_student_duplicates") && attendanceIdentity.status !== "LINKED" && <Button size="sm" variant="outline" onClick={() => setLegacyLinkOpen(true)}>Review / link</Button>}</div></CardHeader><CardContent className="space-y-3"><Badge variant={attendanceIdentity.status === "LINKED" ? "success" : attendanceIdentity.status === "REVIEW_REQUIRED" ? "warning" : "secondary"}>{attendanceIdentity.status === "LINKED" ? "Linked" : attendanceIdentity.status === "REVIEW_REQUIRED" ? "Review Required" : "Not Linked"}</Badge><p className="text-sm text-muted-foreground">{attendanceIdentity.status === "LINKED" ? "Historical attendance remains associated with the linked legacy identity." : attendanceIdentity.status === "REVIEW_REQUIRED" ? `${attendanceIdentity.candidates?.length || 0} candidate(s) require administrator review.` : "No legacy attendance identity is linked."}</p>{can("export_student_data") && attendanceIdentity.status === "LINKED" && overview.data.links.attendanceExport && <div><Button size="sm" variant="outline" onClick={handleExportAttendance} disabled={attendanceExporting} aria-busy={attendanceExporting}>{attendanceExporting ? "Preparing workbook…" : "Export attendance history"}</Button>{attendanceExportError && <Alert variant="danger" className="mt-3"><AlertTitle>Export failed</AlertTitle><AlertDescription>{attendanceExportError}</AlertDescription></Alert>}</div>}{attendanceIdentity.status !== "LINKED" && <p className="text-sm text-muted-foreground">Link an attendance identity to enable the history export.</p>}</CardContent></Card></>}</TabsContent>
      <TabsContent value="personal" className="space-y-4">
        <Card><CardHeader><CardTitle>Personal data</CardTitle></CardHeader><CardContent><DefinitionList values={profile.identity} /></CardContent></Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">NIK Verification Status</CardTitle>
                {can("edit_student") && <Button size="sm" variant="outline" onClick={() => setVerifyNikOpen(true)}>Update NIK</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {(() => {
                const nikVerif = (profile.identity_verifications || []).find((v: any) => v.identifier_type === "NIK");
                const status = nikVerif?.verification_status || "UNVERIFIED";
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge variant={status === "VERIFIED" ? "success" : status === "NEEDS_CORRECTION" ? "danger" : "secondary"}>
                        {status.replaceAll("_", " ")}
                      </Badge>
                      {can("view_sensitive_student_fields") && <span className="text-xs text-muted-foreground">Identifier: {profile.identity.nik ? "Entered" : "Not Entered"}</span>}
                    </div>
                    {nikVerif?.verified_by && <p className="text-xs text-muted-foreground">Verified by: {nikVerif.verified_by} · {nikVerif?.verified_at ? new Date(nikVerif.verified_at).toLocaleDateString() : ""}</p>}
                    {nikVerif?.correction_reason && <p className="text-xs font-semibold text-danger">Correction required: {nikVerif.correction_reason}</p>}
                    {nikVerif?.notes && <p className="text-xs text-muted-foreground">Notes: {nikVerif.notes}</p>}
                  </>
                );
              })()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Kartu Keluarga (KK) Verification</CardTitle>
                {can("edit_student") && <Button size="sm" variant="outline" onClick={() => setVerifyKkOpen(true)}>Update KK</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {(() => {
                const kkVerif = (profile.identity_verifications || []).find((v: any) => v.identifier_type === "KK");
                const status = kkVerif?.verification_status || "UNVERIFIED";
                const docReceived = Boolean(profile.document_status?.family_card_received);
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge variant={status === "VERIFIED" ? "success" : status === "NEEDS_CORRECTION" ? "danger" : "secondary"}>
                        {status.replaceAll("_", " ")}
                      </Badge>
                      <Badge variant={docReceived ? "success" : "secondary"}>
                        {docReceived ? "Document Received" : "Document Missing"}
                      </Badge>
                    </div>
                    {kkVerif?.verified_by && <p className="text-xs text-muted-foreground">Verified by: {kkVerif.verified_by} · {kkVerif?.verified_at ? new Date(kkVerif.verified_at).toLocaleDateString() : ""}</p>}
                    {kkVerif?.correction_reason && <p className="text-xs font-semibold text-danger">Correction required: {kkVerif.correction_reason}</p>}
                    {kkVerif?.notes && <p className="text-xs text-muted-foreground">Notes: {kkVerif.notes}</p>}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">DAPODIK Registration Tracking</CardTitle>
              {can("edit_student") && <Button size="sm" variant="outline" onClick={() => setDapodikOpen(true)}>Update DAPODIK</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(() => {
              const reg = profile.dapodik_registration;
              const status = reg?.status || "NOT_STARTED";
              return (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground uppercase">Status</p>
                    <Badge variant={status === "SYNCHRONIZED" ? "success" : status === "NEEDS_CORRECTION" ? "danger" : status === "ENTERED" ? "information" : "secondary"}>
                      {status === "SYNCHRONIZED" ? "Synchronized (confirmed externally)" : status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground uppercase">External Reference</p>
                    <p className="text-sm font-medium">{reg?.external_reference || "—"}</p>
                  </div>
                  {reg?.synchronized_at && (
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase">Synchronized At</p>
                      <p className="text-sm text-muted-foreground">{new Date(reg.synchronized_at).toLocaleString()}</p>
                    </div>
                  )}
                  {reg?.updated_by && (
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase">Last Updated By</p>
                      <p className="text-sm text-muted-foreground">{reg.updated_by}</p>
                    </div>
                  )}
                  {reg?.correction_reason && (
                    <div className="sm:col-span-2 space-y-1">
                      <p className="text-xs font-bold text-danger uppercase">Correction Required</p>
                      <p className="text-sm font-semibold text-danger">{reg.correction_reason}</p>
                    </div>
                  )}
                  {reg?.notes && (
                    <div className="sm:col-span-2 space-y-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase">Notes</p>
                      <p className="text-sm text-muted-foreground">{reg.notes}</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="contact" className="space-y-4"><Card><CardHeader><CardTitle>Contact and address</CardTitle></CardHeader><CardContent><DefinitionList values={profile.contact} /></CardContent></Card><Card><CardHeader><CardTitle>Parents and guardians</CardTitle></CardHeader><CardContent><GuardianManager id={id} guardians={profile.guardians} /></CardContent></Card><SensitiveProfileEditor id={id} profile={profile} /></TabsContent>
      <TabsContent value="enrollment"><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Academic enrollment history</CardTitle>{activeEnrollment && <Button variant="danger" size="sm" onClick={() => setEndOpen(true)}>End current enrollment</Button>}</div></CardHeader><CardContent className="space-y-4">{enrollmentHistory.isPending ? <LoadingState title="Loading enrollment history" /> : (enrollmentHistory.data || []).map((item: any) => <article key={item.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black">{item.class_name || "Unassigned class"}</h3><Badge variant={item.active ? "success" : "secondary"}>{item.active ? "Current" : "Historical"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.effective_from || "Unknown start"} – {item.effective_to || "Current"}</p>{item.class_history?.length > 0 && <ol className="mt-3 space-y-1 text-sm">{item.class_history.map((entry: any) => <li key={entry.id}>{entry.class_name}: {entry.effective_from} – {entry.effective_to || "Current"}</li>)}</ol>}</article>)}</CardContent></Card></TabsContent>
      <TabsContent value="device"><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Attendance Device ID history</CardTitle>{activeDevice && <Button variant="danger" size="sm" onClick={() => setRetireOpen(true)}>Retire active Device ID</Button>}</div></CardHeader><CardContent className="space-y-3">{profile.device_identities.length ? profile.device_identities.map((device) => <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"><div><p className="font-mono font-black">{device.device_identifier}</p><p className="text-xs text-muted-foreground">{device.device_source} · {device.effective_from} – {device.effective_to || "Current"}</p></div><Badge variant={device.is_active ? "success" : "secondary"}>{device.is_active ? "Active" : "Retired"}</Badge></div>) : <p className="text-sm text-muted-foreground">No attendance device identity linked.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="quality"><Card><CardHeader><CardTitle>Data quality</CardTitle></CardHeader><CardContent>{overview.data?.dataCompleteness.issues.length ? <ul className="list-disc space-y-2 pl-5">{overview.data.dataCompleteness.issues.map((issue) => <li key={`${issue.field}-${issue.type}`}>{issue.label}</li>)}</ul> : <Alert variant="success"><AlertTitle>Profile checks passed</AlertTitle><AlertDescription>No supported profile information is missing.</AlertDescription></Alert>}</CardContent></Card></TabsContent>
      {can("view_sensitive_student_fields") && <TabsContent value="iom" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Inter Office Memo (IOM) Archive</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Archive of CSO Inter Office Memos for transfer-in and transfer-out students.</p>
              </div>
              {can("edit_student") && (
                <Button onClick={() => setIomUploadOpen(true)}>
                  <Plus className="size-4" />Upload IOM Memo
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!(profile.iom_documents || []).length ? (
              <p className="text-sm text-muted-foreground">No Inter Office Memos archived for this student.</p>
            ) : (
              (profile.iom_documents || []).map((doc: any) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={doc.iom_type === "TRANSFER_IN" ? "information" : "warning"}>
                        {doc.iom_type === "TRANSFER_IN" ? "Transfer In" : "Transfer Out"}
                      </Badge>
                      <span className="font-bold text-sm">{doc.original_filename}</span>
                      <span className="text-xs text-muted-foreground">({Math.round(doc.file_size_bytes / 1024)} KB)</span>
                    </div>
                    <p className="text-sm text-foreground">{doc.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded by {doc.uploaded_by} on {new Date(doc.uploaded_at).toLocaleString()}
                      {doc.updated_by && doc.updated_by !== doc.uploaded_by && ` · Edited by ${doc.updated_by}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {can("edit_student") && (
                      <Button size="sm" variant="outline" onClick={() => setIomEditingDoc(doc)}>
                        Edit Description
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleDownloadIom(doc.id, doc.original_filename)}>
                      <Download className="size-4" />Download PDF
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>}
      <TabsContent value="history"><Card><CardHeader><CardTitle>Change history</CardTitle></CardHeader><CardContent>{history.isPending ? <LoadingState title="Loading change history" /> : <ol className="space-y-3">{(history.data || []).map((entry: any) => <li key={entry.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black">{String(entry.action).replaceAll("_", " ")}</p><time className="text-xs text-muted-foreground">{new Date(entry.changed_at).toLocaleString()}</time></div><p className="mt-1 text-sm">{entry.field_name ? `${entry.field_name}: ${entry.old_value || "empty"} → ${entry.new_value || "empty"}` : "Student record event"}</p><p className="mt-1 text-xs text-muted-foreground">By {entry.changed_by} · {entry.source}</p></li>)}</ol>}</CardContent></Card></TabsContent>
    </Tabs><ProfileEditDialog id={id} profile={profile} open={editOpen} onOpenChange={setEditOpen} /><DeviceDialog id={id} open={deviceOpen} onOpenChange={setDeviceOpen} /><EnrollmentDialog studentId={id} current={activeEnrollment} open={enrollmentOpen} onOpenChange={setEnrollmentOpen} /><RetireDeviceDialog studentId={id} device={activeDevice} open={retireOpen} onOpenChange={setRetireOpen} /><EndEnrollmentDialog studentId={id} enrollment={activeEnrollment} open={endOpen} onOpenChange={setEndOpen} /><LegacyLinkDialog id={id} status={attendanceIdentity} open={legacyLinkOpen} onOpenChange={setLegacyLinkOpen} />
    <IdentityVerificationDialog id={id} type="NIK" current={(profile.identity_verifications || []).find((v: any) => v.identifier_type === "NIK")} open={verifyNikOpen} onOpenChange={setVerifyNikOpen} />
    <IdentityVerificationDialog id={id} type="KK" current={(profile.identity_verifications || []).find((v: any) => v.identifier_type === "KK")} open={verifyKkOpen} onOpenChange={setVerifyKkOpen} />
    <DapodikStatusDialog id={id} current={profile.dapodik_registration} open={dapodikOpen} onOpenChange={setDapodikOpen} />
    <IomUploadDialog id={id} open={iomUploadOpen} onOpenChange={setIomUploadOpen} />
    <IomEditDialog studentId={id} document={iomEditingDoc} open={Boolean(iomEditingDoc)} onOpenChange={(open) => { if (!open) setIomEditingDoc(null); }} /></div>;
}
