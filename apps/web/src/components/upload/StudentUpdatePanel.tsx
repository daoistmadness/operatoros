import { Fragment, useState } from "react";
import { Download, History, Search, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commitStudentUpdateRollback, downloadStudentUpdateResult, fetchStudentUpdateHistory, fetchStudentUpdateSession, previewStudentUpdateRollback } from "../../api/students";
import { useAuth } from "../../context/AuthContext";
import { queryKeys } from "../../lib/query/queryKeys";
import { useStudentTemplateExport, useStudentUpdateCommit, useStudentUpdatePreview } from "../../hooks/useStudentQueries";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../common/data-table";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { saveBlob } from "../../lib/download";
import { invalidateEnrollmentQueries } from "../../lib/query/enrollmentInvalidation";
import type { StudentUpdateRow, StudentUpdateRollbackPreview } from "@operatoros/contracts/students";

const studentUpdateFields: Record<string, string> = {
  full_name: "Legal Name", preferred_name: "Preferred Name", nipd: "NIPD", nisn: "NISN", nik: "NIK",
  birth_place: "Birth Place", birth_date: "Birth Date", gender: "Gender", religion: "Religion",
  student_status: "Student Status", address: "Address", kelurahan: "Kelurahan", kecamatan: "Kecamatan",
  city_regency: "City", province: "Province", postal_code: "Postal Code", student_phone: "Phone",
  student_email: "Email", guardian_name: "Guardian Name", guardian_phone: "Guardian Phone",
  device_identifier: "Attendance Device No. ID", academic_class_id: "Class",
};

function updateRowStatus(row: StudentUpdateRow, applied: boolean, selected: boolean) {
  if (applied && selected) return "Updated";
  if (row.classification === "UPDATE_EXISTING_MASTER") return applied ? "Not Selected" : "Will Update";
  if (row.classification === "NO_CHANGE") return "No Change";
  if (row.errors.some((error) => error.code === "STALE_RECORD")) return "Preview Outdated";
  if (row.errors.some((error) => error.code === "UNKNOWN_UUID")) return "Student Not Found";
  if (row.errors.some((error) => error.code.startsWith("DUPLICATE_"))) return "Conflict";
  return row.classification === "CONFLICT" ? "Conflict" : "Invalid Data";
}

function updateRowReason(row: StudentUpdateRow, applied: boolean, selected: boolean) {
  if (applied && selected) return "Student record updated.";
  if (row.classification === "UPDATE_EXISTING_MASTER") return applied ? "This row was not selected for this update." : "Ready to update.";
  if (row.classification === "NO_CHANGE") return "Uploaded values already match current data.";
  if (row.errors.some((error) => error.code === "STALE_RECORD")) return "Student record changed after this template or preview was created. Export a fresh template and preview again.";
  if (row.errors.some((error) => error.code === "UNKNOWN_UUID")) return "No existing Student matches this update row. Use Student Roster import for new Students.";
  if (row.errors.some((error) => error.code.startsWith("DUPLICATE_"))) return `${row.errors.map((error) => error.message).join(" ")} Correct the workbook before applying updates.`;
  return row.errors.map((error) => error.message).join(" ") || "Check this row and preview again.";
}

