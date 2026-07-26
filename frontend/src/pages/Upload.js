import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, History, Loader2, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";

import api from "../api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  attendanceRowView,
  eligibleIds,
  safeSelectedIds,
  selectionState,
} from "../lib/uploadWorkflow";

const CONFIRMATION = "COMMIT_ATTENDANCE_IMPORT";
const REQUIRED_COLUMNS = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];

export function classifyUploadError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const detail = err?.response?.data?.detail;
  if ((status === 400 || status === 409 || status === 410 || status === 422) && typeof detail === "string") return detail;
  if (status === 409 || status === 410) return detail?.message || "This preview is stale or no longer eligible. Preview the workbook again.";
  if (status === 400 || status === 422) return detail?.message || "The workbook could not be validated. Review the preview details and source data.";
  if (status === 401) return "Your session has expired. Sign in again before importing.";
  if (status === 403) return "Your account does not have permission to import attendance data.";
  if (status === 413) return "The workbook is larger than the server upload limit.";
  if (status >= 500) return "The server could not process the workbook. Retry or contact the system administrator.";
  if (!status) return "The backend could not be reached. Check that the OperatorOS server is running.";
  return "The attendance import could not be completed. Retry or contact the system administrator.";
}

export function previewAttendanceFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  return api.post("/api/uploads/preview", formData);
}

export function commitAttendancePreview(batchId, selectedRowIds, previewChecksum) {
  return api.post(`/api/uploads/preview/${batchId}/commit`, {
    selected_row_ids: [...new Set(selectedRowIds)],
    confirmation: CONFIRMATION,
    preview_checksum: previewChecksum,
  });
}

export function WorkflowIndicator({ stage }) {
  const stages = ["Choose file", "Preview", "Resolve issues", "Commit"];
  const current = stages.indexOf(stage);
  return (
    <ol aria-label="Attendance import progress" className="grid gap-2 sm:grid-cols-4">
      {stages.map((label, index) => {
        const state = index < current ? "Completed" : index === current ? "Current" : "Upcoming";
        return (
          <li key={label} aria-current={index === current ? "step" : undefined} className={`rounded-lg border px-3 py-2 text-sm font-bold ${index === current ? "border-primary bg-primary/10 text-primary" : index < current ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-surface-muted text-muted-foreground"}`}>
            <span className="block text-xs uppercase tracking-wide">{state}</span>{label}
          </li>
        );
      })}
    </ol>
  );
}

