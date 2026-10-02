import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Search, UserRound } from "lucide-react";
import { downloadStaffExcel, fetchJenjangOptions, fetchStaff, fetchStaffAnalytics, fetchStaffPositions } from "../api/staff";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common/page-header";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { queryKeys } from "../lib/query/queryKeys";
import { getPageApiError } from "../lib/api/errors";

const statusLabels = { ACTIVE: "Active", FORMER: "Former", ALL: "All" } as const;
function serviceLabel(member: { service_years: number | null; service_months: number | null }) { return member.service_years === null ? "—" : `${member.service_years}y ${member.service_months || 0}m`; }
function saveBlob(blob: Blob, filename: string) { const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href); }

export default function StaffManagement() {
  const { can } = useAuth();
  const [url, setUrl] = useSearchParams();
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const status = url.get("employment_status") || "ACTIVE";
  const jobTitle = url.get("job_title") || "";
  const dapodik = url.get("dapodik_status") || "";
  const jenjangId = url.get("jenjang_id") || "";
  const nuptk = url.get("has_nuptk") || "";
  const positionId = url.get("position_id") || "";
  const joinedFrom = url.get("joined_from") || "";
  const joinedTo = url.get("joined_to") || "";
  const page = Math.max(1, Number(url.get("page") || "1"));
  const sortBy = url.get("sort_by") || "name";
  const sortDirection = url.get("sort_direction") || "asc";
  const filters = { search: search || undefined, status, job_title: jobTitle || undefined, position_id: positionId ? Number(positionId) : undefined, joined_from: joinedFrom || undefined, joined_to: joinedTo || undefined, dapodik_status: dapodik || undefined, jenjang_id: jenjangId ? Number(jenjangId) : undefined, has_nuptk: nuptk ? nuptk === "true" : undefined, page, page_size: 50, sort_by: sortBy, sort_direction: sortDirection as "asc" | "desc" };
  const staff = useQuery({ queryKey: queryKeys.staff.list(filters), queryFn: () => fetchStaff(filters) });
  const jenjangs = useQuery({ queryKey: queryKeys.academicMasters.jenjangs, queryFn: fetchJenjangOptions });
  const positions = useQuery({ queryKey: queryKeys.staff.positions("ALL"), queryFn: () => fetchStaffPositions("ALL") });
  const analytics = useQuery({ queryKey: queryKeys.staff.analytics(), queryFn: () => fetchStaffAnalytics(), enabled: can("view_staff_analytics") });
  const counts = staff.data?.counts || { ACTIVE: 0, FORMER: 0, ALL: 0 };
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(url); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); setUrl(next); };
  const exportWorkbook = async () => { setExporting(true); try { saveBlob(await downloadStaffExcel({ ...filters, status, include_sensitive: includeSensitive }), `employee-directory-${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (error) { window.alert(getPageApiError(error, "Employee export could not be downloaded.")); } finally { setExporting(false); } };
  return <div className="space-y-6">
    <PageHeader eyebrow="People and administration" title="Employees" description="Browse staff profiles, review employment history, and manage the employee source workbook." actions={<div className="flex flex-wrap items-center gap-2">{can("manage_staff") && <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" to="/staff/new">Add employee</Link>}{can("import_staff") && <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 py-2 text-sm font-bold" to="/staff/import">Import workbook</Link>}{can("view_staff_analytics") && <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 py-2 text-sm font-bold" to="/staff/analytics">Analytics</Link>}{can("export_sensitive_staff_fields") && <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={includeSensitive} onChange={(event) => setIncludeSensitive(event.target.checked)} />Include sensitive fields</label>}{can("export_staff") && <Button variant="outline" onClick={() => void exportWorkbook()} disabled={exporting}><Download className="size-4" />{exporting ? "Exporting…" : "Export XLSX"}</Button>}</div>} />
    {can("view_staff_analytics") && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Employee workforce indicators">
      {[...[ ["Employees", analytics.data?.workforce.total], ["Active", analytics.data?.workforce.active], ["Former", analytics.data?.workforce.former], ["Teaching", analytics.data?.workforce.teaching], ["Non-teaching", analytics.data?.workforce.non_teaching] ]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs font-black uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{analytics.isPending ? "…" : value ?? "Unavailable"}</p></CardContent></Card>)}
    </div>}
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Employment status filters">{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => <button key={key} type="button" aria-pressed={status === key} onClick={() => setFilter("employment_status", key === "ACTIVE" ? "" : key)} className={`rounded-2xl border p-4 text-left transition ${status === key ? "border-brand bg-brand/10 ring-2 ring-brand/20" : "border-border bg-surface hover:bg-surface-muted"}`}><span className="block text-xs font-black uppercase tracking-wide text-muted-foreground">{statusLabels[key]}</span><span className="mt-1 block text-2xl font-black text-foreground">{counts[key]}</span></button>)}</div>
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="relative lg:col-span-2"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Label className="sr-only" htmlFor="staff-search">Search employees</Label><Input id="staff-search" className="pl-9" placeholder="Search name, source ID, or NIP" value={search} onChange={(event) => { setSearch(event.target.value); setFilter("page", "1"); }} /></div>
      <div><Label className="sr-only" htmlFor="staff-jenjang">Jenjang</Label><NativeSelect id="staff-jenjang" value={jenjangId} onChange={(event) => setFilter("jenjang_id", event.target.value)}><option value="">All jenjang</option>{(jenjangs.data || []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div>
      <div><Label className="sr-only" htmlFor="staff-dapodik">DAPODIK status</Label><NativeSelect id="staff-dapodik" value={dapodik} onChange={(event) => setFilter("dapodik_status", event.target.value)}><option value="">All DAPODIK</option><option value="ACTIVE">Active</option><option value="NOT_REGISTERED">Not registered</option><option value="SUBMITTED_OR_COMPLETED">Submitted / completed</option><option value="UNKNOWN">Unknown</option></NativeSelect></div>
      <div><Label className="sr-only" htmlFor="staff-nuptk">NUPTK availability</Label><NativeSelect id="staff-nuptk" value={nuptk} onChange={(event) => setFilter("has_nuptk", event.target.value)}><option value="">Any NUPTK state</option><option value="true">Has NUPTK</option><option value="false">Missing NUPTK</option></NativeSelect></div>
      <div className="lg:col-span-2"><Label className="sr-only" htmlFor="staff-job-title">Position title</Label><Input id="staff-job-title" placeholder="Filter by position title" value={jobTitle} onChange={(event) => setFilter("job_title", event.target.value)} /></div>
      <div><Label className="sr-only" htmlFor="staff-position">Mapped position</Label><NativeSelect id="staff-position" value={positionId} onChange={(event) => setFilter("position_id", event.target.value)}><option value="">Any mapped position</option>{(positions.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.normalized_title}</option>)}</NativeSelect></div>
      <div><Label className="sr-only" htmlFor="staff-joined-from">Joined from</Label><Input id="staff-joined-from" type="date" aria-label="Joined from" value={joinedFrom} onChange={(event) => setFilter("joined_from", event.target.value)} /></div>
      <div><Label className="sr-only" htmlFor="staff-joined-to">Joined through</Label><Input id="staff-joined-to" type="date" aria-label="Joined through" value={joinedTo} onChange={(event) => setFilter("joined_to", event.target.value)} /></div>
      <div><Label className="sr-only" htmlFor="staff-sort">Sort by</Label><NativeSelect id="staff-sort" value={sortBy} onChange={(event) => setFilter("sort_by", event.target.value)}><option value="name">Name</option><option value="employee_code">Employee code</option><option value="start_date">Start date</option><option value="position">Position</option><option value="status">Status</option></NativeSelect></div>
      <div><Label className="sr-only" htmlFor="staff-sort-direction">Sort direction</Label><NativeSelect id="staff-sort-direction" value={sortDirection} onChange={(event) => setFilter("sort_direction", event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></NativeSelect></div>
    </CardContent></Card>
    {staff.isPending ? <LoadingState title="Loading employee directory" /> : staff.isError ? <ErrorState title="Employee directory unavailable" description={staff.error.message} /> : !staff.data?.items.length ? <EmptyState title={search || jobTitle ? "No employees match these filters" : "No employee records found"} description="Adjust the search or filters to see more records." /> : <>
      <DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Employee code</DataTableHead><DataTableHead>Name</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Jenjang</DataTableHead><DataTableHead>Position</DataTableHead><DataTableHead>NIP</DataTableHead><DataTableHead>NUPTK</DataTableHead><DataTableHead>DAPODIK</DataTableHead><DataTableHead>Start date</DataTableHead><DataTableHead>Tenure</DataTableHead><DataTableHead>Actions</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{staff.data.items.map((member) => <DataTableRow key={member.id}><DataTableCell><Link className="font-bold text-brand hover:underline" to={`/staff/${member.id}`}><UserRound className="mr-1 inline size-3" aria-hidden="true" />{member.source_staff_id || "—"}</Link></DataTableCell><DataTableCell className="font-black">{member.full_name}</DataTableCell><DataTableCell><Badge variant={member.employment_status === "ACTIVE" ? "success" : member.employment_status === "FORMER" ? "secondary" : "warning"}>{member.employment_status.replaceAll("_", " ")}</Badge></DataTableCell><DataTableCell><div className="flex flex-wrap gap-1">{member.jenjangs.length ? member.jenjangs.map((item) => <Badge key={item.id} variant="information">{item.name}</Badge>) : <span>—</span>}</div></DataTableCell><DataTableCell>{member.job_title || "—"}</DataTableCell><DataTableCell>{member.nip || "—"}</DataTableCell><DataTableCell>{member.has_nuptk ? "Available" : "Missing"}</DataTableCell><DataTableCell>{member.dapodik_status.replaceAll("_", " ")}</DataTableCell><DataTableCell>{member.employment_start_date || "—"}</DataTableCell><DataTableCell>{serviceLabel(member)}</DataTableCell><DataTableCell>{can("manage_staff") && <Link className="font-bold text-brand hover:underline" to={`/staff/${member.id}/edit`}>Edit</Link>}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>
      <nav className="flex items-center justify-between gap-3" aria-label="Employee list pages"><p className="text-sm text-muted-foreground">{staff.data.total} employees · Page {staff.data.page} of {Math.max(1, staff.data.total_pages)}</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>Previous</Button><Button variant="outline" disabled={page >= staff.data.total_pages} onClick={() => setFilter("page", String(page + 1))}>Next</Button></div></nav>
    </>}
  </div>;
}
