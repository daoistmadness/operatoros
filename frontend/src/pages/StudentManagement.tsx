import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Download, Plus, Search, Upload } from "lucide-react";
import type { ManagedStudent, StudentFilters } from "../api/students";
import { useCreateStudent, useStudentQuality, useStudents, useStudentTemplateExport } from "../hooks/useStudentQueries";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAuth } from "../context/AuthContext";

const column = createColumnHelper<ManagedStudent>();
const today = () => new Date().toISOString().slice(0, 10);

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(href);
}

function AddStudentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateStudent();
  const [confirming, setConfirming] = useState(false);
  const [values, setValues] = useState({
    full_name: "", preferred_name: "", nipd: "", nisn: "", nik: "", birth_place: "",
    birth_date: "", gender: "", religion: "", address: "", phone: "", email: "",
    guardian_name: "", guardian_phone: "", device_identifier: "", device_source: "attendance_machine",
    device_effective_from: today(), academic_year_id: "", academic_class_id: "", enrollment_effective_from: today(), duplicate_override_reason: "",
  });
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const submit = async () => {
    const payload = {
      identity: {
        full_name: values.full_name, preferred_name: values.preferred_name || null, nipd: values.nipd || null,
        nisn: values.nisn || null, nik: values.nik || null, birth_place: values.birth_place || null,
        birth_date: values.birth_date || null, gender: values.gender || null, religion: values.religion || null,
        student_status: "active",
      },
      contact: values.address || values.phone || values.email ? { address: values.address || null, student_phone: values.phone || null, student_email: values.email || null } : null,
      guardians: values.guardian_name ? [{ guardian_type: "guardian", name: values.guardian_name, phone: values.guardian_phone || null }] : [],
      device_identity: values.device_identifier ? { device_identifier: values.device_identifier, device_source: values.device_source, effective_from: values.device_effective_from, reason: "Assigned during manual student creation" } : null,
      enrollment: values.academic_year_id && values.academic_class_id ? { academic_year_id: Number(values.academic_year_id), academic_class_id: Number(values.academic_class_id), effective_from: values.enrollment_effective_from } : null,
      duplicate_override_reason: values.duplicate_override_reason || null,
    };
    await create.mutateAsync(payload);
    onOpenChange(false); setConfirming(false);
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!create.isPending) { onOpenChange(next); setConfirming(false); } }}>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>Add Student</DialogTitle><DialogDescription>Create the canonical profile first, with optional attendance device and academic enrollment.</DialogDescription></DialogHeader>
      {create.error && <Alert variant="danger"><AlertTitle>Student was not created</AlertTitle><AlertDescription>{create.error.message}</AlertDescription></Alert>}
      {!confirming ? <form id="student-create-form" className="mt-5 space-y-6" onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-base font-black sm:col-span-2">Student identity</legend>
          <div className="sm:col-span-2"><Label htmlFor="student-full-name">Legal name</Label><Input id="student-full-name" value={values.full_name} onChange={set("full_name")} required autoFocus /></div>
          <div><Label htmlFor="student-preferred-name">Preferred name</Label><Input id="student-preferred-name" value={values.preferred_name} onChange={set("preferred_name")} /></div>
          <div><Label htmlFor="student-nipd">NIPD</Label><Input id="student-nipd" value={values.nipd} onChange={set("nipd")} /></div>
          <div><Label htmlFor="student-nisn">NISN</Label><Input id="student-nisn" inputMode="numeric" value={values.nisn} onChange={set("nisn")} /></div>
          <div><Label htmlFor="student-nik">NIK</Label><Input id="student-nik" inputMode="numeric" value={values.nik} onChange={set("nik")} /></div>
          <div><Label htmlFor="student-birth-place">Birth place</Label><Input id="student-birth-place" value={values.birth_place} onChange={set("birth_place")} /></div>
          <div><Label htmlFor="student-birth-date">Birth date</Label><Input id="student-birth-date" type="date" max={today()} value={values.birth_date} onChange={set("birth_date")} /></div>
          <div><Label htmlFor="student-gender">Gender</Label><NativeSelect id="student-gender" value={values.gender} onChange={set("gender")}><option value="">Not provided</option><option value="male">Male</option><option value="female">Female</option></NativeSelect></div>
          <div><Label htmlFor="student-religion">Religion</Label><Input id="student-religion" value={values.religion} onChange={set("religion")} /></div>
          <div className="sm:col-span-2"><Label htmlFor="student-duplicate-reason">Duplicate review reason (only when confirming a separate same-name student)</Label><Input id="student-duplicate-reason" minLength={3} value={values.duplicate_override_reason} onChange={set("duplicate_override_reason")} /></div>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-base font-black sm:col-span-2">Contact and guardian</legend>
          <div className="sm:col-span-2"><Label htmlFor="student-address">Address</Label><Input id="student-address" value={values.address} onChange={set("address")} /></div>
          <div><Label htmlFor="student-phone">Phone</Label><Input id="student-phone" type="tel" value={values.phone} onChange={set("phone")} /></div>
          <div><Label htmlFor="student-email">Email</Label><Input id="student-email" type="email" value={values.email} onChange={set("email")} /></div>
          <div><Label htmlFor="guardian-name">Guardian name</Label><Input id="guardian-name" value={values.guardian_name} onChange={set("guardian_name")} /></div>
          <div><Label htmlFor="guardian-phone">Guardian phone</Label><Input id="guardian-phone" type="tel" value={values.guardian_phone} onChange={set("guardian_phone")} /></div>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-base font-black sm:col-span-2">Attendance device (optional)</legend>
          <div><Label htmlFor="device-id">Attendance Device ID</Label><Input id="device-id" inputMode="numeric" value={values.device_identifier} onChange={set("device_identifier")} /></div>
          <div><Label htmlFor="device-effective">Effective from</Label><Input id="device-effective" type="date" value={values.device_effective_from} onChange={set("device_effective_from")} /></div>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3"><legend className="mb-3 text-base font-black sm:col-span-3">Academic enrollment (optional)</legend>
          <div><Label htmlFor="academic-year-id">Academic year ID</Label><Input id="academic-year-id" type="number" min="1" value={values.academic_year_id} onChange={set("academic_year_id")} /></div>
          <div><Label htmlFor="academic-class-id">Academic class ID</Label><Input id="academic-class-id" type="number" min="1" value={values.academic_class_id} onChange={set("academic_class_id")} /></div>
          <div><Label htmlFor="enrollment-effective">Effective from</Label><Input id="enrollment-effective" type="date" value={values.enrollment_effective_from} onChange={set("enrollment_effective_from")} /></div>
        </fieldset>
      </form> : <div className="mt-5 space-y-4" role="status">
        <Alert variant="information"><AlertTitle>Confirm student creation</AlertTitle><AlertDescription>Review the identity layers before saving. This operation is transactional.</AlertDescription></Alert>
        <dl className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
          <div><dt className="text-xs font-bold text-muted-foreground">Legal name</dt><dd className="font-bold">{values.full_name}</dd></div>
          <div><dt className="text-xs font-bold text-muted-foreground">NISN</dt><dd>{values.nisn || "Not provided"}</dd></div>
          <div><dt className="text-xs font-bold text-muted-foreground">Attendance Device ID</dt><dd>{values.device_identifier || "Not assigned"}</dd></div>
          <div><dt className="text-xs font-bold text-muted-foreground">Academic class ID</dt><dd>{values.academic_class_id || "Not enrolled"}</dd></div>
        </dl>
      </div>}
      <DialogFooter>
        {confirming && <Button variant="outline" onClick={() => setConfirming(false)} disabled={create.isPending}>Back</Button>}
        <Button type={confirming ? "button" : "submit"} form={confirming ? undefined : "student-create-form"} onClick={confirming ? submit : undefined} disabled={create.isPending || !values.full_name.trim()}>{create.isPending ? "Creating student…" : confirming ? "Confirm and create" : "Review student"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function StudentManagement() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [device, setDevice] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const filters: StudentFilters = { search: search || undefined, status: status || undefined, device_linked: device === "linked" ? true : device === "unlinked" ? false : undefined, page, page_size: 25 };
  const students = useStudents(filters);
  const quality = useStudentQuality();
  const exporter = useStudentTemplateExport();
  const columns = useMemo(() => [
    column.accessor("full_name", { header: "Student", cell: ({ row }) => <div><Link className="font-black text-brand hover:underline" to={`/students/${row.original.id}`}>{row.original.full_name}</Link>{row.original.preferred_name && <p className="text-xs text-muted-foreground">{row.original.preferred_name}</p>}</div> }),
    column.accessor("nipd_masked", { header: "NIPD", cell: (info) => info.getValue() || "—" }),
    column.accessor("nisn_masked", { header: "NISN", cell: (info) => info.getValue() || "—" }),
    column.accessor("current_jenjang", { header: "Jenjang", cell: (info) => info.getValue() || "—" }),
    column.accessor("current_class", { header: "Class", cell: ({ row }) => <div>{row.original.current_class || "—"}<p className="text-xs text-muted-foreground">{row.original.academic_year || "No enrollment"}</p></div> }),
    column.accessor("device_identifier_masked", { header: "Device ID", cell: (info) => info.getValue() || <Badge variant="warning">Unlinked</Badge> }),
    column.accessor("profile_completeness", { header: "Profile", cell: (info) => `${info.getValue()}%` }),
    column.accessor("student_status", { header: "Status", cell: (info) => <Badge variant={info.getValue() === "active" ? "success" : "secondary"}>{info.getValue().replaceAll("_", " ")}</Badge> }),
    column.accessor("quality_flags", { header: "Data quality", cell: (info) => info.getValue().length ? <Badge variant="warning">{info.getValue().length} item(s)</Badge> : <Badge variant="success">Complete</Badge> }),
    column.display({ id: "actions", header: "Actions", cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => { window.location.href = `/students/${row.original.id}`; }}>Open profile</Button> }),
  ], []);
  const table = useReactTable({ data: students.data?.items || [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, pageCount: students.data?.total_pages || 0 });
  const exportTemplate = async () => { const blob = await exporter.mutateAsync(); saveBlob(blob, "operatoros-student-update.xlsx"); };

  return <div className="space-y-6">
    <PageHeader eyebrow="Student information" title="Student Management" description="Manage canonical student profiles, attendance device identities, academic enrollment, and guarded imports." actions={can("create_student") ? <><Button variant="outline" onClick={exportTemplate} disabled={exporter.isPending}><Download className="size-4" />{exporter.isPending ? "Exporting…" : "Export update template"}</Button>{can("import_student_roster") && <Button variant="outline" onClick={() => { window.location.href = "/upload"; }}><Upload className="size-4" />Import students</Button>}<Button onClick={() => setAddOpen(true)}><Plus className="size-4" />Add student</Button></> : undefined} />
    <Tabs defaultValue="all">
      <TabsList className="max-w-full overflow-x-auto"><TabsTrigger value="all">All Students</TabsTrigger><TabsTrigger value="quality">Data Quality</TabsTrigger><TabsTrigger value="history">Import / Update History</TabsTrigger></TabsList>
      <TabsContent value="all" className="space-y-4">
        <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Label className="sr-only" htmlFor="student-search">Search students</Label><Input id="student-search" className="pl-9" placeholder="Search name, NIPD, NISN, or Device ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
          <div><Label className="sr-only" htmlFor="student-status-filter">Student status</Label><NativeSelect id="student-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="pending_review">Pending review</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option></NativeSelect></div>
          <div><Label className="sr-only" htmlFor="student-device-filter">Device link status</Label><NativeSelect id="student-device-filter" value={device} onChange={(event) => { setDevice(event.target.value); setPage(1); }}><option value="">All device links</option><option value="linked">Device linked</option><option value="unlinked">Device unlinked</option></NativeSelect></div>
        </CardContent></Card>
        {students.isPending ? <LoadingState title="Loading students" /> : students.isError ? <ErrorState title="Students could not be loaded" description={students.error.message} /> : !students.data?.items.length ? <EmptyState title="No students found" description={can("create_student") ? "Adjust the filters or add a canonical student." : "Adjust the filters, or ask an administrator to add or import students."} /> : <>
          <DataTableContainer><DataTable><DataTableHeader>{table.getHeaderGroups().map((group) => <DataTableRow key={group.id}>{group.headers.map((header) => <DataTableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</DataTableHead>)}</DataTableRow>)}</DataTableHeader><DataTableBody>{table.getRowModel().rows.map((row) => <DataTableRow key={row.id}>{row.getVisibleCells().map((cell) => <DataTableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</DataTableCell>)}</DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>
          <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {students.data.page} of {Math.max(1, students.data.total_pages)} · {students.data.total} students</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || students.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" disabled={page >= students.data.total_pages || students.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
        </>}
      </TabsContent>
      <TabsContent value="quality">{quality.isPending ? <LoadingState title="Calculating data quality" /> : quality.isError ? <ErrorState title="Data quality could not be loaded" /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(quality.data || {}).map(([key, value]) => <Card key={key}><CardHeader><CardTitle className="text-sm capitalize">{key.replaceAll("_", " ")}</CardTitle></CardHeader><CardContent><p className="text-3xl font-black tabular-nums">{value}</p></CardContent></Card>)}</div>}</TabsContent>
      <TabsContent value="history"><Card><CardHeader><CardTitle>Student import and update history</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Roster previews and student update workbooks are available in the Data Import Center. Every commit is retained with its checksum and operator.</p>{can("import_student_roster") ? <Button onClick={() => { window.location.href = "/upload"; }}>Open Data Import Center</Button> : <p className="text-sm font-semibold text-slate-600">An administrator manages student imports and update workbooks.</p>}</CardContent></Card></TabsContent>
    </Tabs>
    {can("create_student") && <AddStudentDialog open={addOpen} onOpenChange={setAddOpen} />}
  </div>;
}
