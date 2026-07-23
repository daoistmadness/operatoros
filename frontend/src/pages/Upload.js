import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";

import api from "../api";
import { Card } from "../components/ui/card";

const COMMITTABLE = new Set(["NEW", "DIFFERENCE", "UNCHANGED"]);
const CONFIRMATION = "COMMIT_ATTENDANCE_IMPORT";

export function classifyUploadError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const detail = err?.response?.data?.detail;
  if ((status === 400 || status === 409 || status === 422) && typeof detail === "string") return detail;
  if (status === 400 || status === 409 || status === 422) return "The workbook could not be validated. Review the preview details and source data.";
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

export function commitAttendancePreview(batchId, selectedRowIds) {
  return api.post(`/api/uploads/preview/${batchId}/commit`, {
    selected_row_ids: selectedRowIds,
    confirmation: CONFIRMATION,
  });
}

function Upload({ embedded = false }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const unresolved = useMemo(
    () => (preview?.rows || []).filter((row) => !COMMITTABLE.has(row.classification)),
    [preview],
  );

  const createPreview = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await previewAttendanceFile(file);
      setPreview(response.data);
      setSelected(
        response.data.rows
          .filter((row) => COMMITTABLE.has(row.classification))
          .map((row) => row.id),
      );
    } catch (err) {
      setError(classifyUploadError(err));
    } finally {
      setBusy(false);
    }
  };

  const commitPreview = async () => {
    if (!preview || selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await commitAttendancePreview(preview.batch_id, selected);
      setResult(response.data);
    } catch (err) {
      setError(classifyUploadError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSelected([]);
    setResult(null);
    setError("");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        {embedded
          ? <h2 className="text-3xl font-bold text-slate-900">Import Attendance Data</h2>
          : <h1 className="text-3xl font-bold text-slate-900">Import Attendance Data</h1>}
        <p className="mt-1 text-slate-500">Preview device rows before any attendance record is written.</p>
      </header>

      <Card className="rounded-2xl border-2 border-dashed p-8 text-center">
        <UploadCloud className="mx-auto text-slate-400" size={36} />
        <label className="mt-4 inline-flex cursor-pointer rounded-xl bg-brand px-5 py-2.5 font-semibold text-white">
          Select Excel file
          <input
            type="file"
            className="hidden"
            accept=".xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setPreview(null);
              setResult(null);
              setError("");
            }}
          />
        </label>
        {file && <p className="mt-3 text-sm text-slate-600"><FileText className="mr-1 inline" size={16} />{file.name}</p>}
        <button
          type="button"
          onClick={createPreview}
          disabled={!file || busy}
          className="ml-3 rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {busy && !preview ? "Previewing…" : "Preview import"}
        </button>
      </Card>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</div>}

      {preview && !result && (
        <Card className="overflow-hidden rounded-2xl">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-bold text-slate-900">Import preview</h3>
            <p className="text-sm text-slate-500">{preview.summary.logical_rows} staged rows; {unresolved.length} require identity resolution.</p>
          </div>
          {unresolved.length > 0 && (
            <div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mr-2 inline" size={16} />
              Unmatched device identities are visible below and cannot be committed.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Use</th><th className="p-3">Row</th><th className="p-3">Device ID</th><th className="p-3">Name</th><th className="p-3">Classification</th><th className="p-3">Issue</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => {
                  const allowed = COMMITTABLE.has(row.classification);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="p-3"><input aria-label={`Select row ${row.source_row}`} type="checkbox" disabled={!allowed} checked={selected.includes(row.id)} onChange={() => setSelected((ids) => ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id])} /></td>
                      <td className="p-3">{row.source_row}</td>
                      <td className="p-3">{row.student_identifier || "—"}</td>
                      <td className="p-3">{row.student || "—"}</td>
                      <td className="p-3 font-semibold">{row.classification}</td>
                      <td className="p-3 text-amber-800">{row.validation_error || row.warning || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
            <button type="button" onClick={reset} className="rounded-xl border border-slate-300 px-4 py-2">Cancel</button>
            <button type="button" onClick={commitPreview} disabled={busy || selected.length === 0} className="rounded-xl bg-brand px-5 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? <><Loader2 className="mr-2 inline animate-spin" size={16} />Committing…</> : `Commit ${selected.length} selected`}
            </button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50 p-6">
          <h3 className="font-bold text-emerald-900"><CheckCircle2 className="mr-2 inline" />Import committed</h3>
          <p className="mt-2 text-sm text-emerald-800">{result.rows_inserted || 0} inserted, {result.rows_updated || 0} updated, {result.rows_unchanged || 0} unchanged.</p>
          <button type="button" onClick={reset} className="mt-4 rounded-xl bg-white px-4 py-2 font-semibold text-emerald-900">Import another file</button>
        </Card>
      )}
    </div>
  );
}

export default Upload;