function Upload({ embedded = false }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const headerCheckbox = useRef(null);

  const viewRows = useMemo(() => (preview?.rows || []).map((row) => ({ source: row, view: attendanceRowView(row) })), [preview]);
  const eligible = useMemo(() => eligibleIds(preview?.rows || [], attendanceRowView), [preview]);
  const safeSelected = useMemo(() => safeSelectedIds(preview?.rows || [], selected, attendanceRowView), [preview, selected]);
  const unresolved = viewRows.filter(({ view }) => !view.selectable);
  const changed = viewRows.filter(({ view }) => view.selectable && ["CREATE", "DIFFERENCE"].includes(view.action)).map(({ view }) => view.key);
  const headerState = selectionState(eligible, safeSelected);

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = headerState.indeterminate;
  }, [headerState.indeterminate]);

  const createPreview = async () => {
    if (!file || busy) return;
    setBusy(true); setError(""); setResult(null); setShowSummary(false);
    try {
      const response = await previewAttendanceFile(file);
      setPreview(response.data);
      setSelected([]);
    } catch (err) {
      setPreview(null);
      setError(classifyUploadError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitPreview = async () => {
    if (!preview || safeSelected.length === 0 || busy) return;
    setBusy(true); setError("");
    try {
      const response = await commitAttendancePreview(preview.batch_id, safeSelected, preview.checksum);
      setResult({ ...response.data, completed_at: new Date().toLocaleString() });
      setShowSummary(false);
    } catch (err) {
      setError(classifyUploadError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null); setPreview(null); setSelected([]); setResult(null); setError(""); setShowSummary(false);
  };

  const selectOne = (id, checked) => {
    const next = checked ? [...safeSelected, id] : safeSelected.filter((value) => value !== id);
    setSelected(safeSelectedIds(preview.rows, next, attendanceRowView));
    setShowSummary(false);
  };

  const stage = result ? "Commit" : preview ? (showSummary ? "Commit" : unresolved.length ? "Resolve issues" : "Preview") : file ? "Preview" : "Choose file";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        {embedded ? <h2 className="text-3xl font-black text-foreground">Attendance Upload</h2> : <h1 className="text-3xl font-black text-foreground">Attendance Upload</h1>}
        <p className="mt-2 max-w-3xl text-muted-foreground">Import attendance device records, preview detected changes, resolve unmatched identities, and commit only selected eligible rows.</p>
      </header>

      <WorkflowIndicator stage={stage} />
      <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 p-4 font-bold text-blue-900">Preview does not update the database.</div>

      <Card>
        <CardHeader><CardTitle>Choose attendance workbook</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-xl border-2 border-dashed border-border p-6 text-center">
              <UploadCloud className="mx-auto text-muted-foreground" size={36} />
              <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-md bg-primary px-5 py-2.5 font-bold text-primary-foreground focus-within:ring-2 focus-within:ring-ring">
                Select Excel file
                <input type="file" className="sr-only" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setSelected([]); setResult(null); setError(""); setShowSummary(false); }} />
              </label>
              {file && <p className="mt-3 break-all text-sm text-foreground"><FileText className="mr-1 inline" size={16} />{file.name}</p>}
              <Button className="mt-4 sm:ml-3" onClick={createPreview} disabled={!file || busy}>{busy && !preview ? "Previewing…" : "Preview attendance"}</Button>
            </div>
            <div className="rounded-xl bg-surface-muted p-5">
              <h3 className="font-black text-foreground">Workbook requirements</h3>
              <p className="mt-2 text-sm text-muted-foreground">Supported formats: `.xlsx` and `.xls`. Dates must use `DD/MM/YYYY`. Device IDs must already be linked to active students.</p>
              <div className="mt-3 flex flex-wrap gap-2">{REQUIRED_COLUMNS.map((column) => <Badge key={column} variant="secondary">{column}</Badge>)}</div>
              <p className="mt-4 text-sm font-semibold text-amber-900">For newly registered students, import the Student Roster first. Attendance import never creates students or device identities.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</div>}

      {preview && !result && (
        <Card>
          <CardHeader>
            <CardTitle>Attendance preview</CardTitle>
            <p className="text-sm text-muted-foreground">{preview.filename} · Preview ID {preview.batch_id}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="status" aria-live="polite" className="flex flex-wrap gap-2">
              <Badge>{preview.rows.length} total</Badge><Badge variant="success">{eligible.length} eligible</Badge><Badge variant="information">{safeSelected.length} selected</Badge><Badge variant="warning">{unresolved.length} unresolved</Badge><Badge variant="danger">{preview.summary.invalid_rows || 0} invalid</Badge>
              <span className="sr-only">{safeSelected.length} rows selected; {unresolved.length} rows require attention.</span>
            </div>
            {unresolved.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mr-2 inline" size={16} />{unresolved.length} blocked row(s) cannot be selected. Follow each row’s recommended action, then preview a corrected workbook.</div>}

            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-surface)]">
              <label className="flex min-h-10 items-center gap-2 px-2 font-bold">
                <input ref={headerCheckbox} aria-label="Select all eligible attendance rows" type="checkbox" checked={headerState.checked} disabled={!eligible.length || busy} onChange={(event) => { setSelected(event.target.checked ? eligible : []); setShowSummary(false); }} />
                All eligible
              </label>
              <Button size="sm" variant="outline" onClick={() => { setSelected(eligible); setShowSummary(false); }} disabled={!eligible.length || busy}>Select eligible</Button>
              <Button size="sm" variant="outline" onClick={() => { setSelected(changed); setShowSummary(false); }} disabled={!changed.length || busy}>Select changed only</Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setShowSummary(false); }} disabled={!safeSelected.length || busy}>Clear selection</Button>
              <span className="ml-auto text-sm font-bold">{safeSelected.length} of {preview.rows.length} selected · {unresolved.length} unresolved</span>
              <Button size="sm" onClick={() => setShowSummary(true)} disabled={!safeSelected.length || busy}>Continue to summary</Button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-muted text-xs font-black uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Use</th><th className="p-3">Row</th><th className="p-3">Device ID</th><th className="p-3">Name</th><th className="p-3">Classification</th><th className="p-3">Guidance</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {viewRows.map(({ source: row, view }) => (
                    <tr key={view.key} className={!view.selectable ? "bg-amber-50/50" : ""}>
                      <td className="p-3"><Checkbox aria-label={`Select attendance row ${row.source_row}`} disabled={!view.selectable || busy} checked={safeSelected.includes(view.key)} onCheckedChange={(checked) => selectOne(view.key, checked === true)} /></td>
                      <td className="p-3">{row.source_row}</td><td className="max-w-36 break-all p-3">{row.student_identifier || "—"}</td><td className="p-3">{row.student || "—"}</td>
                      <td className="p-3"><Badge variant={view.selectable ? (view.action === "UNCHANGED" ? "secondary" : "success") : view.action === "INVALID" ? "danger" : "warning"}>{view.label}</Badge>{!view.selectable && <p className="mt-2 text-xs font-bold text-amber-900">{view.disabledReason}</p>}</td>
                      <td className="max-w-xl p-3"><p className="font-semibold text-foreground">{view.explanation}</p><p className="mt-1 text-muted-foreground">{view.recommendedAction}</p>{(row.validation_error || row.warning) && <details className="mt-2"><summary className="cursor-pointer font-bold text-primary"><ChevronDown className="mr-1 inline size-4" />Technical details</summary><p className="mt-2 break-words rounded-lg bg-surface-muted p-3 text-xs">{view.technicalCode && <>Code: {view.technicalCode}<br /></>}Source row: {row.source_row}<br />{row.validation_error || row.warning}</p></details>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showSummary && (
              <section aria-labelledby="attendance-commit-summary" className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
                <h3 id="attendance-commit-summary" className="text-lg font-black">Commit summary</h3>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">File</dt><dd className="break-all font-bold">{preview.filename}</dd></div><div><dt className="text-muted-foreground">Upload type</dt><dd className="font-bold">Attendance</dd></div><div><dt className="text-muted-foreground">Selected</dt><dd className="font-bold">{safeSelected.length} rows</dd></div><div><dt className="text-muted-foreground">Creates / changes</dt><dd className="font-bold">{safeSelected.filter((id) => viewRows.find(({ view }) => view.key === id)?.view.action === "CREATE").length} / {safeSelected.filter((id) => viewRows.find(({ view }) => view.key === id)?.view.action === "DIFFERENCE").length}</dd></div><div><dt className="text-muted-foreground">Unchanged selected</dt><dd className="font-bold">{safeSelected.filter((id) => viewRows.find(({ view }) => view.key === id)?.view.action === "UNCHANGED").length}</dd></div><div><dt className="text-muted-foreground">Skipped</dt><dd className="font-bold">{preview.rows.length - safeSelected.length}</dd></div><div><dt className="text-muted-foreground">Unresolved / invalid</dt><dd className="font-bold">{unresolved.length} / {preview.summary.invalid_rows || 0}</dd></div><div><dt className="text-muted-foreground">Preview ID</dt><dd className="break-all font-bold">{preview.batch_id}</dd></div></dl>
                <div className="mt-4 space-y-1 text-sm text-slate-700"><p>Only selected eligible rows will be submitted, and the backend validates them again before commit.</p><p>Existing manual attendance overrides remain authoritative. Protected or finalized records follow the existing correction workflow.</p><p>The selected import is committed atomically; a validation failure rolls back the transaction. Unresolved rows remain excluded, and stale previews may be rejected.</p></div>
                <div className="mt-5 flex flex-wrap justify-end gap-3"><Button variant="outline" onClick={() => setShowSummary(false)}>Back to preview</Button><Button onClick={commitPreview} disabled={busy || !safeSelected.length}>{busy ? <><Loader2 className="size-4 animate-spin" />Importing…</> : `Import ${safeSelected.length} attendance rows`}</Button></div>
              </section>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="space-y-4 pt-6">
            <h3 className="text-lg font-black text-emerald-900"><CheckCircle2 className="mr-2 inline" />Attendance import completed</h3>
            <div role="status" aria-live="polite" className="grid gap-3 sm:grid-cols-4"><Badge variant="success">{result.rows_inserted || 0} created</Badge><Badge variant="information">{result.rows_updated || 0} changed</Badge><Badge variant="secondary">{result.rows_unchanged || 0} unchanged</Badge><Badge variant="warning">{unresolved.length} unresolved</Badge></div>
            <p className="text-sm text-emerald-900">Upload reference: {result.batch_id || preview?.batch_id} · Completed {result.completed_at}</p>
            <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={reset}>Upload another file</Button>{unresolved.length > 0 && <Button variant="outline" onClick={() => { setResult(null); setShowSummary(false); }}>Review unresolved rows</Button>}<Link className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted" to="/upload-history"><History className="size-4" />View upload log</Link></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default Upload;