export function StudentUpdatePanel() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const exporter = useStudentTemplateExport();
  const preview = useStudentUpdatePreview();
  const commit = useStudentUpdateCommit();
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [appliedIds, setAppliedIds] = useState<number[]>([]);
  const [historyBatch, setHistoryBatch] = useState("");
  const [rollbackPreview, setRollbackPreview] = useState<StudentUpdateRollbackPreview | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("Student Update correction");
  const [rollbackError, setRollbackError] = useState("");
  const [rollbackResult, setRollbackResult] = useState<{ sessionId: string; count: number } | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const history = useQuery({ queryKey: queryKeys.students.importSessions, queryFn: fetchStudentUpdateHistory, enabled: can("view_student_audit") });
  const historyDetail = useQuery({ queryKey: queryKeys.students.importSession(historyBatch), queryFn: () => fetchStudentUpdateSession(historyBatch), enabled: Boolean(historyBatch) && can("view_student_audit") });
  const runRollbackPreview = async () => {
    if (!historyDetail.data) return;
    setRollbackBusy(true);
    setRollbackError("");
    try {
      setRollbackPreview(await previewStudentUpdateRollback(String(historyDetail.data.session_id)));
      setRollbackReason("Student Update correction");
      setRollbackOpen(true);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : "Rollback preview failed. Refresh the session and try again.");
    } finally {
      setRollbackBusy(false);
    }
  };
  const runRollback = async () => {
    if (!historyDetail.data || !rollbackPreview || rollbackReason.trim().length < 5) return;
    setRollbackBusy(true);
    setRollbackError("");
    try {
      const result = await commitStudentUpdateRollback(String(historyDetail.data.session_id), {
        preview_checksum: rollbackPreview.preview_checksum,
        mode: "ALL",
        reason: rollbackReason.trim(),
        confirmation_value: rollbackPreview.required_confirmation,
        idempotency_token: globalThis.crypto.randomUUID(),
      });
      setRollbackResult({ sessionId: String(historyDetail.data.session_id), count: result.compensated_action_count ?? 0 });
      setRollbackOpen(false);
      setRollbackPreview(null);
      await invalidateEnrollmentQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: queryKeys.students.importSessions });
      await queryClient.invalidateQueries({ queryKey: queryKeys.students.importSession(historyBatch) });
      await historyDetail.refetch();
      await history.refetch();
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : "Rollback could not be completed safely.");
    } finally {
      setRollbackBusy(false);
    }
  };
  const exportFile = async () => saveBlob(await exporter.mutateAsync(), "operatoros-student-update.xlsx");
  const runPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    const result = await preview.mutateAsync(file);
    setSelected(result.rows.filter((row) => row.classification === "UPDATE_EXISTING_MASTER").map((row) => row.id));
    setAppliedIds([]);
    setFilter(result.summary.conflicts || result.summary.invalid ? "attention" : "update");
    setPage(1);
    setExpanded(null);
    commit.reset();
  };
  const runCommit = async () => {
    const data = preview.data;
    if (!data) return;
    const ids = [...selected];
    await commit.mutateAsync({ batchId: data.id, payload: { selected_row_ids: ids, confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: data.preview_checksum } });
    setAppliedIds(ids);
    setFilter("not-updated");
    setPage(1);
    setConfirm(false);
    void history.refetch();
  };
  const rows = (preview.data?.rows ?? []);
  const done = commit.isSuccess;
  const committedAt = history.data?.items.find((item) => item.id === preview.data?.id)?.committed_at;
  const attention = rows.filter((row) => !["UPDATE_EXISTING_MASTER", "NO_CHANGE"].includes(row.classification));
  const notUpdated = done ? rows.length - appliedIds.length : rows.length - selected.length;
  const conflictCount = attention.filter((row) => updateRowStatus(row, false, false) === "Conflict").length;
  const notFoundCount = attention.filter((row) => updateRowStatus(row, false, false) === "Student Not Found").length;
  const staleCount = attention.filter((row) => updateRowStatus(row, false, false) === "Preview Outdated").length;
  const invalidCount = attention.length - conflictCount - notFoundCount - staleCount;
  const filters = done ? [
    ["updated", "Updated", appliedIds.length], ["not-updated", "Not Updated", notUpdated], ["all", "All Rows", rows.length],
    ["unchanged", "No Change", preview.data?.summary.unchanged ?? 0], ["conflict", "Conflict", conflictCount], ["not-found", "Student Not Found", notFoundCount], ["invalid", "Invalid", invalidCount], ["stale", "Preview Outdated", staleCount],
  ] as const : [
    ["all", "Uploaded", rows.length], ["update", "Will Update", preview.data?.summary.updates ?? 0],
    ["unchanged", "No Change", preview.data?.summary.unchanged ?? 0], ["attention", "Needs Attention", attention.length],
    ["not-updated", "Not Updated", notUpdated], ["conflict", "Conflict", conflictCount], ["not-found", "Student Not Found", notFoundCount], ["invalid", "Invalid", invalidCount], ["stale", "Preview Outdated", staleCount],
  ] as const;
  const filtered = rows.filter((row) => {
    const isUpdate = row.classification === "UPDATE_EXISTING_MASTER";
    const status = updateRowStatus(row, false, false);
    const matchesFilter = filter === "all" || filter === "update" && isUpdate || filter === "unchanged" && row.classification === "NO_CHANGE" || filter === "attention" && !isUpdate && row.classification !== "NO_CHANGE" || filter === "updated" && appliedIds.includes(row.id) || filter === "not-updated" && !(done ? appliedIds : selected).includes(row.id) || filter === "conflict" && status === "Conflict" || filter === "not-found" && status === "Student Not Found" || filter === "invalid" && status === "Invalid Data" || filter === "stale" && status === "Preview Outdated";
    const text = `${row.payload["Legal Name"] ?? ""} ${row.payload.NIPD ?? ""} ${row.payload.NISN ?? ""} ${row.source_row}`.toLocaleLowerCase();
    return matchesFilter && text.includes(search.toLocaleLowerCase().trim());
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const selectedHistory = historyDetail.data;
  const rollbackAlreadyApplied = selectedHistory?.rollback_state === "APPLIED";
  const rollbackBlockedActions = rollbackPreview?.blocked_actions ?? 0;
  const rollbackDependencyConflicts = rollbackPreview?.dependency_conflicts ?? [];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Student Data Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Export current database rows, edit approved fields, then upload the workbook for field-level comparison and stale-version checks.
          </p>
          <Button variant="outline" onClick={exportFile} disabled={exporter.isPending}>
            <Download className="size-4" />
            {exporter.isPending ? "Generating template…" : "Export Student Update Template"}
          </Button>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={runPreview}>
            <div className="flex-1">
              <Label htmlFor="student-update-file">Edited student update workbook</Label>
              <Input id="student-update-file" type="file" accept=".xlsx" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </div>
            <Button type="submit" disabled={preview.isPending || !file}>
              {preview.isPending ? "Comparing changes…" : "Preview changes"}
            </Button>
          </form>
          {preview.error && (
            <Alert variant="danger">
              <AlertTitle>Update preview failed</AlertTitle>
              <AlertDescription>{preview.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      {preview.data && (
        <Card>
          <CardHeader>
            <CardTitle>{done ? "Student Update Completed" : "Review Student Changes"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">1 Upload → 2 Review Changes → 3 Apply + Result</p>
            {done && <Alert variant="success"><AlertTitle>Student Update Completed</AlertTitle><AlertDescription>{appliedIds.length} updated · {notUpdated} not updated{committedAt ? ` · Applied at ${committedAt}` : ""}.</AlertDescription></Alert>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Student update summary">
              {filters.map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }} className={`rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === key ? "border-primary bg-primary/10" : "border-border bg-surface"}`}><span className="block text-sm font-bold">{label}</span><strong className="text-2xl">{count}</strong></button>)}
            </div>
            {!done && <p className="text-sm">Not Updated ({notUpdated}): No Change {preview.data.summary.unchanged} · Conflict {conflictCount} · Student Not Found {notFoundCount} · Invalid {invalidCount} · Preview Outdated {staleCount}</p>}
            <div className="flex flex-wrap items-center gap-3"><Label htmlFor="student-update-search">Search students or source rows</Label><Input id="student-update-search" className="max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, NIPD, NISN, or row" /></div>
            {!done && preview.data.summary.updates === 0 && <Alert><AlertTitle>No student changes detected</AlertTitle><AlertDescription>{attention.length ? "No updates can be applied. Correct the issues below." : "All uploaded editable values already match the current database."}</AlertDescription></Alert>}
            <DataTableContainer>
              <DataTable className="min-w-[800px]">
                <DataTableHeader>
                  <DataTableRow>
                    {!done && <DataTableHead>Select</DataTableHead>}
                    <DataTableHead>Source Row</DataTableHead>
                    <DataTableHead>Student</DataTableHead>
                    <DataTableHead>NIPD</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                    <DataTableHead>Changes</DataTableHead>
                    <DataTableHead>Reason / Guidance</DataTableHead>
                    <DataTableHead>Details</DataTableHead>
                  </DataTableRow>
                </DataTableHeader>
                <DataTableBody>
                  {filtered.slice((page - 1) * 25, page * 25).map((row) => (<Fragment key={row.id}><DataTableRow>
                      {!done && <DataTableCell>
                        <Checkbox
                          aria-label={`Select student update row ${row.source_row}`}
                          disabled={row.classification !== "UPDATE_EXISTING_MASTER" || commit.isPending}
                          checked={selected.includes(row.id)}
                          onCheckedChange={(checked) =>
                            setSelected((current) => (checked ? Array.from(new Set([...current, row.id])) : current.filter((id) => id !== row.id)))
                          }
                        />
                      </DataTableCell>}
                      <DataTableCell>{row.source_row}</DataTableCell>
                      <DataTableCell>{row.payload["Legal Name"] || "Unknown"}</DataTableCell>
                      <DataTableCell>{row.payload.NIPD || "—"}</DataTableCell>
                      <DataTableCell>
                        <Badge variant={row.classification === "UPDATE_EXISTING_MASTER" ? "success" : "warning"}>{updateRowStatus(row, done, appliedIds.includes(row.id))}</Badge>
                      </DataTableCell>
                      <DataTableCell>{Object.keys(row.differences).length ? `${Object.keys(row.differences).length} fields` : "—"}</DataTableCell>
                      <DataTableCell>{updateRowReason(row, done, appliedIds.includes(row.id))}</DataTableCell>
                      <DataTableCell><Button size="sm" variant="outline" aria-label={`Details for row ${row.source_row}`} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Hide" : "View"}</Button></DataTableCell>
                    </DataTableRow>{expanded === row.id && <DataTableRow><DataTableCell colSpan={done ? 7 : 8}><div className="space-y-2 p-2 text-sm"><p className="font-bold">Row {row.source_row} · {row.payload["Legal Name"] || "Unknown"} · NIPD {row.payload.NIPD || "—"} · NISN {row.payload.NISN || "—"}</p><p>{updateRowReason(row, done, appliedIds.includes(row.id))}</p>{row.errors.map((error, index) => <p key={index}>{error.field || error.code}: {error.message}{error.field && row.payload[error.field] ? ` (uploaded: ${row.payload[error.field]})` : ""}{error.owner ? ` Already belongs to ${error.owner}.` : ""}</p>)}{Object.entries(row.differences).length > 0 && <DataTable><DataTableHeader><DataTableRow><DataTableHead>Field</DataTableHead><DataTableHead>Current</DataTableHead><DataTableHead>Uploaded</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{Object.entries(row.differences).map(([field, change]) => <DataTableRow key={field}><DataTableCell>{studentUpdateFields[field] || field}</DataTableCell><DataTableCell>{String(change.current ?? "—")}</DataTableCell><DataTableCell>{String(change.uploaded ?? "—")}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable>}</div></DataTableCell></DataTableRow>}</Fragment>))}
                </DataTableBody>
              </DataTable>
            </DataTableContainer>
            {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground">No students match this view.</p>}
            {pageCount > 1 && <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button variant="outline" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next</Button></div>}
            {commit.error && <Alert variant="danger"><AlertTitle>Student update was not applied</AlertTitle><AlertDescription>{commit.error.message}</AlertDescription></Alert>}
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-surface p-3"><p className="font-bold">{done ? `${appliedIds.length} Updated · ${notUpdated} Not Updated` : `${selected.length} Students Will Update · ${preview.data.summary.unchanged} No Change · ${attention.length} Needs Attention`}</p><div className="flex gap-2">{done ? <Button onClick={() => { preview.reset(); commit.reset(); setFile(null); setSearch(""); }}>Start Another Update</Button> : <><Button variant="outline" onClick={() => { preview.reset(); setFile(null); }}>Replace File</Button><Button onClick={() => setConfirm(true)} disabled={!selected.length || commit.isPending}>Apply {selected.length} Student Updates</Button></>}</div></div>
          </CardContent>
        </Card>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Apply Student Updates?</DialogTitle><DialogDescription>{selected.length} students will be updated. {preview.data?.summary.unchanged ?? 0} students are unchanged. {attention.length} need attention.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={commit.isPending} onClick={runCommit}>{commit.isPending ? "Applying…" : `Apply ${selected.length} Updates`}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={rollbackOpen} onOpenChange={(open) => { if (!rollbackBusy) setRollbackOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back Student Updates?</DialogTitle>
            <DialogDescription>
              This restores {rollbackPreview?.eligible_actions ?? 0} changed student records and appends rollback history. Original import evidence remains available.
            </DialogDescription>
          </DialogHeader>
          {rollbackBlockedActions > 0 && <Alert variant="danger"><AlertTitle>Rollback needs review</AlertTitle><AlertDescription>{rollbackBlockedActions} record(s) changed after import. No updates can be rolled back until the current records are reviewed.{rollbackDependencyConflicts.map((item) => <p key={item.action_id}>{item.reason}</p>)}</AlertDescription></Alert>}
          {rollbackError && <Alert variant="danger"><AlertTitle>Rollback not completed</AlertTitle><AlertDescription>{rollbackError}</AlertDescription></Alert>}
          <label className="grid gap-2 text-sm font-medium" htmlFor="student-update-rollback-reason">Reason for rollback<Textarea id="student-update-rollback-reason" value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} /></label>
          <DialogFooter>
            <Button variant="outline" disabled={rollbackBusy} onClick={() => setRollbackOpen(false)}>Cancel</Button>
            <Button disabled={rollbackBusy || !rollbackPreview?.eligible_actions || rollbackPreview.eligible_actions !== rollbackPreview.total_applied_actions || rollbackReason.trim().length < 5} onClick={runRollback}>{rollbackBusy ? "Rolling back…" : `Rollback ${rollbackPreview?.eligible_actions ?? 0} Updates`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {can("view_student_audit") && <Card>
        <CardHeader><CardTitle>Student Update History</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {history.isPending ? <p>Loading history…</p> : history.error ? <p>History could not be loaded.</p> : history.data?.items.length ? history.data.items.map((item) => <button type="button" key={item.id} aria-label={`Open Student Update history item ${item.filename}`} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left hover:border-primary" onClick={() => { setHistoryBatch(item.id); setRollbackError(""); }}><span>{item.filename} · {item.status === "committed" ? "Completed" : "Preview"}</span><span>Updated {item.status === "committed" ? item.summary.updates : 0} · No Change {item.summary.unchanged} · Conflicts {item.summary.conflicts} · Invalid {item.summary.invalid}</span></button>) : <p>No Student Update sessions yet.</p>}
          {historyBatch && <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Session detail</h3><Button variant="outline" onClick={() => setHistoryBatch("")}>Close</Button></div>
            {historyDetail.isPending ? <p>Loading session…</p> : historyDetail.error ? <p>Session detail could not be loaded.</p> : selectedHistory && <>
              <p>Updated {selectedHistory.status === "committed" ? selectedHistory.rows.filter((row) => row.selected).length : 0} · Not Updated {selectedHistory.rows.filter((row) => !row.selected).length}</p>
              {rollbackAlreadyApplied ? <Alert variant="success"><AlertTitle>Rollback completed</AlertTitle><AlertDescription>{rollbackResult?.sessionId === String(selectedHistory.session_id) ? `${rollbackResult.count} updates were restored.` : "This session has already been rolled back."}</AlertDescription></Alert> : selectedHistory.rollback_action_count > 0 ? <p className="text-sm text-muted-foreground">Rollback scope: {selectedHistory.rollback_action_count} applied updates.</p> : selectedHistory.rows.some((row) => row.selected) ? <p className="text-sm text-muted-foreground">Rollback unavailable — this session has no recorded before/after history for its applied rows.</p> : <p className="text-sm text-muted-foreground">Rollback unavailable — no student updates were applied.</p>}
              {rollbackError && <Alert variant="danger"><AlertTitle>Rollback preview failed</AlertTitle><AlertDescription>{rollbackError}</AlertDescription></Alert>}
              {can("rollback_import_session") && selectedHistory.status === "committed" && selectedHistory.rollback_action_count > 0 && !rollbackAlreadyApplied && <Button variant="outline" onClick={runRollbackPreview} disabled={rollbackBusy}>{rollbackBusy ? "Checking rollback…" : `Review rollback for ${selectedHistory.rollback_action_count} updates`}</Button>}
              <DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Source Row</DataTableHead><DataTableHead>Student</DataTableHead><DataTableHead>NIPD</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Reason</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{selectedHistory.rows.map((row) => <DataTableRow key={row.id}><DataTableCell>{row.source_row}</DataTableCell><DataTableCell>{row.payload["Legal Name"]}</DataTableCell><DataTableCell>{row.payload.NIPD || "—"}</DataTableCell><DataTableCell>{updateRowStatus(row, selectedHistory.status === "committed", row.selected)}</DataTableCell><DataTableCell>{updateRowReason(row, selectedHistory.status === "committed", row.selected)}{Object.keys(row.differences).length > 0 && <details className="mt-1"><summary className="cursor-pointer">{Object.keys(row.differences).length} changed fields</summary>{Object.entries(row.differences).map(([field, change]) => <p key={field}>{studentUpdateFields[field] || field}: {String(change.current ?? "—")} → {String(change.uploaded ?? "—")}</p>)}</details>}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>
              <Button variant="outline" onClick={async () => saveBlob(await downloadStudentUpdateResult(historyBatch), `student-update-result-${historyBatch}.xlsx`)}>Download Result</Button>
            </>}
          </div>}
        </CardContent>
      </Card>}
    </div>
  );
}

