import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { applyMachineAttendance, previewMachineAttendance } from "../api/machineAttendancePreview";
import { isApiError, getPageApiError } from "../lib/api/errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const stateLabel: Record<string, string> = {
  SCAN_PRESENT: "Scan present", NO_SCAN: "No scan", MULTIPLE_SCANS: "Multiple scans", INVALID_SCAN_VALUE: "Invalid scan value", UNSUPPORTED_SOURCE_STATUS: "Unsupported source status",
  EXPECTED: "Expected", NOT_EXPECTED: "Not expected", UNKNOWN: "Expectation unknown",
  SCAN_EXPECTED: "Scan on expected date", NO_SCAN_EXPECTED: "No scan on expected date", NO_SCAN_NOT_EXPECTED: "No scan on non-school date",
  SCAN_NOT_EXPECTED: "Scan on non-school date", EXPECTATION_UNKNOWN: "Expectation unknown", INVALID_SCAN: "Invalid scan evidence",
  MATCHED: "Matched", UNMAPPED: "Unmapped", AMBIGUOUS: "Ambiguous", INVALID_IDENTIFIER: "Invalid identifier", INVALID_SOURCE_ROW: "Invalid source row",
  ELIGIBLE_CREATE: "Eligible to create", NOOP_ALREADY_CANONICAL: "Already canonical", CONFLICT_EXISTING_ATTENDANCE: "Existing attendance conflict", CONFLICT_EXISTING_OVERRIDE: "Existing override conflict",
  BLOCKED_NO_SCAN: "No scan", BLOCKED_MULTIPLE_SCANS_UNCLEAR: "Multiple scans need review", BLOCKED_INVALID_SCAN: "Invalid scan", BLOCKED_UNSUPPORTED_SOURCE_STATUS: "Unsupported source status", BLOCKED_UNMAPPED: "Unmapped", BLOCKED_AMBIGUOUS: "Ambiguous", BLOCKED_NO_ACTIVE_ENROLLMENT: "No active enrollment", BLOCKED_AMBIGUOUS_ENROLLMENT: "Ambiguous enrollment", BLOCKED_OUT_OF_SCOPE: "Out of scope", BLOCKED_CALENDAR_NOT_EXPECTED: "Calendar not expected", BLOCKED_CALENDAR_UNKNOWN: "Calendar unknown", BLOCKED_FUTURE_DATE: "Future date", BLOCKED_FINALIZED_PERIOD: "Finalized date", BLOCKED_INCOMPLETE_SCAN: "Incomplete scan", BLOCKED_INVALID_SOURCE_ROW: "Invalid source row",
};

function label(value: string): string { return stateLabel[value] ?? value.replaceAll("_", " "); }

