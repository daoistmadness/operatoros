import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, RefreshCw } from "lucide-react";
import type { StaffMonthlyActivityItemDto, StaffMonthlyActivityStatusDto } from "@operatoros/contracts/staff";
import { downloadStaffMonthlyActivities, fetchStaffMonthlyActivities, fetchStaffMonthlyActivityHistory, fetchStaffMonthlyActivitySummary, generateStaffMonthlyActivities, updateStaffMonthlyActivity } from "../api/staffMonthlyActivities";
import { fetchSchoolUnits } from "../api/staff";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { getPageApiError, isApiError } from "../lib/api/errors";
import { queryKeys } from "../lib/query/queryKeys";

const statusOptions: Array<{ value: "ALL" | StaffMonthlyActivityStatusDto; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "NEEDS_CORRECTION", label: "Needs correction" },
  { value: "NOT_APPLICABLE", label: "Not applicable" },
];

function jakartaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function currentMonth(): string { return jakartaDate().slice(0, 7); }

function offsetMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }: { status: StaffMonthlyActivityStatusDto }) {
  const variant = status === "COMPLETED" ? "success" : status === "NEEDS_CORRECTION" ? "warning" : status === "NOT_APPLICABLE" ? "secondary" : "information";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

function ActivityHistory({ activityId }: { activityId: number }) {
  const history = useQuery({ queryKey: queryKeys.staff.monthlyActivities.history(activityId), queryFn: () => fetchStaffMonthlyActivityHistory(activityId) });
  if (history.isPending) return <p role="status" className="mt-2 text-sm text-muted-foreground">Loading activity history…</p>;
  if (history.isError) return <p role="alert" className="mt-2 text-sm text-rose-700">Activity history could not be loaded.</p>;
  return history.data.items.length ? <ol className="mt-2 space-y-2">{history.data.items.map((entry) => <li key={entry.version} className="rounded-lg bg-surface-muted p-3 text-sm"><p className="font-semibold">{entry.from_status ? `${entry.from_status.replaceAll("_", " ")} → ` : "Generated as "}{entry.to_status.replaceAll("_", " ")} · {entry.actor} · {entry.occurred_at}</p>{entry.to_confirmation_date && <p>Confirmation date: {entry.to_confirmation_date}</p>}{entry.to_processing_notes && <p>Notes: {entry.to_processing_notes}</p>}{entry.reason && <p>Reason: {entry.reason}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No history is available.</p>;
}

function ActivityRow({ item, editable }: { item: StaffMonthlyActivityItemDto; editable: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(item.status);
  const [confirmationDate, setConfirmationDate] = useState(item.confirmation_date ?? jakartaDate());
  const [notes, setNotes] = useState(item.processing_notes ?? "");
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const mutation = useMutation({
    mutationFn: () => updateStaffMonthlyActivity(item.id, {
      expected_version: item.version,
      status,
      ...(status === "COMPLETED" ? { confirmation_date: confirmationDate } : {}),
      processing_notes: notes.trim() || null,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.listForMonth(item.month) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.summaries }),
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.history(item.id) }),
      ]);
    },
  });
  useEffect(() => {
    setStatus(item.status);
    setConfirmationDate(item.confirmation_date ?? jakartaDate());
    setNotes(item.processing_notes ?? "");
    setReason("");
  }, [item.version, item.status, item.confirmation_date, item.processing_notes]);

  const needsReason = item.status !== "PENDING" || status === "NEEDS_CORRECTION" || status === "NOT_APPLICABLE";
  const changed = status !== item.status || notes.trim() !== (item.processing_notes ?? "") || status === "COMPLETED" && confirmationDate !== item.confirmation_date;
  const conflict = isApiError(mutation.error) && mutation.error.status === 409;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.listForMonth(item.month) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.history(item.id) }),
  ]);

  return <tr className="border-t border-border align-top">
    <th scope="row" className="px-3 py-3 text-left"><span className="font-bold">{item.staff_name}</span><span className="block text-xs font-normal text-muted-foreground">{item.staff_code || item.staff_member_id}</span></th>
    <td className="px-3 py-3">{item.school_unit_name}</td>
    <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
    <td className="px-3 py-3">{editable ? <div className="grid min-w-64 gap-2">
      <Label className="sr-only" htmlFor={`ptk-status-${item.id}`}>Status for {item.staff_name}</Label>
      <NativeSelect id={`ptk-status-${item.id}`} value={status} onChange={(event) => setStatus(event.target.value as StaffMonthlyActivityStatusDto)} disabled={mutation.isPending}>
        {statusOptions.filter((option) => option.value !== "ALL").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
      {status === "COMPLETED" && <><Label className="sr-only" htmlFor={`ptk-confirmation-${item.id}`}>Confirmation date for {item.staff_name}</Label><Input id={`ptk-confirmation-${item.id}`} type="date" value={confirmationDate} onChange={(event) => setConfirmationDate(event.target.value)} disabled={mutation.isPending} /></>}
      <Label className="sr-only" htmlFor={`ptk-notes-${item.id}`}>Processing notes for {item.staff_name}</Label>
      <Input id={`ptk-notes-${item.id}`} placeholder="Processing notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={mutation.isPending} />
      {needsReason && <><Label className="sr-only" htmlFor={`ptk-reason-${item.id}`}>Correction reason for {item.staff_name}</Label><Input id={`ptk-reason-${item.id}`} placeholder="Reason for this correction" value={reason} onChange={(event) => setReason(event.target.value)} disabled={mutation.isPending} /></>}
      <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending || !changed || needsReason && !reason.trim() || status === "COMPLETED" && !confirmationDate}>{mutation.isPending ? "Saving…" : "Save activity"}</Button>
      {mutation.error && <p role="alert" className="text-xs text-rose-700">{getPageApiError(mutation.error, "Monthly PTK activity could not be saved.")}</p>}
      {conflict && <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="size-3" />Reload current activity</Button>}
    </div> : <span className="text-sm text-muted-foreground">Management permission required to update.</span>}</td>
    <td className="px-3 py-3"><Button size="sm" variant="outline" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}><History className="size-4" />{showHistory ? "Hide history" : "History"}</Button>{showHistory && <div className="min-w-72"> <ActivityHistory activityId={item.id} /></div>}</td>
  </tr>;
}

