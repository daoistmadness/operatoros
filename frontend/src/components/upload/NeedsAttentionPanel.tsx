import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, History, Loader2, Search, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import {
  ConflictItem,
  commitConflictRetry,
  fetchRosterComparison,
  fetchStudentCandidates,
  fetchUploadConflicts,
  linkConflictDevice,
  resolveRosterConflict,
  retryConflictPreview,
  StudentCandidate,
} from "../../api/uploadConflicts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { NativeSelect } from "../ui/native-select";

const queueKey = ["upload-conflicts"];

function statusVariant(status: string) {
  if (status === "RESOLVED_PENDING_RETRY") return "information";
  if (status === "RETRIED_COMMITTED") return "success";
  return "warning";
}

function ResolutionDialog({ item, onClose }: { item: ConflictItem | null; onClose: () => void }) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<StudentCandidate | null>(null);
  const [selectedRetryRows, setSelectedRetryRows] = useState<number[]>([]);
  const [showCommitSummary, setShowCommitSummary] = useState(false);
  const candidates = useQuery({
    queryKey: ["upload-conflict-candidates", item?.resolution_item_id, submittedQuery],
    queryFn: () => fetchStudentCandidates(item!.resolution_item_id, submittedQuery),
    enabled: Boolean(item && submittedQuery.length >= 2),
  });
  const linkDevice = useMutation({
    mutationFn: () => linkConflictDevice(item!, selected!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queueKey });
    },
  });
  const retry = useMutation({
    mutationFn: () => retryConflictPreview(item!),
    onSuccess: async (data) => {
      setSelectedRetryRows(data.outcomes.filter((row) => row.outcome === "NOW_ELIGIBLE").map((row) => row.retry_row_id));
      await client.invalidateQueries({ queryKey: queueKey });
    },
  });
  const commit = useMutation({
    mutationFn: () => commitConflictRetry(item!, retry.data!, selectedRetryRows),
    onSuccess: async () => client.invalidateQueries({ queryKey: queueKey }),
  });
  const comparison = useQuery({
    queryKey: ["upload-conflict-roster-comparison", item?.resolution_item_id, selected?.id],
    queryFn: () => fetchRosterComparison(item!.resolution_item_id, selected!.id),
    enabled: item?.workflow_type === "ROSTER" && Boolean(selected),
  });
  const resolveRoster = useMutation({
    mutationFn: () => resolveRosterConflict(item!, selected!),
    onSuccess: async () => client.invalidateQueries({ queryKey: queueKey }),
  });
  const canLink = item?.workflow_type === "ATTENDANCE" && selected?.student_status === "active" && !selected.has_active_device;
  const retryReady = Boolean(item?.retry_eligible || item?.resolution_status === "RESOLVED_PENDING_RETRY" || linkDevice.isSuccess);
  const isRoster = item?.workflow_type === "ROSTER";
  const immutableConflict = comparison.data?.fields.some((field) => field.classification === "IMMUTABLE_CONFLICT");
  const canResolveRoster = Boolean(
    selected && comparison.data?.allowed_plans.includes("LINK_ROW_TO_EXISTING_STUDENT") && !immutableConflict,
  );

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isRoster ? "Compare roster identity" : "Resolve attendance device"}</DialogTitle>
          <DialogDescription>
            {isRoster ? "Select a master student, compare every field, then explicitly confirm the audited link." : "Select a specific active student record. Search results never confirm a match by themselves."}
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm sm:grid-cols-3">
              <div><p className="text-amber-800">Device ID</p><p className="font-black">{item.affected_identifiers.device_identifier}</p></div>
              <div><p className="text-amber-800">Source row</p><p className="font-black">{item.source_row_number}</p></div>
              <div><p className="text-amber-800">Checksum</p><p className="font-black">{item.source_checksum_prefix}…</p></div>
            </div>
            {!retryReady && !resolveRoster.isSuccess && (
              <>
                <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setSelected(null); setSubmittedQuery(query.trim()); }}>
                  <div className="flex-1"><Label htmlFor="student-candidate-search">NIPD, NISN, student ID, device ID, or name</Label><Input id="student-candidate-search" value={query} minLength={2} onChange={(event) => setQuery(event.target.value)} /></div>
                  <Button type="submit" variant="outline" disabled={query.trim().length < 2 || candidates.isFetching}><Search className="size-4" />Search</Button>
                </form>
                {candidates.data?.length === 0 && <p role="status" className="rounded-lg bg-surface-muted p-4 text-sm font-semibold">No matching student records found.</p>}
                <div role="radiogroup" aria-label="Student candidates" className="space-y-2">
                  {candidates.data?.map((candidate) => (
                    <button key={candidate.id} type="button" role="radio" aria-checked={selected?.id === candidate.id} onClick={() => setSelected(candidate)} className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-primary/5">
                      <span><span className="block font-black">{candidate.full_name}</span><span className="text-sm text-muted-foreground">NIPD {candidate.nipd_masked || "not set"} · Class {candidate.current_class || "not enrolled"}</span></span>
                      <span className="text-right"><Badge variant={candidate.student_status === "active" ? "success" : "warning"}>{candidate.student_status}</Badge><span className="mt-1 block text-xs font-semibold">{candidate.has_active_device ? `Device ${candidate.active_device_masked}` : "No active device"}</span></span>
                    </button>
                  ))}
                </div>
                {selected?.has_active_device && <Alert variant="warning"><AlertTitle>Student already has a device</AlertTitle><AlertDescription>Ordinary linking is disabled. Use Student Management for a separately audited reassignment.</AlertDescription></Alert>}
                {selected?.student_status !== "active" && selected && <Alert variant="warning"><AlertTitle>Inactive student</AlertTitle><AlertDescription>Only active students can receive an attendance device mapping.</AlertDescription></Alert>}
                {linkDevice.error && <Alert variant="danger"><AlertTitle>Device was not linked</AlertTitle><AlertDescription>{linkDevice.error.message}</AlertDescription></Alert>}
              </>
            )}
            {isRoster && selected && comparison.isLoading && <p role="status" className="flex items-center gap-2 font-bold"><Loader2 className="size-4 animate-spin" />Loading field comparison…</p>}
            {isRoster && comparison.error && <Alert variant="danger"><AlertTitle>Comparison unavailable</AlertTitle><AlertDescription>{comparison.error.message}</AlertDescription></Alert>}
            {isRoster && comparison.data && !resolveRoster.isSuccess && (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-3 border-b border-border pb-2 text-xs font-black uppercase tracking-wide text-muted-foreground"><span>Incoming roster</span><span>Existing master</span><span>Decision</span></div>
                {comparison.data.fields.map((field) => <div key={field.field} className="grid grid-cols-[1fr_1fr_auto] gap-3 rounded-lg bg-surface-muted p-3 text-sm"><div><p className="text-xs font-bold text-muted-foreground">{field.field}</p><p className="font-semibold">{field.incoming_value || "Not provided"}</p></div><div><p className="text-xs font-bold text-muted-foreground">{field.field}</p><p className="font-semibold">{field.existing_value || "Not set"}</p></div><Badge variant={field.classification === "IMMUTABLE_CONFLICT" ? "danger" : field.classification === "MATCH" ? "success" : "warning"}>{field.classification.replaceAll("_", " ")}</Badge></div>)}
                {immutableConflict && <Alert variant="danger"><AlertTitle>Stable identifiers conflict</AlertTitle><AlertDescription>This row cannot be linked here because immutable identifiers differ. Leave it unresolved and correct the source or master data.</AlertDescription></Alert>}
                {resolveRoster.error && <Alert variant="danger"><AlertTitle>Roster row was not resolved</AlertTitle><AlertDescription>{resolveRoster.error.message}</AlertDescription></Alert>}
              </div>
            )}
            {resolveRoster.isSuccess && <Alert variant="success"><CheckCircle2 className="size-4" /><AlertTitle>Roster identity linked</AlertTitle><AlertDescription>The pending roster row now references the selected master student. No immutable identifier was overwritten.</AlertDescription></Alert>}
            {linkDevice.isSuccess && <Alert variant="success"><CheckCircle2 className="size-4" /><AlertTitle>Device identity linked</AlertTitle><AlertDescription>The original row is still excluded. Run retry preview to revalidate it before any commit.</AlertDescription></Alert>}
            {!isRoster && retry.error && <Alert variant="danger"><AlertTitle>Retry preview failed</AlertTitle><AlertDescription>{retry.error.message}</AlertDescription></Alert>}
            {!isRoster && retry.isSuccess && <div className="space-y-3"><Alert variant="success"><ShieldCheck className="size-4" /><AlertTitle>Retry preview complete</AlertTitle><AlertDescription>Preview only: no attendance has changed. Select eligible rows and review the commit summary.</AlertDescription></Alert>{retry.data.outcomes.map((row) => { const eligible = row.outcome === "NOW_ELIGIBLE"; return <label key={row.retry_row_id} className="flex items-center gap-3 rounded-lg border border-border p-3"><Checkbox checked={selectedRetryRows.includes(row.retry_row_id)} disabled={!eligible || commit.isPending} onCheckedChange={(checked) => { setSelectedRetryRows((current) => checked ? Array.from(new Set([...current, row.retry_row_id])) : current.filter((id) => id !== row.retry_row_id)); setShowCommitSummary(false); }} /><span className="flex-1"><span className="block font-bold">Source row {row.source_row}</span><span className="text-sm text-muted-foreground">{row.classification.replaceAll("_", " ")} · {row.outcome.replaceAll("_", " ")}</span></span><Badge variant={eligible ? "success" : "warning"}>{eligible ? "Eligible" : "Blocked"}</Badge></label>;})}<div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setSelectedRetryRows(retry.data.outcomes.filter((row) => row.outcome === "NOW_ELIGIBLE").map((row) => row.retry_row_id))}>Select all eligible</Button><Button type="button" variant="ghost" onClick={() => setSelectedRetryRows([])}>Clear</Button></div>{showCommitSummary && <Alert variant="warning"><AlertTitle>Commit {selectedRetryRows.length} selected row{selectedRetryRows.length === 1 ? "" : "s"}?</AlertTitle><AlertDescription>Source {item.source_filename}, session {item.source_session_id}, checksum {item.source_checksum_prefix}…, retry batch {retry.data.retry_batch_id}. Only selected eligible rows will be written; blocked and unselected rows remain excluded.</AlertDescription></Alert>}{commit.error && <Alert variant="danger"><AlertTitle>Attendance was not committed</AlertTitle><AlertDescription>{commit.error.message}</AlertDescription></Alert>}{commit.isSuccess && <Alert variant="success"><AlertTitle>Selected attendance committed</AlertTitle><AlertDescription>The guarded retry commit completed. Unselected and blocked rows were not changed.</AlertDescription></Alert>}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Return to queue</Button>
          {isRoster ? (!resolveRoster.isSuccess && <Button onClick={() => resolveRoster.mutate()} disabled={!canResolveRoster || resolveRoster.isPending}>{resolveRoster.isPending ? "Linking roster…" : "Confirm roster link"}</Button>) : !retryReady ? <Button onClick={() => linkDevice.mutate()} disabled={!canLink || linkDevice.isPending}>{linkDevice.isPending ? <><Loader2 className="size-4 animate-spin" />Linking…</> : "Confirm device link"}</Button> : !retry.isSuccess ? <Button onClick={() => retry.mutate()} disabled={retry.isPending}>{retry.isPending ? "Revalidating…" : "Retry preview"}</Button> : !showCommitSummary ? <Button onClick={() => setShowCommitSummary(true)} disabled={!selectedRetryRows.length || commit.isSuccess}>Review commit</Button> : <Button onClick={() => commit.mutate()} disabled={!selectedRetryRows.length || commit.isPending || commit.isSuccess}>{commit.isPending ? "Committing selected rows…" : `Confirm commit (${selectedRetryRows.length})`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NeedsAttentionPanel() {
  const [workflow, setWorkflow] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [activeItem, setActiveItem] = useState<ConflictItem | null>(null);
  const queue = useQuery({
    queryKey: [...queueKey, workflow, status, page],
    queryFn: () => fetchUploadConflicts({ workflow_type: workflow || undefined, resolution_status: status || undefined, page, page_size: 20 }),
  });

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.22),_transparent_45%),linear-gradient(135deg,#fffdf5,#ffffff)] p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Resolution center</p><h2 className="mt-2 text-3xl font-black">Needs Attention</h2><p className="mt-2 max-w-2xl text-muted-foreground">Resolve identities and references first. Rows remain excluded until backend preview validation marks them eligible.</p></div>
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted" to="/upload-history"><History className="size-4" />Upload History</Link>
        </div>
      </section>
      {queue.data && <div role="status" aria-live="polite" className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Card><CardContent className="pt-5"><p className="text-2xl font-black">{queue.data.summary.unresolved}</p><p className="text-sm text-muted-foreground">Unresolved</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-black">{queue.data.summary.attendance}</p><p className="text-sm text-muted-foreground">Attendance</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-black">{queue.data.summary.roster}</p><p className="text-sm text-muted-foreground">Roster</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-black">{queue.data.summary.retry_ready}</p><p className="text-sm text-muted-foreground">Retry ready</p></CardContent></Card></div>}
      <Card>
        <CardHeader><CardTitle>Unresolved import queue</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="conflict-workflow">Upload type</Label><NativeSelect id="conflict-workflow" value={workflow} onChange={(event) => { setWorkflow(event.target.value); setPage(1); }}><option value="">All uploads</option><option value="ATTENDANCE">Attendance</option><option value="ROSTER">Student roster</option></NativeSelect></div>
            <div><Label htmlFor="conflict-status">Resolution status</Label><NativeSelect id="conflict-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All active statuses</option><option value="UNRESOLVED">Unresolved</option><option value="RESOLVED_PENDING_RETRY">Ready for retry</option><option value="RETRIED_STILL_BLOCKED">Still blocked</option></NativeSelect></div>
          </div>
          {queue.isLoading && <p role="status" className="flex items-center gap-2 py-10 font-bold"><Loader2 className="size-5 animate-spin" />Loading conflicts…</p>}
          {queue.error && <Alert variant="danger"><AlertTitle>Conflict queue unavailable</AlertTitle><AlertDescription>{queue.error.message}</AlertDescription></Alert>}
          {queue.data?.items.length === 0 && <div className="py-12 text-center"><CheckCircle2 className="mx-auto size-10 text-emerald-600" /><p className="mt-3 font-black">No conflicts match these filters</p><p className="text-sm text-muted-foreground">New unresolved imports will appear here automatically.</p></div>}
          <div className="grid gap-3">
            {queue.data?.items.map((item) => (
              <article key={item.resolution_item_id} className="grid gap-4 rounded-xl border border-border bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div><div className="flex flex-wrap items-center gap-2"><Badge variant={item.workflow_type === "ATTENDANCE" ? "information" : "secondary"}>{item.workflow_type}</Badge><Badge variant={statusVariant(item.resolution_status)}>{item.resolution_status.replaceAll("_", " ")}</Badge><span className="text-sm font-bold">Row {item.source_row_number}</span></div><h3 className="mt-3 font-black">{item.operator_message}</h3><p className="mt-1 text-sm text-muted-foreground">{item.recommended_action}</p><details className="mt-3 text-sm"><summary className="cursor-pointer font-bold text-primary">Technical details and provenance</summary><dl className="mt-2 grid gap-2 rounded-lg bg-surface-muted p-3 sm:grid-cols-2"><div><dt className="text-muted-foreground">Source file</dt><dd className="break-all font-semibold">{item.source_filename}</dd></div><div><dt className="text-muted-foreground">Checksum</dt><dd className="font-semibold">{item.source_checksum_prefix}…</dd></div><div><dt className="text-muted-foreground">Session</dt><dd className="break-all font-semibold">{item.source_session_id}</dd></div><div><dt className="text-muted-foreground">Technical code</dt><dd className="font-semibold">{item.technical_code}</dd></div></dl></details></div>
                <div className="flex flex-wrap gap-2 lg:justify-end">{item.student && <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-bold" to={`/students/${item.student.id}`}>View student</Link>}<Button onClick={() => setActiveItem(item)} disabled={!((item.workflow_type === "ATTENDANCE" && item.technical_code === "DEVICE_IDENTITY_UNMATCHED") || (item.workflow_type === "ROSTER" && item.technical_code === "POSSIBLE_DUPLICATE"))}><AlertTriangle className="size-4" />{item.workflow_type === "ROSTER" ? "Compare records" : "Resolve"}</Button></div>
              </article>
            ))}
          </div>
          {queue.data && queue.data.total_pages > 1 && <nav aria-label="Conflict queue pages" className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm font-bold">Page {page} of {queue.data.total_pages}</span><Button variant="outline" disabled={page >= queue.data.total_pages} onClick={() => setPage((value) => value + 1)}>Next</Button></nav>}
        </CardContent>
      </Card>
      <ResolutionDialog key={activeItem?.resolution_item_id || "closed"} item={activeItem} onClose={() => setActiveItem(null)} />
    </div>
  );
}
