import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Download, FileClock, Filter, History, Loader2, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { downloadUploadEvidence, getUploadDetail, getUploadHistory, getUploadRows, getUploadTimeline, type UploadRecord } from "../../api/uploadHistory";
import { getPageApiError } from "../../lib/api/errors";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../common/data-table";

const number = (value: number | null | undefined) => value == null ? "Unknown" : value.toLocaleString();
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "Unknown";
const label = (value: string) => value.replaceAll("_", " ");

function reconciliationVariant(state: string) {
  if (state === "BALANCED") return "success";
  if (state === "BALANCED_WITH_UNRESOLVED") return "warning";
  if (state === "INCONSISTENT") return "danger";
  return "secondary";
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function Metric({ title, value }: { title: string; value: number | null | undefined }) {
  return <div className="rounded-xl border border-border bg-surface-muted/50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</dt><dd className="mt-1 text-xl font-black text-foreground">{number(value)}</dd></div>;
}

function HistoryDetail({ uploadId, onBack }: { uploadId: string; onBack: () => void }) {
  const [rowPage, setRowPage] = useState(1);
  const [outcome, setOutcome] = useState("");
  const [downloading, setDownloading] = useState<"" | "csv" | "json">("");
  const detail = useQuery({ queryKey: ["upload-history-detail", uploadId], queryFn: () => getUploadDetail(uploadId) });
  const timeline = useQuery({ queryKey: ["upload-history-timeline", uploadId], queryFn: () => getUploadTimeline(uploadId) });
  const rows = useQuery({ queryKey: ["upload-history-rows", uploadId, rowPage, outcome], queryFn: () => getUploadRows(uploadId, rowPage, outcome) });

  const download = async (format: "csv" | "json") => {
    if (downloading) return;
    setDownloading(format);
    try {
      const blob = await downloadUploadEvidence(uploadId, format);
      saveBlob(blob, `operatoros-upload-evidence-${uploadId.replaceAll(":", "-")}.${format}`);
    } finally {
      setDownloading("");
    }
  };

  if (detail.isPending) return <Card><CardContent className="flex min-h-52 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-5 animate-spin" />Loading upload evidence...</CardContent></Card>;
  if (detail.error || !detail.data) return <Alert variant="danger"><AlertCircle className="size-4" /><AlertTitle>Upload evidence could not be loaded</AlertTitle><AlertDescription>{getPageApiError(detail.error, "Refresh and try again.")}</AlertDescription></Alert>;
  const item = detail.data;
  const metrics = [
    ["Preview", item.preview_total], ["Eligible", item.preview_eligible], ["Selected", item.selected_total],
    ["Committed", item.committed_total], ["Created", item.created_total], ["Updated", item.updated_total],
    ["Unchanged", item.unchanged_total], ["Skipped", item.skipped_total], ["Duplicates", item.duplicate_total],
    ["Conflicts", item.conflict_total], ["Invalid", item.invalid_total], ["Protected", item.protected_total],
    ["Failed", item.failed_total], ["Unresolved", item.unresolved_total], ["Retry selected", item.retry_selected_total],
    ["Retry committed", item.retry_committed_total],
  ] as const;

  return <div className="space-y-5">
    <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" />Back to upload history</Button>
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{item.workflow_type} evidence</p><CardTitle className="mt-1 break-all">{item.source_filename}</CardTitle></div><div className="flex flex-wrap gap-2"><Badge>{label(item.status)}</Badge><Badge variant={reconciliationVariant(item.reconciliation_state) as any}>{label(item.reconciliation_state)}</Badge></div></div></CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-muted-foreground">Actor</p><p className="font-bold">{item.actor}</p></div>
        <div><p className="text-muted-foreground">Checksum prefix</p><p className="font-mono font-bold">{item.checksum_prefix}</p></div>
        <div><p className="text-muted-foreground">First activity</p><p className="font-bold">{dateTime(item.first_activity_at)}</p></div>
        <div><p className="text-muted-foreground">Latest activity</p><p className="font-bold">{dateTime(item.latest_activity_at)}</p></div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Reconciliation</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div role="status" aria-label={`Reconciliation state ${label(item.reconciliation_state)}`} className="flex items-center gap-2 font-black"><ShieldAlert className="size-5" />{label(item.reconciliation_state)}</div>
        {item.reconciliation_messages.length > 0 && <Alert variant={item.reconciliation_state === "INCONSISTENT" ? "danger" : "warning"}><AlertTitle>Evidence notes</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{item.reconciliation_messages.map((message) => <li key={message}>{message}</li>)}</ul></AlertDescription></Alert>}
        {item.rollback_succeeded && <Alert variant="warning"><RotateCcw className="size-4" /><AlertTitle>Commit rolled back</AlertTitle><AlertDescription>No rows are presented as successfully imported.</AlertDescription></Alert>}
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([title, value]) => <Metric key={title} title={title} value={value} />)}</dl>
        <p className="text-sm text-muted-foreground">Retry totals are reported separately and never added to the original committed total. Unknown evidence is shown as Unknown, not zero.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
      <CardContent>{timeline.isPending ? <p className="text-muted-foreground">Loading timeline...</p> : timeline.error ? <Alert variant="danger"><AlertTitle>Timeline unavailable</AlertTitle><AlertDescription>{getPageApiError(timeline.error, "Try again.")}</AlertDescription></Alert> : <ol className="relative space-y-4 border-l-2 border-border pl-5">{timeline.data?.map((event) => <li key={`${event.reference_id}-${event.timestamp}`}><span className="absolute -left-[7px] mt-1 size-3 rounded-full border-2 border-surface bg-primary" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black">{label(event.event)}</p><time className="text-xs text-muted-foreground">{dateTime(event.timestamp)}</time></div><p className="mt-1 text-sm">{event.message}</p><p className="mt-1 break-all text-xs text-muted-foreground">Actor: {event.actor || "Unknown"} · Ref: {event.reference_id}</p></li>)}</ol>}</CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Row Outcomes</CardTitle><div className="flex items-center gap-2"><Label className="sr-only" htmlFor="row-outcome">Row outcome filter</Label><select id="row-outcome" className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-bold" value={outcome} onChange={(event) => { setOutcome(event.target.value); setRowPage(1); }}><option value="">All outcomes</option><option value="committed">Committed</option><option value="unresolved">Unresolved</option><option value="retried">Retried</option><option value="invalid">Invalid</option><option value="protected">Protected</option><option value="unknown">Unknown</option></select></div></div></CardHeader>
      <CardContent className="space-y-4">{rows.isPending ? <p className="text-muted-foreground">Loading row outcomes...</p> : rows.error ? <Alert variant="danger"><AlertTitle>Row outcomes unavailable</AlertTitle><AlertDescription>{getPageApiError(rows.error, "Try again.")}</AlertDescription></Alert> : rows.data?.items.length ? <><DataTableContainer><DataTable className="min-w-[900px]"><DataTableHeader><DataTableRow><DataTableHead>Source row</DataTableHead><DataTableHead>Preview</DataTableHead><DataTableHead>Selection</DataTableHead><DataTableHead>Commit</DataTableHead><DataTableHead>Retry</DataTableHead><DataTableHead>Identifier</DataTableHead><DataTableHead>Explanation</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{rows.data.items.map((row: any) => <DataTableRow key={row.stable_row_reference}><DataTableCell>{row.source_row_number ?? "Unknown"}</DataTableCell><DataTableCell><Badge variant="secondary">{label(row.preview_classification)}</Badge></DataTableCell><DataTableCell>{label(row.selection_state)}</DataTableCell><DataTableCell>{label(row.commit_outcome)}</DataTableCell><DataTableCell>{label(row.retry_outcome)}</DataTableCell><DataTableCell className="font-mono">{row.masked_identifier || "Unknown"}</DataTableCell><DataTableCell className="max-w-md"><p>{row.explanation}</p><p className="mt-1 text-xs text-muted-foreground">{row.recommended_action}</p></DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer><div className="flex items-center justify-between"><Button variant="outline" disabled={rowPage <= 1} onClick={() => setRowPage((value) => value - 1)}>Previous</Button><span className="text-sm font-bold">Page {rows.data.page} of {Math.max(rows.data.pages, 1)}</span><Button variant="outline" disabled={rowPage >= rows.data.pages} onClick={() => setRowPage((value) => value + 1)}>Next</Button></div></> : <p className="rounded-xl bg-surface-muted p-6 text-center text-muted-foreground">No row evidence matches this filter.</p>}</CardContent>
    </Card>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Related Conflicts</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{number(item.unresolved_total)} rows remain unresolved. Resolution always uses the current canonical workflow.</p><Link to="/upload" className={buttonVariants({ variant: "outline" })}><History className="size-4" />Open Needs Attention</Link></CardContent></Card>
      <Card><CardHeader><CardTitle>Export Evidence</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Downloads are sanitized and exclude original files, raw private audit metadata, full paths, and unmasked identifiers.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(downloading)} onClick={() => download("csv")}>{downloading === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}CSV evidence</Button><Button variant="outline" disabled={Boolean(downloading)} onClick={() => download("json")}>{downloading === "json" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}JSON evidence</Button></div></CardContent></Card>
    </div>
  </div>;
}

export function UploadHistoryPanel() {
  const [page, setPage] = useState(1);
  const [workflow, setWorkflow] = useState("");
  const [reconciliation, setReconciliation] = useState("");
  const [filename, setFilename] = useState("");
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selected, setSelected] = useState("");
  const history = useQuery({
    queryKey: ["upload-history", page, workflow, reconciliation, filename, unresolvedOnly],
    queryFn: () => getUploadHistory({ page, page_size: 20, workflow_type: workflow || undefined, reconciliation_state: reconciliation || undefined, filename: filename || undefined, unresolved_only: unresolvedOnly }),
  });

  if (selected) return <HistoryDetail uploadId={selected} onBack={() => setSelected("")} />;

  return <div className="space-y-5">
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Upload History</CardTitle><p className="mt-1 text-sm text-muted-foreground">Reconcile attendance and roster previews, commits, conflicts, retries, and rollback evidence.</p></div><Badge variant="secondary"><FileClock className="mr-1 size-3.5" />Read-only evidence</Badge></div></CardHeader>
      <CardContent><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); setPage(1); history.refetch(); }}><div className="lg:col-span-2"><Label htmlFor="history-filename">Filename</Label><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input id="history-filename" className="pl-9" maxLength={100} value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="Search safe filename" /></div></div><div><Label htmlFor="history-workflow">Workflow</Label><select id="history-workflow" className="min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" value={workflow} onChange={(event) => { setWorkflow(event.target.value); setPage(1); }}><option value="">All workflows</option><option value="ATTENDANCE">Attendance</option><option value="ROSTER">Roster</option></select></div><div><Label htmlFor="history-reconciliation">Reconciliation</Label><select id="history-reconciliation" className="min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" value={reconciliation} onChange={(event) => { setReconciliation(event.target.value); setPage(1); }}><option value="">All states</option><option value="BALANCED">Balanced</option><option value="BALANCED_WITH_UNRESOLVED">Balanced with unresolved</option><option value="INCOMPLETE">Incomplete</option><option value="INCONSISTENT">Inconsistent</option><option value="UNKNOWN">Unknown</option></select></div><div className="flex items-end gap-2"><Button type="submit" variant="outline"><Filter className="size-4" />Apply</Button></div><label className="flex min-h-10 items-center gap-2 text-sm font-bold sm:col-span-2"><input type="checkbox" checked={unresolvedOnly} onChange={(event) => { setUnresolvedOnly(event.target.checked); setPage(1); }} />Unresolved uploads only</label></form></CardContent>
    </Card>

    {history.isPending ? <Card><CardContent className="flex min-h-52 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-5 animate-spin" />Loading upload history...</CardContent></Card> : history.error ? <Alert variant="danger"><AlertCircle className="size-4" /><AlertTitle>Upload history could not be loaded</AlertTitle><AlertDescription>{getPageApiError(history.error, "Refresh and try again.")}</AlertDescription></Alert> : history.data?.items.length ? <>
      <div className="grid gap-4">
        {history.data.items.map((item: UploadRecord) => <button key={item.upload_id} type="button" onClick={() => setSelected(item.upload_id)} className="rounded-2xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-surface)] transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={item.workflow_type === "ATTENDANCE" ? "information" : "secondary"}>{item.workflow_type}</Badge><Badge>{label(item.status)}</Badge><Badge variant={reconciliationVariant(item.reconciliation_state) as any}>{label(item.reconciliation_state)}</Badge></div><h3 className="mt-3 break-all text-lg font-black">{item.source_filename}</h3><p className="mt-1 text-sm text-muted-foreground">{dateTime(item.latest_activity_at)} · {item.actor} · checksum {item.checksum_prefix}</p></div><Clock3 className="size-5 text-muted-foreground" /></div><dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"><div><dt className="text-xs text-muted-foreground">Preview</dt><dd className="font-black">{number(item.preview_total)}</dd></div><div><dt className="text-xs text-muted-foreground">Selected</dt><dd className="font-black">{number(item.selected_total)}</dd></div><div><dt className="text-xs text-muted-foreground">Committed</dt><dd className="font-black">{number(item.committed_total)}</dd></div><div><dt className="text-xs text-muted-foreground">Unresolved</dt><dd className="font-black">{number(item.unresolved_total)}</dd></div><div><dt className="text-xs text-muted-foreground">Retry attempts</dt><dd className="font-black">{number(item.retry_attempt_count)}</dd></div><div><dt className="text-xs text-muted-foreground">Retry committed</dt><dd className="font-black">{number(item.retry_committed_total)}</dd></div></dl>{item.reconciliation_messages.length > 0 && <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-950"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{item.reconciliation_messages[0]}</p>}</button>)}
      </div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><p className="text-sm font-bold">Page {history.data.page} of {Math.max(history.data.pages, 1)} · {history.data.total} uploads</p><Button variant="outline" disabled={page >= history.data.pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </> : <Card><CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-muted-foreground"><CheckCircle2 className="size-7" /><p className="font-bold">No upload evidence matches these filters.</p><p className="text-sm">New attendance and roster previews will appear here automatically.</p></CardContent></Card>}
  </div>;
}