export default function StaffMonthlyActivities() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [schoolUnit, setSchoolUnit] = useState("");
  const [status, setStatus] = useState<"ALL" | StaffMonthlyActivityStatusDto>("ALL");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const mayView = can("view_staff_analytics");
  const mayManage = can("manage_staff");
  const mayExport = can("export_staff");
  const schoolUnitId = schoolUnit ? Number(schoolUnit) : undefined;
  const filters = { month, school_unit_id: schoolUnitId, status: status === "ALL" ? undefined : status };
  const summaryFilters = { from_month: offsetMonth(month, -5), to_month: month, school_unit_id: schoolUnitId };
  const activities = useQuery({ queryKey: queryKeys.staff.monthlyActivities.list(filters), queryFn: () => fetchStaffMonthlyActivities(filters), enabled: mayView });
  const summary = useQuery({ queryKey: queryKeys.staff.monthlyActivities.summary(summaryFilters), queryFn: () => fetchStaffMonthlyActivitySummary(summaryFilters), enabled: mayView });
  const units = useQuery({ queryKey: queryKeys.staff.schoolUnits, queryFn: fetchSchoolUnits, enabled: mayView });
  const invalidateMonth = async (reportingMonth: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.listForMonth(reportingMonth) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.monthlyActivities.summaries }),
  ]);
  const generate = useMutation({ mutationFn: () => generateStaffMonthlyActivities(month), onSuccess: () => invalidateMonth(month) });

  const exportActivity = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    setExportError(null);
    try {
      saveBlob(await downloadStaffMonthlyActivities({ ...filters, format }), `staff-monthly-activity-${month}.${format}`);
    } catch (error) {
      setExportError(getPageApiError(error, "Monthly PTK activity export could not be downloaded."));
    } finally {
      setExporting(null);
    }
  };

  if (!mayView) return <PermissionRestrictedState title="Monthly PTK activity is restricted" description="Your account cannot view staff activity reporting." />;
  if (activities.isPending || summary.isPending || units.isPending) return <LoadingState title="Loading monthly PTK activity" />;
  if (activities.isError || summary.isError || units.isError || !activities.data || !summary.data || !units.data) return <ErrorState title="Monthly PTK activity unavailable" description={activities.error?.message ?? summary.error?.message ?? units.error?.message} />;
  const data = activities.data;
  const totals = data.summary;

  return <div className="space-y-6">
    <PageHeader eyebrow="Staff administration" title="Monthly PTK activity" description="Track the operator’s monthly confirmation that required external DAPODIK processing was completed. OperatorOS does not synchronize with DAPODIK." actions={<div className="flex flex-wrap gap-2">{mayExport && <><Button variant="outline" onClick={() => void exportActivity("xlsx")} disabled={exporting !== null}><Download className="size-4" />{exporting === "xlsx" ? "Exporting…" : "Export XLSX"}</Button><Button variant="outline" onClick={() => void exportActivity("pdf")} disabled={exporting !== null}><Download className="size-4" />{exporting === "pdf" ? "Exporting…" : "Export PDF"}</Button></>}</div>} />
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div><Label htmlFor="ptk-month">Reporting month</Label><Input id="ptk-month" type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></div>
      <div><Label htmlFor="ptk-school-unit">School unit</Label><NativeSelect id="ptk-school-unit" value={schoolUnit} onChange={(event) => setSchoolUnit(event.target.value)}><option value="">All units</option>{units.data.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.status === "INACTIVE" ? " (inactive)" : ""}</option>)}</NativeSelect></div>
      <div><Label htmlFor="ptk-status">Activity status</Label><NativeSelect id="ptk-status" value={status} onChange={(event) => setStatus(event.target.value as "ALL" | StaffMonthlyActivityStatusDto)}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></div>
      <div className="flex items-end">{mayManage && <Button className="w-full" onClick={() => generate.mutate()} disabled={generate.isPending || data.period.generated}>{generate.isPending ? "Generating…" : data.period.generated ? "Period generated" : "Generate monthly entries"}</Button>}</div>
      {generate.error && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{getPageApiError(generate.error, "Monthly PTK entries could not be generated.")}</p>}
      {exportError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{exportError}</p>}
    </CardContent></Card>
    <section aria-label="Monthly PTK completion summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[["Applicable PTK", totals.total_applicable], ["Completed", totals.completed], ["Pending", totals.pending], ["Needs correction", totals.needs_correction]].map(([label, count]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs font-bold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{count}</p></CardContent></Card>)}
      <Card><CardContent className="p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Completion</p><p className="mt-1 text-2xl font-black">{totals.completion_percentage === null ? "—" : `${totals.completion_percentage}%`}</p><p className="text-xs text-muted-foreground">Completed ÷ (Completed + Pending + Needs Correction); Not Applicable is excluded.</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Not applicable</p><p className="mt-1 text-2xl font-black">{totals.not_applicable}</p></CardContent></Card>
    </section>
    <Card><CardHeader><CardTitle>Activity entries · {month}</CardTitle><p className="text-sm text-muted-foreground">{data.period.generated ? `Generated ${data.period.generated_at ?? ""}${data.period.generated_by ? ` by ${data.period.generated_by}` : ""}.` : "No monthly snapshot has been generated."}</p></CardHeader><CardContent>
      {!data.period.generated ? <EmptyState title="Monthly entries have not been generated" description={mayManage ? "Generate a snapshot of staff with an applicable school-unit assignment for this month." : "An authorized operator must generate this month’s snapshot."} /> : !data.items.length ? <EmptyState title="No activities match these filters" description="Try another school unit or status." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><caption className="sr-only">Monthly PTK activities for {month}</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="px-3 py-2">Staff member</th><th scope="col" className="px-3 py-2">School unit</th><th scope="col" className="px-3 py-2">Current status</th><th scope="col" className="px-3 py-2">Update activity</th><th scope="col" className="px-3 py-2">History</th></tr></thead><tbody>{data.items.map((item) => <ActivityRow key={item.id} item={item} editable={mayManage} />)}</tbody></table></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Recent monthly completion</CardTitle><p className="text-sm text-muted-foreground">Historical entries use their saved month and unit assignments; changes to current staff assignments do not rewrite these totals.</p></CardHeader><CardContent>{summary.data.items.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Monthly PTK completion history for the previous six reporting months</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-2">Month</th><th scope="col" className="py-2">Applicable</th><th scope="col" className="py-2">Completed</th><th scope="col" className="py-2">Pending</th><th scope="col" className="py-2">Needs correction</th><th scope="col" className="py-2">Completion</th></tr></thead><tbody>{summary.data.items.map((item) => <tr key={item.month} className="border-t border-border"><th scope="row" className="py-2 text-left">{item.month}</th><td>{item.total_applicable}</td><td>{item.completed}</td><td>{item.pending}</td><td>{item.needs_correction}</td><td>{item.completion_percentage === null ? "—" : `${item.completion_percentage}%`}</td></tr>)}</tbody></table></div> : <EmptyState title="No historical activity yet" description="Generated monthly snapshots will appear here." />}</CardContent></Card>
  </div>;
}
