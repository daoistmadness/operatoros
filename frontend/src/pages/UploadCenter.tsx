import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Download, FileSpreadsheet, History, Loader2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import AttendanceUpload, { WorkflowIndicator } from "./Upload";
import { useRosterCommit, useRosterPreview, useStudentTemplateExport, useStudentUpdateCommit, useStudentUpdatePreview } from "../hooks/useStudentQueries";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { Checkbox } from "../components/ui/checkbox";
import { buildApiUrl } from "../lib/api/client";
import { eligibleIds, rosterRowView, safeSelectedIds, selectionState } from "../lib/uploadWorkflow";
import { NeedsAttentionPanel } from "../components/upload/NeedsAttentionPanel";
import { UploadHistoryPanel } from "../components/upload/UploadHistoryPanel";

const today = new Date().toISOString().slice(0, 10);
const ROSTER_COLUMNS = ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"];

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href);
}

function RosterImportPanel() {
  const preview = useRosterPreview();
  const commit = useRosterCommit();
  const [file, setFile] = useState<File | null>(null);
  const [owner, setOwner] = useState("");
  const [received, setReceived] = useState(today);
  const [selected, setSelected] = useState<number[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const headerCheckbox = useRef<HTMLInputElement>(null);

  const rows = preview.data?.rows || [];
  const viewRows = useMemo(() => rows.map((row: any) => ({ source: row, view: rosterRowView(row) })), [rows]);
  const eligible = useMemo(() => eligibleIds(rows, rosterRowView), [rows]);
  const safeSelected = useMemo(() => safeSelectedIds(rows, selected, rosterRowView), [rows, selected]);
  const unresolved = viewRows.filter(({ view }: any) => !view.selectable);
  const headerState = selectionState(eligible, safeSelected);
  const selectedCreates = safeSelected.filter((id) => viewRows.find(({ view }: any) => view.key === id)?.source.classification === "CREATE_NEW_MASTER").length;
  const selectedEnrollments = safeSelected.filter((id) => viewRows.find(({ view }: any) => view.key === id)?.source.classification === "CREATE_ENROLLMENT").length;

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = headerState.indeterminate;
  }, [headerState.indeterminate]);

  const runPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const result = await preview.mutateAsync({ file, owner, received });
    setSelected([]);
    setShowSummary(false);
    commit.reset();
    return result;
  };

  const runCommit = () => commit.mutate({
    preview_id: preview.data.preview_id,
    selected_row_ids: safeSelected,
    confirmation: "COMMIT_ACADEMIC_ROSTER",
    preview_checksum: preview.data.preview_checksum,
  });

  const reset = () => {
    setFile(null); setSelected([]); setShowSummary(false); preview.reset(); commit.reset();
  };

  const stage = commit.isSuccess ? "Commit" : preview.data ? (showSummary ? "Commit" : unresolved.length ? "Resolve issues" : "Preview") : file ? "Preview" : "Choose file";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header><h2 className="text-3xl font-black text-foreground">Student Roster Upload</h2><p className="mt-2 max-w-3xl text-muted-foreground">Create or update student records and enrollment information before importing attendance for newly registered students.</p></header>
      <WorkflowIndicator stage={stage} />
      <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 p-4 font-bold text-blue-900">Preview does not update the database.</div>

      <Card>
        <CardHeader><CardTitle>Choose roster workbook</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl bg-surface-muted p-5">
            <h3 className="font-black">Roster requirements</h3>
            <p className="mt-2 text-sm text-muted-foreground">Use the `.xlsx` template. Names alone are never matching keys; use a stable identifier such as student master ID, NIPD, NISN, NIK, birth date with name, or an approved device identity.</p>
            <div className="mt-3 flex flex-wrap gap-2">{ROSTER_COLUMNS.map((column) => <Badge key={column} variant="secondary">{column}</Badge>)}</div>
            <a className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted" href={buildApiUrl("/api/student-enrollments/roster-template")} download><Download className="size-4" />Download roster template</a>
          </div>
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={runPreview}>
            <div className="sm:col-span-3"><Label htmlFor="roster-file">Roster workbook (.xlsx)</Label><Input id="roster-file" type="file" accept=".xlsx" required onChange={(event) => { setFile(event.target.files?.[0] || null); setSelected([]); setShowSummary(false); preview.reset(); commit.reset(); }} /></div>
            <div><Label htmlFor="roster-owner">Source owner</Label><Input id="roster-owner" required minLength={2} value={owner} onChange={(event) => setOwner(event.target.value)} /></div>
            <div><Label htmlFor="roster-received">Date received</Label><Input id="roster-received" type="date" required value={received} onChange={(event) => setReceived(event.target.value)} /></div>
            <div className="flex items-end"><Button type="submit" disabled={preview.isPending || !file}>{preview.isPending ? "Validating roster…" : "Preview roster"}</Button></div>
          </form>
          {preview.error && <Alert variant="danger"><AlertTitle>Roster preview failed</AlertTitle><AlertDescription>{preview.error.message}</AlertDescription></Alert>}
        </CardContent>
      </Card>

      {preview.data && !commit.isSuccess && (
        <Card>
          <CardHeader><CardTitle>Roster preview</CardTitle><p className="text-sm text-muted-foreground">{file?.name} · Preview ID {preview.data.preview_id}</p></CardHeader>
          <CardContent className="space-y-4">
            <div role="status" aria-live="polite" className="flex flex-wrap gap-2"><Badge>{rows.length} total</Badge><Badge variant="success">{eligible.length} eligible</Badge><Badge variant="information">{safeSelected.length} selected</Badge><Badge variant="success">{preview.data.summary.create_new_master || 0} students to create</Badge><Badge variant="information">{preview.data.summary.create_enrollment || 0} enrollments</Badge><Badge variant="warning">{unresolved.length} unresolved</Badge><span className="sr-only">{safeSelected.length} roster rows selected; {unresolved.length} rows require attention.</span></div>
            {unresolved.length > 0 && <Alert variant="warning"><AlertTriangle className="size-4" /><AlertTitle>Some rows need attention</AlertTitle><AlertDescription>Blocked and ambiguous rows cannot be selected. Correct their stable identifiers or master-data references and preview again.</AlertDescription></Alert>}

            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-surface)]">
              <label className="flex min-h-10 items-center gap-2 px-2 font-bold"><input ref={headerCheckbox} type="checkbox" aria-label="Select all eligible roster rows" checked={headerState.checked} disabled={!eligible.length || commit.isPending} onChange={(event) => { setSelected(event.target.checked ? eligible : []); setShowSummary(false); }} />All eligible</label>
              <Button size="sm" variant="outline" onClick={() => { setSelected(eligible); setShowSummary(false); }} disabled={!eligible.length || commit.isPending}>Select eligible</Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setShowSummary(false); }} disabled={!safeSelected.length || commit.isPending}>Clear selection</Button>
              <span className="ml-auto text-sm font-bold">{safeSelected.length} of {rows.length} selected · {unresolved.length} unresolved</span>
              <Button size="sm" onClick={() => setShowSummary(true)} disabled={!safeSelected.length || commit.isPending}>Continue to summary</Button>
            </div>

            <DataTableContainer>
              <DataTable className="min-w-[860px]">
                <DataTableHeader className="sticky top-0"><DataTableRow><DataTableHead>Use</DataTableHead><DataTableHead>Row</DataTableHead><DataTableHead>Student</DataTableHead><DataTableHead>Action</DataTableHead><DataTableHead>Guidance</DataTableHead></DataTableRow></DataTableHeader>
                <DataTableBody>{viewRows.map(({ source: row, view }: any) => <DataTableRow key={view.key} className={!view.selectable ? "bg-amber-50/50" : ""}><DataTableCell><Checkbox aria-label={`Select roster row ${row.source_row}`} disabled={!view.selectable || commit.isPending} checked={safeSelected.includes(view.key)} onCheckedChange={(checked) => { const next = checked ? [...safeSelected, view.key] : safeSelected.filter((id) => id !== view.key); setSelected(safeSelectedIds(rows, next, rosterRowView)); setShowSummary(false); }} /></DataTableCell><DataTableCell>{row.source_row}</DataTableCell><DataTableCell><p className="font-bold">{row.payload.student_name}</p><p className="break-all text-xs text-muted-foreground">{row.payload.student_identifier}</p></DataTableCell><DataTableCell><Badge variant={view.selectable ? "success" : view.action === "INVALID" ? "danger" : "warning"}>{view.label}</Badge>{!view.selectable && <p className="mt-2 text-xs font-bold text-amber-900">{view.disabledReason}</p>}</DataTableCell><DataTableCell className="max-w-xl"><p className="font-semibold">{view.explanation}</p><p className="mt-1 text-muted-foreground">{view.recommendedAction}</p>{row.errors?.length ? <details className="mt-2"><summary className="cursor-pointer font-bold text-primary">Technical details</summary><p className="mt-2 rounded-lg bg-surface-muted p-3 text-xs">Source row: {row.source_row}<br />{row.errors.join("; ")}</p></details> : null}</DataTableCell></DataTableRow>)}</DataTableBody>
              </DataTable>
            </DataTableContainer>

            {showSummary && <section aria-labelledby="roster-commit-summary" className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5"><h3 id="roster-commit-summary" className="text-lg font-black">Commit summary</h3><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">File</dt><dd className="break-all font-bold">{file?.name}</dd></div><div><dt className="text-muted-foreground">Upload type</dt><dd className="font-bold">Student roster</dd></div><div><dt className="text-muted-foreground">Selected</dt><dd className="font-bold">{safeSelected.length}</dd></div><div><dt className="text-muted-foreground">Students / enrollments</dt><dd className="font-bold">{selectedCreates} / {selectedEnrollments}</dd></div><div><dt className="text-muted-foreground">Skipped</dt><dd className="font-bold">{rows.length - safeSelected.length}</dd></div><div><dt className="text-muted-foreground">Unresolved</dt><dd className="font-bold">{unresolved.length}</dd></div><div><dt className="text-muted-foreground">Invalid</dt><dd className="font-bold">{preview.data.summary.invalid || 0}</dd></div><div><dt className="text-muted-foreground">Preview ID</dt><dd className="break-all font-bold">{preview.data.preview_id}</dd></div></dl><div className="mt-4 space-y-1 text-sm text-slate-700"><p>Only selected eligible rows will be submitted. Backend validation and checksum checks run again before commit.</p><p>Names alone are not matching keys. Existing student records are preserved unless the preview explicitly describes a supported operation.</p><p>The selected roster import commits atomically or rolls back; unresolved rows remain excluded and stale previews may be rejected.</p></div><div className="mt-5 flex flex-wrap justify-end gap-3"><Button variant="outline" onClick={() => setShowSummary(false)}>Back to preview</Button><Button onClick={runCommit} disabled={!safeSelected.length || commit.isPending}>{commit.isPending ? <><Loader2 className="size-4 animate-spin" />Importing…</> : `Import ${safeSelected.length} selected roster rows`}</Button></div></section>}
            {commit.error && <Alert variant="danger"><AlertTitle>Roster was not committed</AlertTitle><AlertDescription>{commit.error.message}</AlertDescription></Alert>}
          </CardContent>
        </Card>
      )}

      {commit.isSuccess && <Card className="border-emerald-200 bg-emerald-50"><CardContent className="space-y-4 pt-6"><h3 className="text-lg font-black text-emerald-900"><CheckCircle2 className="mr-2 inline" />Roster import completed</h3><div className="flex flex-wrap gap-2"><Badge variant="success">{(commit.data as any).students_created || 0} students created</Badge><Badge variant="information">{(commit.data as any).created || 0} enrollments created</Badge><Badge variant="warning">{unresolved.length} unresolved</Badge></div><p className="text-sm text-emerald-900">Upload reference: {(commit.data as any).preview_id}</p><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={reset}>Upload another file</Button>{unresolved.length > 0 && <Button variant="outline" onClick={() => commit.reset()}>Review unresolved rows</Button>}<Link className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted" to="/upload-history"><History className="size-4" />View upload log</Link></div></CardContent></Card>}
    </div>
  );
}

