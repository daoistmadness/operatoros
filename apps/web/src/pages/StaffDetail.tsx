import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { createStaffEducation, deleteStaffEducation, fetchJenjangOptions, fetchStaffDetail, replaceStaffJenjangs, updateStaffEducation, updateStaffEmployment, type EducationRecord } from "../api/staff";
import { PageHeader } from "../components/common/page-header";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";

const EDUCATION_LEVELS = ["SD", "SMP", "SMA", "SMK", "D1", "D2", "D3", "D4", "S1", "S2", "S3"];

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
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["staff", "detail", id], queryFn: () => fetchStaffDetail(id), enabled: Boolean(id) });
  const jenjangs = useQuery({ queryKey: ["academic-masters", "jenjangs"], queryFn: fetchJenjangOptions });
  const [selectedJenjangs, setSelectedJenjangs] = useState<number[]>([]);
  const [endDate, setEndDate] = useState("");
  const [education, setEducation] = useState<Partial<EducationRecord>>({ education_level: "S1" });
  const [editingId, setEditingId] = useState<number | null>(null);
  useEffect(() => {
    if (!detail.data) return;
    setSelectedJenjangs(detail.data.jenjangs.map((item) => item.id));
    setEndDate(detail.data.employment_end_date || "");
  }, [detail.data]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff", "detail", id] });
  const jenjangMutation = useMutation({ mutationFn: () => replaceStaffJenjangs(id, selectedJenjangs), onSuccess: refresh });
  const employmentMutation = useMutation({ mutationFn: () => updateStaffEmployment(id, endDate || null), onSuccess: refresh });
  const educationMutation = useMutation({
    mutationFn: () => editingId ? updateStaffEducation(id, editingId, educationPayload(education)) : createStaffEducation(id, educationPayload(education)),
    onSuccess: () => { setEducation({ education_level: "S1" }); setEditingId(null); refresh(); },
  });
  const deleteMutation = useMutation({ mutationFn: (educationId: number) => deleteStaffEducation(id, educationId), onSuccess: refresh });
  if (detail.isPending) return <LoadingState title="Loading employee profile" />;
  if (detail.isError || !detail.data) return <ErrorState title="Employee profile could not be loaded" description={detail.error?.message} />;
  const member = detail.data;
  const activeJenjangs = jenjangs.data || [];
  const error = jenjangMutation.error || employmentMutation.error || educationMutation.error || deleteMutation.error;
  return <div className="space-y-6">
    <Link to="/staff" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="size-4" />Back to Employee Directory</Link>
    <PageHeader eyebrow="Basic administrative profile" title={member.full_name} description="Dapodik-oriented staff data. Account access, attendance, payroll, and HR workflows remain separate." actions={<Badge variant={member.employment_status === "ACTIVE" ? "success" : "secondary"}>{member.employment_status}</Badge>} />
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{(error as Error).message}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Basic Identity</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Staff ID" value={member.source_staff_id} /><FieldValue label="Name" value={member.full_name} /><FieldValue label="Birth place" value={member.birth_place} /><FieldValue label="Birth date" value={member.birth_date} /><FieldValue label="Age" value={member.age_years === null ? null : `${member.age_years} years`} /><FieldValue label="NIK" value={member.identifiers.find((item) => item.type === "NIK")?.value} /></dl></CardContent></Card>
      <Card><CardHeader><CardTitle>Employment</CardTitle></CardHeader><CardContent className="space-y-4"><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Status" value={member.employment_status} /><FieldValue label="Job title" value={member.job_title} /><FieldValue label="Start date" value={member.employment_start_date} /><FieldValue label="Years of service" value={member.service_duration_status === "CALCULATED" ? `${member.service_years} years ${member.service_months || 0} months` : "Unavailable"} /></dl><div><Label htmlFor="employment-end-date">Employment end date (former staff)</Label><div className="mt-1 flex gap-2"><Input id="employment-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /><Button size="sm" onClick={() => employmentMutation.mutate()} disabled={employmentMutation.isPending}>{employmentMutation.isPending ? "Saving…" : "Save"}</Button></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Dapodik</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="NIP" value={member.nip} /><FieldValue label="NUPTK" value={member.nuptk} /><FieldValue label="Dapodik status" value={member.dapodik_status.replaceAll("_", " ")} /></dl></CardContent></Card>
      <Card><CardHeader><CardTitle>Contact</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2"><FieldValue label="Email" value={member.contact?.email} /><FieldValue label="Phone" value={member.contact?.phone} /><FieldValue label="Address" value={member.contact?.address} /></dl></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Jenjang Assignment</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Use canonical academic-master jenjangs. Zero, one, or multiple assignments are valid.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{activeJenjangs.map((item) => { const checked = selectedJenjangs.includes(item.id); const assignedInactive = checked && !item.active; return <label key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm"><input type="checkbox" checked={checked} disabled={!item.active && !assignedInactive} onChange={() => setSelectedJenjangs((current) => checked ? current.filter((idValue) => idValue !== item.id) : [...current, item.id])} />{item.name}{assignedInactive && <Badge variant="warning">inactive</Badge>}</label>; })}</div><Button onClick={() => jenjangMutation.mutate()} disabled={jenjangMutation.isPending}>{jenjangMutation.isPending ? "Saving assignments…" : "Save jenjang assignments"}</Button></CardContent></Card>
    <Card><CardHeader><CardTitle>Education History</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"><div><Label htmlFor="education-level">Education level</Label><NativeSelect id="education-level" value={education.education_level || "S1"} onChange={(event) => setEducation((current) => ({ ...current, education_level: event.target.value }))}>{EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</NativeSelect></div><div><Label htmlFor="education-institution">Institution</Label><Input id="education-institution" required value={education.institution_name || ""} onChange={(event) => setEducation((current) => ({ ...current, institution_name: event.target.value }))} /></div><div><Label htmlFor="education-major">Major</Label><Input id="education-major" value={education.major || ""} onChange={(event) => setEducation((current) => ({ ...current, major: event.target.value }))} /></div><div><Label htmlFor="education-year">Graduation year</Label><Input id="education-year" type="number" min="1900" max="2200" value={education.graduation_year || ""} onChange={(event) => setEducation((current) => ({ ...current, graduation_year: event.target.value ? Number(event.target.value) : null }))} /></div><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={() => educationMutation.mutate()} disabled={educationMutation.isPending || !education.institution_name}>{editingId ? <><Pencil className="size-4" />Update education</> : <><Plus className="size-4" />Add education</>}</Button>{editingId && <Button variant="outline" onClick={() => { setEditingId(null); setEducation({ education_level: "S1" }); }}>Cancel</Button>}</div></div><div className="rounded-xl border border-border p-4"><p className="text-sm font-black">Highest education: {member.highest_education_level || "—"}{member.highest_education_institution ? ` · ${member.highest_education_institution}` : ""}</p><div className="mt-3 space-y-2">{member.education_history.length ? member.education_history.map((record) => <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-3"><div><p className="font-black">{record.education_level} · {record.institution_name}</p><p className="text-sm text-muted-foreground">{record.major || "No major recorded"}{record.graduation_year ? ` · ${record.graduation_year}` : ""}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" aria-label={`Edit ${record.education_level}`} onClick={() => { setEditingId(record.id); setEducation(record); }}><Pencil className="size-4" /></Button><Button variant="danger" size="sm" aria-label={`Delete ${record.education_level}`} onClick={() => deleteMutation.mutate(record.id)} disabled={deleteMutation.isPending}><Trash2 className="size-4" /></Button></div></div>) : <p className="text-sm text-muted-foreground">No education records yet. Add them manually; the current workbook does not populate this section.</p>}</div></div></CardContent></Card>
  </div>;
}
