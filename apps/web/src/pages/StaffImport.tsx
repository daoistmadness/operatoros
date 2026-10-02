import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { commitStaffImport, fetchStaffImportHistory, previewStaffImport, type StaffImportPreview } from "../api/staff";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { NativeSelect } from "../components/ui/native-select";
import { getPageApiError } from "../lib/api/errors";
import { queryKeys } from "../lib/query/queryKeys";

type RowFilter = "ALL" | "NEW" | "UPDATE_AVAILABLE" | "WARNING" | "ERROR" | "DUPLICATE" | "UNCHANGED";
const filters: Array<[RowFilter, string]> = [["ALL", "All rows"], ["NEW", "New"], ["UPDATE_AVAILABLE", "Updates"], ["WARNING", "Warnings"], ["ERROR", "Errors"], ["DUPLICATE", "Duplicates"], ["UNCHANGED", "Unchanged"]];
const canCommit = (state: string) => ["NEW", "UPDATE_AVAILABLE", "WARNING", "UNCHANGED"].includes(state);

export default function StaffImport() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [filter, setFilter] = useState<RowFilter>("ALL");
  const history = useQuery({ queryKey: queryKeys.staff.importHistory, queryFn: fetchStaffImportHistory, enabled: can("view_staff_audit") });
  const previewMutation = useMutation({ mutationFn: previewStaffImport, onSuccess: async (data) => { setPreview(data); await client.invalidateQueries({ queryKey: queryKeys.staff.importHistory }); } });
  const commitMutation = useMutation({
    mutationFn: () => commitStaffImport(preview!.batch_id, preview!.rows.filter((row) => canCommit(row.state)).map((row) => row.row_number)),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.staff.lists }), client.invalidateQueries({ queryKey: queryKeys.staff.analytics() }), client.invalidateQueries({ queryKey: queryKeys.staff.importHistory })]); },
  });
  const rows = useMemo(() => (preview?.rows ?? []).filter((row) => {
    if (filter === "ALL") return true;
    if (filter === "ERROR") return row.issues.some((issue) => issue.severity === "ERROR");
    if (filter === "DUPLICATE") return row.issues.some((issue) => issue.code.startsWith("DUPLICATE_") || issue.code === "POSSIBLE_DUPLICATE_PERSON");
    if (filter === "WARNING") return row.issues.some((issue) => issue.severity === "WARNING");
    return row.state === filter;
  }), [filter, preview]);
  const readFile = (selected: File | null) => { setFile(selected); setPreview(null); previewMutation.reset(); commitMutation.reset(); };
  const startPreview = () => { if (file) previewMutation.mutate(file); };
  const readyRows = preview?.rows.filter((row) => canCommit(row.state)).length ?? 0;
  if (!can("import_staff")) return <ErrorState title="Employee import unavailable" description="Your account cannot import employee records." />;
  return <div className="space-y-6">
    <Link to="/staff" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="size-4" />Back to Employees</Link>
    <PageHeader eyebrow="Employee management" title="Import employees" description="Preview validates the Edelweiss worksheet and stages the source rows. Employee records change only after you commit the accepted rows." />
    <Card><CardHeader><CardTitle>1. Choose the workbook</CardTitle><p className="text-sm text-muted-foreground">XLSX only. The worksheet must be named “Data Karyawan Edelweiss” and include the employee source columns.</p></CardHeader><CardContent className="flex flex-wrap items-center gap-3">
      <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold hover:bg-surface-muted"><Upload className="size-4" aria-hidden="true" />Choose XLSX<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => readFile(event.target.files?.[0] ?? null)} /></label>
      <span className="text-sm">{file?.name ?? "No file selected"}</span><Button onClick={startPreview} disabled={!file || previewMutation.isPending}>{previewMutation.isPending ? "Validating…" : "Preview import"}</Button>
      {previewMutation.isPending && <span role="status" className="text-sm">Workbook validation is running.</span>}
      {previewMutation.error && <p role="alert" className="w-full text-sm text-rose-700">{getPageApiError(previewMutation.error, "The workbook could not be previewed.")}</p>}
    </CardContent></Card>
    {preview && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Import preview summary">
        {[["Rows", preview.summary.total], ["Valid", preview.summary.valid], ["New", preview.summary.new], ["Updates", preview.summary.updates], ["Warnings", preview.summary.warnings], ["Errors / conflicts", preview.summary.invalid + preview.summary.conflicts]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs font-black uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle>2. Review staged rows</CardTitle><p className="text-sm text-muted-foreground">Age and tenure columns are ignored. Blank incoming values do not clear saved profile data. Identifier conflicts require a corrected source or manual review.</p></CardHeader><CardContent className="space-y-4">
        <div><p className="text-sm font-bold">Detected column mapping</p><dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(preview.column_mapping).map(([source, target]) => <div key={source} className="rounded-md bg-surface-muted px-3 py-2 text-sm"><dt className="font-semibold">{source}</dt><dd className="text-muted-foreground">{target === "IGNORED_DERIVED" ? "Ignored derived value" : target.replaceAll("_", " ")}</dd></div>)}</dl></div>
        <div className="flex flex-wrap items-end gap-3"><div><label htmlFor="import-row-filter" className="mb-1 block text-sm font-bold">Show</label><NativeSelect id="import-row-filter" value={filter} onChange={(event) => setFilter(event.target.value as RowFilter)}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></div><span className="pb-2 text-sm text-muted-foreground">{rows.length} rows shown · {readyRows} rows may be committed.</span></div>
        {rows.length === 0 ? <EmptyState title="No rows in this category" description="Choose another filter to review more of the preview." /> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[780px] text-left text-sm"><caption className="sr-only">Employee import validation preview</caption><thead className="bg-surface-muted"><tr>{["Source row", "Employee", "NIP", "State", "Review messages"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-black">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.row_number} className="border-t border-border align-top"><th scope="row" className="px-3 py-3">{row.row_number}</th><td className="px-3 py-3 font-semibold">{row.full_name || "(name missing)"}</td><td className="px-3 py-3 font-mono">{row.employee_code_masked ?? "—"}</td><td className="px-3 py-3">{row.state.replaceAll("_", " ")}</td><td className="px-3 py-3">{row.issues.length ? <ul className="space-y-1">{row.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.severity === "ERROR" ? "text-rose-700" : issue.severity === "WARNING" ? "text-amber-800" : "text-muted-foreground"}>{issue.message}</li>)}</ul> : "—"}</td></tr>)}</tbody></table></div>}
        <div className="flex flex-wrap items-center gap-3"><Button onClick={() => commitMutation.mutate()} disabled={!readyRows || commitMutation.isPending}>{commitMutation.isPending ? "Committing…" : `Commit ${readyRows} accepted rows`}</Button>{commitMutation.isPending && <span role="status" className="text-sm">Saving employees…</span>}{commitMutation.error && <p role="alert" className="text-sm text-rose-700">{getPageApiError(commitMutation.error, "The import could not be committed. No partial changes were applied.")}</p>}</div>
        {commitMutation.data && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p>Import applied: {commitMutation.data.summary.inserted} inserted, {commitMutation.data.summary.updated} updated, {commitMutation.data.summary.unchanged} unchanged, {commitMutation.data.summary.rejected} rejected, {commitMutation.data.summary.failed} require a new preview.</p>{commitMutation.data.failed_rows.length > 0 && <ul className="mt-2 list-inside list-disc">{commitMutation.data.failed_rows.map((item) => <li key={`${item.row_number}-${item.code}`}>Row {item.row_number}: {item.code.replaceAll("_", " ")}. Run preview again.</li>)}</ul>}</div>}
      </CardContent></Card>
    </>}
    {can("view_staff_audit") && <Card><CardHeader><CardTitle>Recent import history</CardTitle><p className="text-sm text-muted-foreground">Only batch metadata is retained after a successful import; staged personal data is cleared within 30 days.</p></CardHeader><CardContent>{history.isPending ? <LoadingState title="Loading import history" /> : history.isError ? <ErrorState title="Import history unavailable" description={history.error.message} /> : !history.data?.length ? <EmptyState title="No import history" description="Employee workbook previews and commits will appear here." /> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">Recent employee import batches</caption><thead><tr><th scope="col" className="px-2 py-2">Workbook</th><th scope="col" className="px-2 py-2">Date</th><th scope="col" className="px-2 py-2">Rows</th><th scope="col" className="px-2 py-2">Issues</th><th scope="col" className="px-2 py-2">Status</th></tr></thead><tbody>{history.data.map((batch) => <tr key={batch.id} className="border-t border-border"><th scope="row" className="px-2 py-2 font-semibold">{batch.source_filename}</th><td className="px-2 py-2">{batch.imported_at}</td><td className="px-2 py-2">{batch.total_rows}</td><td className="px-2 py-2">{batch.issue_count}</td><td className="px-2 py-2">{batch.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>}</CardContent></Card>}
  </div>;
}