function StudentUpdatePanel() {
  const exporter = useStudentTemplateExport(); const preview = useStudentUpdatePreview(); const commit = useStudentUpdateCommit();
  const [file, setFile] = useState<File | null>(null); const [selected, setSelected] = useState<number[]>([]);
  const exportFile = async () => saveBlob(await exporter.mutateAsync(), "operatoros-student-update.xlsx");
  const runPreview = async (event: React.FormEvent) => { event.preventDefault(); if (!file) return; const result = await preview.mutateAsync(file); setSelected(result.rows.filter((row: any) => row.classification === "UPDATE_EXISTING_MASTER").map((row: any) => row.id)); };
  const runCommit = () => commit.mutate({ batchId: preview.data.id, payload: { selected_row_ids: selected, confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: preview.data.preview_checksum } });
  return <div className="space-y-5"><Card><CardHeader><CardTitle>Student Data Update</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Export current database rows, edit approved fields, then upload the workbook for field-level comparison and stale-version checks.</p><Button variant="outline" onClick={exportFile} disabled={exporter.isPending}><Download className="size-4" />{exporter.isPending ? "Generating template…" : "Export Student Update Template"}</Button><form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={runPreview}><div className="flex-1"><Label htmlFor="student-update-file">Edited student update workbook</Label><Input id="student-update-file" type="file" accept=".xlsx" required onChange={(event) => setFile(event.target.files?.[0] || null)} /></div><Button type="submit" disabled={preview.isPending || !file}>{preview.isPending ? "Comparing changes…" : "Preview changes"}</Button></form>{preview.error && <Alert variant="danger"><AlertTitle>Update preview failed</AlertTitle><AlertDescription>{preview.error.message}</AlertDescription></Alert>}</CardContent></Card>
    {preview.data && <Card><CardHeader><CardTitle>Detected student changes</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2"><Badge>{preview.data.summary.total} rows</Badge><Badge variant="information">{preview.data.summary.updates} updates</Badge><Badge variant="secondary">{preview.data.summary.unchanged} unchanged</Badge><Badge variant="warning">{preview.data.summary.conflicts} conflicts</Badge></div><DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Select</DataTableHead><DataTableHead>Row</DataTableHead><DataTableHead>Student</DataTableHead><DataTableHead>Status</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{preview.data.rows.map((row: any) => <DataTableRow key={row.id}><DataTableCell><Checkbox aria-label={`Select student update row ${row.source_row}`} disabled={row.classification !== "UPDATE_EXISTING_MASTER" || commit.isPending} checked={selected.includes(row.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /></DataTableCell><DataTableCell>{row.source_row}</DataTableCell><DataTableCell>{row.payload["Legal Name"]}</DataTableCell><DataTableCell><Badge variant={row.classification === "UPDATE_EXISTING_MASTER" ? "success" : "warning"}>{row.classification.replaceAll("_", " ")}</Badge></DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer><Button onClick={runCommit} disabled={!selected.length || commit.isPending}>{commit.isPending ? "Applying selected updates…" : `Commit ${selected.length} selected updates`}</Button>{commit.isSuccess && <Alert variant="success"><AlertTitle>Student updates committed</AlertTitle><AlertDescription>{(commit.data as any).updated} rows updated transactionally.</AlertDescription></Alert>}</CardContent></Card>}</div>;
}

export default function UploadCenter() {
  const [mode, setMode] = useState("attendance");
  return <div className="space-y-6"><PageHeader eyebrow="Guarded imports" title="Data Import Center" description="Upload data, resolve blocked rows, and review history without bypassing backend validation." /><Tabs value={mode} onValueChange={setMode}><TabsList className="grid h-auto w-full grid-cols-2 lg:grid-cols-5"><TabsTrigger value="attendance"><FileSpreadsheet className="mr-2 inline size-4" />Attendance Upload</TabsTrigger><TabsTrigger value="roster"><Users className="mr-2 inline size-4" />Student Roster Upload</TabsTrigger><TabsTrigger value="attention"><BellRing className="mr-2 inline size-4" />Needs Attention</TabsTrigger><TabsTrigger value="history"><History className="mr-2 inline size-4" />Upload History</TabsTrigger><TabsTrigger value="student-update"><CheckCircle2 className="mr-2 inline size-4" />Student Data Update</TabsTrigger></TabsList><TabsContent value="attendance"><AttendanceUpload key={`attendance-${mode}`} embedded /></TabsContent><TabsContent value="roster"><RosterImportPanel key={`roster-${mode}`} /></TabsContent><TabsContent value="attention"><NeedsAttentionPanel /></TabsContent><TabsContent value="history"><UploadHistoryPanel /></TabsContent><TabsContent value="student-update"><StudentUpdatePanel key={`student-update-${mode}`} /></TabsContent></Tabs></div>;
}
