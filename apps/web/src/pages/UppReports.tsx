import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History } from "lucide-react";
import type { UppReportSummaryDto, UppSubmissionStatusDto } from "@operatoros/contracts/upp-reports";
import { changeUppReportStatus, downloadUppEvidence, downloadUppReport, fetchUppReport, fetchUppReports, replaceUppReport, uploadUppReport } from "../api/uppReports";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { getPageApiError } from "../lib/api/errors";
import { queryKeys } from "../lib/query/queryKeys";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: UppReportSummaryDto["submission_status"]): string {
  return status === "NOT_UPLOADED" ? "Not uploaded" : status.replaceAll("_", " ").toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

function statusVariant(status: UppReportSummaryDto["submission_status"]): "secondary" | "success" | "information" | "warning" {
  if (status === "SUBMITTED") return "success";
  if (status === "READY_FOR_SUBMISSION") return "warning";
  if (status === "UPLOADED") return "information";
  return "secondary";
}

function ReportHistory({ reportId }: { reportId: number }) {
  const query = useQuery({ queryKey: queryKeys.uppReports.detail(reportId), queryFn: () => fetchUppReport(reportId) });
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading report history…</p>;
  if (query.isError) return <p role="alert" className="text-sm text-rose-700">{getPageApiError(query.error, "Report history could not be loaded.")}</p>;
  return <div className="space-y-4">
    <section aria-label="Workbook versions">
      <h3 className="font-bold">Workbook versions</h3>
      <ul className="mt-2 space-y-2">
        {query.data.versions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <span><span className="font-semibold">Version {version.version_number}</span> · {version.file_name} · {version.uploaded_at} · {version.uploaded_by}{version.active ? " · Active" : ""}</span>
          <Button type="button" size="sm" variant="outline" onClick={async () => saveBlob(await downloadUppReport(reportId, version.id), version.file_name)}><Download className="size-4" />Download</Button>
        </li>)}
      </ul>
    </section>
    <section aria-label="Submission evidence">
      <h3 className="font-bold">Submission evidence</h3>
      {query.data.evidence.length ? <ul className="mt-2 space-y-2">{query.data.evidence.map((evidence) => <li key={evidence.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
        <span>{evidence.file_name} · {evidence.uploaded_at} · {evidence.uploaded_by}</span>
        <Button type="button" size="sm" variant="outline" onClick={async () => saveBlob(await downloadUppEvidence(reportId, evidence.id), evidence.file_name)}><Download className="size-4" />Download evidence</Button>
      </li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No submission evidence is attached.</p>}
    </section>
    <section aria-label="Report history">
      <h3 className="font-bold">History</h3>
      <ol className="mt-2 space-y-2">{query.data.history.map((entry) => <li key={entry.id} className="rounded-lg border border-border p-3 text-sm">
        <span className="font-semibold">{entry.action.replaceAll("_", " ")}</span> · {entry.from_status ? `${statusLabel(entry.from_status)} → ` : ""}{statusLabel(entry.to_status)} · {entry.actor} · {entry.occurred_at}
        {entry.notes && <p className="mt-1 text-muted-foreground">{entry.notes}</p>}
      </li>)}</ol>
    </section>
  </div>;
}

function ReportRow({ item, month }: { item: UppReportSummaryDto; month: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [submissionNotes, setSubmissionNotes] = useState(item.submission_notes ?? "");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.uppReports.lists });
  const upload = useMutation({ mutationFn: () => { if (!file) throw new Error("Choose an XLSX workbook."); return uploadUppReport(item.school_unit_id, month, file, notes); }, onSuccess: async () => { setFile(null); setNotes(""); await invalidate(); } });
  const replace = useMutation({ mutationFn: () => { if (!file || item.id === null || !item.updated_at) throw new Error("Refresh the report and choose a workbook."); return replaceUppReport(item.id, item.updated_at, file, notes); }, onSuccess: async () => { setFile(null); setNotes(""); await invalidate(); } });
  const changeStatus = useMutation({ mutationFn: (status: UppSubmissionStatusDto) => {
    if (item.id === null || !item.updated_at) throw new Error("Refresh the report before changing submission status.");
    return changeUppReportStatus(item.id, { status, expected_updated_at: item.updated_at, submission_notes: submissionNotes.trim() || null }, status === "SUBMITTED" ? evidence ?? undefined : undefined);
  }, onSuccess: async () => { setEvidence(null); await invalidate(); if (item.id) await queryClient.invalidateQueries({ queryKey: queryKeys.uppReports.detail(item.id) }); } });
  const runDownload = async () => {
    if (item.id === null) return;
    setDownloadError(null);
    try { saveBlob(await downloadUppReport(item.id), item.file_name ?? `UPP-${month}.xlsx`); }
    catch (error) { setDownloadError(getPageApiError(error, "The workbook could not be downloaded.")); }
  };
  const mutationError = upload.error ?? replace.error ?? changeStatus.error;
  const errorText = mutationError ? getPageApiError(mutationError, "The report could not be updated.") : null;
  const fileLabelId = `upp-file-${item.school_unit_id}`;
  const notesId = `upp-notes-${item.school_unit_id}`;
  const submissionNotesId = `upp-submission-notes-${item.school_unit_id}`;
  const evidenceId = `upp-evidence-${item.school_unit_id}`;

  return <>
    <tr className="border-t border-border align-top">
      <th scope="row" className="px-3 py-3 text-left font-semibold">{item.school_unit_name}</th>
      <td className="px-3 py-3">{month}</td>
      <td className="px-3 py-3">{item.file_name ?? "—"}</td>
      <td className="px-3 py-3"><Badge variant={item.id === null ? "secondary" : "information"}>{item.id === null ? "Missing" : "Uploaded"}</Badge></td>
      <td className="px-3 py-3"><Badge variant={statusVariant(item.submission_status)}>{statusLabel(item.submission_status)}</Badge></td>
      <td className="px-3 py-3">{item.updated_at ?? item.uploaded_at ?? "—"}</td>
      <td className="min-w-64 px-3 py-3">
        <div className="grid gap-2">
          {item.id !== null && <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void runDownload()}><Download className="size-4" />Download active</Button>
            <Button type="button" size="sm" variant="outline" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}><History className="size-4" />{showHistory ? "Hide details" : "Details & history"}</Button>
          </div>}
          <>
            <Label htmlFor={fileLabelId}>{item.id === null ? "Upload monthly workbook" : "Replace active workbook"}</Label>
            <Input id={fileLabelId} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Label htmlFor={notesId}>Optional notes</Label>
            <Input id={notesId} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
            {item.id === null
              ? <Button type="button" size="sm" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? "Uploading…" : "Upload workbook"}</Button>
              : <Button type="button" size="sm" variant="outline" onClick={() => replace.mutate()} disabled={!file || !item.updated_at || replace.isPending}>{replace.isPending ? "Replacing…" : "Replace workbook"}</Button>}
          </>
          {item.submission_status === "UPLOADED" && item.id !== null && <Button type="button" size="sm" variant="outline" onClick={() => changeStatus.mutate("READY_FOR_SUBMISSION")} disabled={changeStatus.isPending}>Ready for submission</Button>}
          {item.submission_status === "READY_FOR_SUBMISSION" && item.id !== null && <>
            <Label htmlFor={submissionNotesId}>Submission notes</Label>
            <Textarea id={submissionNotesId} value={submissionNotes} onChange={(event) => setSubmissionNotes(event.target.value)} maxLength={2000} />
            <Label htmlFor={evidenceId}>Optional submission evidence</Label>
            <Input id={evidenceId} type="file" onChange={(event) => setEvidence(event.target.files?.[0] ?? null)} />
            <Button type="button" size="sm" onClick={() => changeStatus.mutate("SUBMITTED")} disabled={changeStatus.isPending}>{changeStatus.isPending ? "Saving…" : "Mark submitted"}</Button>
          </>}
          {errorText && <p role="alert" className="text-xs text-rose-700">{errorText}</p>}
          {downloadError && <p role="alert" className="text-xs text-rose-700">{downloadError}</p>}
        </div>
      </td>
    </tr>
    {showHistory && item.id !== null && <tr className="border-t border-border bg-surface-muted"><td colSpan={7} className="p-4"><ReportHistory reportId={item.id} /></td></tr>}
  </>;
}