export default function AttendanceMachineImportPreview() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const allowed = can("import_attendance");
  const filters = useAnalyticsFiltersQuery({}, allowed);
  const years = filters.data?.academic_years ?? [];
  const jenjangs = filters.data?.jenjangs ?? [];
  const [yearId, setYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const preview = useMutation({ mutationFn: ({ file: selected, year, jenjang, page: selectedPage }: { file: File; year: number; jenjang: number; page: number }) => previewMachineAttendance(selected, year, jenjang, selectedPage) });
  const apply = useMutation({ mutationFn: ({ file: selected, year, jenjang, digest }: { file: File; year: number; jenjang: number; digest: string }) => applyMachineAttendance(selected, year, jenjang, digest), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["attendance"] }); if (file && yearId && jenjangId) preview.mutate({ file, year: yearId, jenjang: jenjangId, page }); } });

  useEffect(() => { if (yearId === null && years.length) setYearId((years.find((value) => value.is_default) ?? years[0]).id); }, [yearId, years]);
  useEffect(() => { if (jenjangId === null && jenjangs.length) setJenjangId(jenjangs[0].id); }, [jenjangId, jenjangs]);

  if (!allowed) return <PermissionRestrictedState title="Access restricted" description="Your account cannot preview attendance-machine workbooks." />;
  if (filters.isPending) return <LoadingState title="Loading import scope" description="Preparing academic-year and jenjang choices." />;
  if (filters.error) return <ErrorState title="Import scope unavailable" description="The server could not load the academic scope." action={<Button onClick={() => void filters.refetch()}>Try again</Button>} />;
  if (!years.length || !jenjangs.length) return <SetupRequiredState title="Academic setup required" description="Add an academic year and active jenjang before previewing a machine workbook." />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file || yearId === null || jenjangId === null) return;
    preview.mutate({ file, year: yearId, jenjang: jenjangId, page });
  };
  const data = preview.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize)) : 1;
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="Attendance Operations" title="Machine Import Preview" description="Inspect scan evidence and calendar reconciliation before an explicit, controlled import. The browser never decides what may be written." />
    <Card><CardHeader><CardTitle>Preview only</CardTitle><p className="text-sm text-muted-foreground">No attendance, student, enrollment, calendar, deadline, or mapping records will be changed.</p><p className="text-sm text-muted-foreground">Students without machine scans are not automatically marked Alfa.</p></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-4 md:items-end" onSubmit={submit}>
      <div><FieldLabel htmlFor="machine-preview-file">Attendance-machine XLSX</FieldLabel><input id="machine-preview-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); preview.reset(); apply.reset(); setPage(1); }} className="block w-full text-sm" required /></div>
      <div><FieldLabel htmlFor="machine-preview-year">Academic year</FieldLabel><NativeSelect id="machine-preview-year" value={yearId ?? ""} onChange={(event) => { setYearId(Number(event.target.value) || null); preview.reset(); apply.reset(); setPage(1); }}>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="machine-preview-jenjang">Jenjang</FieldLabel><NativeSelect id="machine-preview-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(Number(event.target.value) || null); preview.reset(); apply.reset(); setPage(1); }}>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <Button type="submit" disabled={!file || preview.isPending}>{preview.isPending ? "Preparing preview…" : "Preview workbook"}</Button>
    </form>{preview.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{preview.error.message}</p>}</CardContent></Card>
    {preview.isPending && <LoadingState title="Preparing workbook preview" description="Parsing scan evidence and applying the selected calendar authority." />}
    {data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        ["Matched students", data.summary.matchedStudents], ["Unmapped identifiers", data.summary.unmappedStudents], ["Scan facts", data.summary.scanFacts], ["Eligible creates", data.summary.eligibleCreates], ["Already canonical", data.summary.alreadyCanonical], ["Conflicts", data.summary.conflicts], ["Blocked", data.summary.blocked], ["Expected dates without scan", data.summary.expectedNoScan],
      ].map(([title, value]) => <Card key={String(title)}><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle>Workbook recognized</CardTitle><p className="text-sm text-muted-foreground">{data.workbook.sheet} · {data.workbook.dimensions} · {data.workbook.sourceRows} source rows · {data.workbook.dateCoverage.from ?? "No dates"} to {data.workbook.dateCoverage.to ?? "No dates"}</p>{data.workbook.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700">{warning}</p>)}</CardHeader><CardContent>{data.rows.length === 0 ? <EmptyState title="No preview rows" description="The workbook contains no usable machine rows." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><caption className="sr-only">Machine attendance preview reconciliation and apply classification</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-2 py-3">Date</th><th scope="col" className="px-2 py-3">Student</th><th scope="col" className="px-2 py-3">Mapping</th><th scope="col" className="px-2 py-3">Machine evidence</th><th scope="col" className="px-2 py-3">Calendar</th><th scope="col" className="px-2 py-3">Reconciliation</th><th scope="col" className="px-2 py-3">Apply classification</th></tr></thead><tbody>{data.rows.map((item, index) => <tr key={`${item.machineStudentIdentifier ?? "invalid"}-${item.date ?? "row"}-${index}`} className="border-b border-border align-top"><th scope="row" className="px-2 py-3 text-left">{item.date ?? "Invalid date"}</th><td className="px-2 py-3"><span className="font-semibold">{item.student?.name ?? item.sourceStudentName ?? "Unknown student"}</span><span className="block text-xs text-muted-foreground">Machine ID: {item.machineStudentIdentifier ?? "Not recorded"}</span></td><td className="px-2 py-3">{label(item.matchingState)}</td><td className="px-2 py-3">{label(item.machineEvidence)}{item.scanTimes.length > 0 && <span className="block text-xs text-muted-foreground">{item.scanTimes.join(" · ")}</span>}</td><td className="px-2 py-3">{label(item.expectation.status)}{item.expectation.reason && <span className="block text-xs text-muted-foreground">{label(item.expectation.reason)}</span>}</td><td className="px-2 py-3">{label(item.reconciliationState)}{item.canonicalStatus && <span className="block text-xs text-muted-foreground">Canonical target: {label(item.canonicalStatus)}</span>}</td><td className="px-2 py-3 font-semibold">{label(item.applyClassification)}</td></tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between"><Button variant="outline" disabled={page <= 1 || preview.isPending || apply.isPending} onClick={() => { const next = page - 1; setPage(next); if (file && yearId && jenjangId) preview.mutate({ file, year: yearId, jenjang: jenjangId, page: next }); }}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount} · {data.pagination.total} logical rows</span><Button variant="outline" disabled={page >= pageCount || preview.isPending || apply.isPending} onClick={() => { const next = page + 1; setPage(next); if (file && yearId && jenjangId) preview.mutate({ file, year: yearId, jenjang: jenjangId, page: next }); }}>Next</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Explicit confirmation</CardTitle><p className="text-sm text-muted-foreground">Preview only until you confirm. Students without machine scans are not automatically marked Alfa.</p></CardHeader><CardContent><p className="text-sm">This import will create <strong>{data.summary.eligibleCreates}</strong> attendance records. Already canonical: <strong>{data.summary.alreadyCanonical}</strong>. Conflicts: <strong>{data.summary.conflicts}</strong>. Blocked: <strong>{data.summary.blocked}</strong>.</p><Button className="mt-4" disabled={!data.summary.eligibleCreates || apply.isPending || !file} onClick={() => { if (file && yearId && jenjangId) apply.mutate({ file, year: yearId, jenjang: jenjangId, digest: data.previewDigest }); }}>{apply.isPending ? "Applying…" : `Create ${data.summary.eligibleCreates} attendance records`}</Button>{apply.error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{isApiError(apply.error) && apply.error.code === "PREVIEW_STALE" ? "Attendance data changed after this preview. Review the updated preview before importing." : getPageApiError(apply.error, "The machine attendance import could not be applied.")}</p>}{apply.data && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">Import applied: {apply.data.summary.created} created, {apply.data.summary.alreadyCanonical} already canonical, {apply.data.summary.conflicts} conflicts, {apply.data.summary.blocked} blocked.</p>}</CardContent></Card>
    </>}
  </div>;
}