export default function UppReports() {
  const [month, setMonth] = useState(currentMonth);
  const reports = useQuery({ queryKey: queryKeys.uppReports.list(month), queryFn: () => fetchUppReports(month) });
  if (reports.isPending) return <LoadingState title="Loading monthly reports" description="Loading school units and archive status." />;
  if (reports.isError) return <ErrorState title="Monthly reports could not be loaded" description={getPageApiError(reports.error, "Try again when the connection is available.")} />;

  const uploaded = reports.data.items.filter((item) => item.id !== null).length;
  const total = reports.data.items.length;
  return <div className="space-y-6">
    <PageHeader eyebrow="Administration" title="Monthly UPP Reports" description="Archive one manually completed XLSX workbook per school unit and reporting month. Uploading a workbook does not mark it as submitted." />
    <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(12rem,20rem)_1fr] sm:items-end">
      <div><Label htmlFor="upp-month">Reporting month</Label><Input id="upp-month" type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></div>
      <div aria-live="polite"><p className="font-semibold">Monthly archive completeness</p><p className="text-sm text-muted-foreground">{uploaded} of {total} school units have an uploaded workbook. {total - uploaded} are missing.</p><progress className="mt-2 h-2 w-full accent-brand" aria-label={`${uploaded} of ${total} school units have uploaded monthly workbooks`} max={Math.max(1, total)} value={uploaded} /></div>
    </CardContent></Card>
    {total === 0 ? <EmptyState title="No school units are available" description="Add an active school unit before archiving a monthly UPP workbook." /> : <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1100px] text-sm">
        <caption className="sr-only">Monthly UPP workbook archive for {month}</caption>
        <thead><tr className="bg-surface-muted text-left"><th scope="col" className="px-3 py-2">School unit</th><th scope="col" className="px-3 py-2">Period</th><th scope="col" className="px-3 py-2">Active file</th><th scope="col" className="px-3 py-2">Upload status</th><th scope="col" className="px-3 py-2">Submission status</th><th scope="col" className="px-3 py-2">Last updated</th><th scope="col" className="px-3 py-2">Actions</th></tr></thead>
        <tbody>{reports.data.items.map((item) => <ReportRow key={item.school_unit_id} item={item} month={month} />)}</tbody>
      </table>
    </div>}
  </div>;
}
