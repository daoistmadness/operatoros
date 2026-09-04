import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Search, UserRound } from "lucide-react";
import { fetchJenjangOptions, fetchStaff } from "../api/staff";
import { PageHeader } from "../components/common/page-header";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { queryKeys } from "../lib/query/queryKeys";

const statusLabels = { ACTIVE: "Active", FORMER: "Former", ALL: "All" } as const;

function serviceLabel(member: { service_years: number | null; service_months: number | null; service_duration_status: string }) {
  if (member.service_duration_status !== "CALCULATED" || member.service_years === null) return "—";
  return `${member.service_years}y ${member.service_months || 0}m`;
}

export default function StaffManagement() {
  const [url, setUrl] = useSearchParams();
  const [search, setSearch] = useState("");
  const status = url.get("employment_status") || "ACTIVE";
  const jobTitle = url.get("job_title") || "";
  const dapodik = url.get("dapodik_status") || "";
  const jenjangId = url.get("jenjang_id") || "";
  const staff = useQuery({
    queryKey: ["staff", "list", { search, status, jobTitle, dapodik, jenjangId }],
    queryFn: () => fetchStaff({ search: search || undefined, status, job_title: jobTitle || undefined, dapodik_status: dapodik || undefined, jenjang_id: jenjangId ? Number(jenjangId) : undefined, page: 1, page_size: 100 }),
  });
  const jenjangs = useQuery({ queryKey: queryKeys.academicMasters.jenjangs, queryFn: fetchJenjangOptions });
  const counts = staff.data?.counts || { ACTIVE: 0, FORMER: 0, ALL: 0 };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(url);
    if (value) next.set(key, value); else next.delete(key);
    setUrl(next);
  };
  const exportParams = new URLSearchParams({ status });
  if (search) exportParams.set("search", search);
  if (jobTitle) exportParams.set("job_title", jobTitle);
  if (dapodik) exportParams.set("dapodik_status", dapodik);
  if (jenjangId) exportParams.set("jenjang_id", jenjangId);

  return <div className="space-y-6">
    <PageHeader eyebrow="People and administration" title="Employee Directory" description="Basic administrative and Dapodik records. This is not an HR or attendance system." actions={<a className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-bold hover:bg-surface-muted" href={`/api/staff/export?${exportParams.toString()}`}>Export CSV</a>} />
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Employment status filters">
      {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => <button key={key} type="button" aria-pressed={status === key} onClick={() => setFilter("employment_status", key === "ACTIVE" ? "" : key)} className={`rounded-2xl border p-4 text-left transition ${status === key ? "border-brand bg-brand/10 ring-2 ring-brand/20" : "border-border bg-surface hover:bg-surface-muted"}`}><span className="block text-xs font-black uppercase tracking-wide text-muted-foreground">{statusLabels[key]}</span><span className="mt-1 block text-2xl font-black text-foreground">{counts[key]}</span></button>)}
    </div>
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="relative lg:col-span-2"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Label className="sr-only" htmlFor="staff-search">Search employees</Label><Input id="staff-search" className="pl-9" placeholder="Search name, staff ID, NIP, or NUPTK" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div><Label className="sr-only" htmlFor="staff-jenjang">Jenjang</Label><NativeSelect id="staff-jenjang" value={jenjangId} onChange={(event) => setFilter("jenjang_id", event.target.value)}><option value="">All jenjang</option>{(jenjangs.data || []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div>
      <div><Label className="sr-only" htmlFor="staff-dapodik">Dapodik status</Label><NativeSelect id="staff-dapodik" value={dapodik} onChange={(event) => setFilter("dapodik_status", event.target.value)}><option value="">All Dapodik</option><option value="ACTIVE">Active</option><option value="NOT_REGISTERED">Not registered</option><option value="SUBMITTED_OR_COMPLETED">Submitted / completed</option><option value="UNKNOWN">Unknown</option></NativeSelect></div>
      <div className="lg:col-span-4"><Label className="sr-only" htmlFor="staff-job-title">Job title</Label><Input id="staff-job-title" placeholder="Filter by job title" value={jobTitle} onChange={(event) => setFilter("job_title", event.target.value)} /></div>
    </CardContent></Card>
    {staff.isPending ? <LoadingState title="Loading employee directory" /> : staff.isError ? <ErrorState title="Employee directory unavailable" description={staff.error.message} /> : !staff.data?.items.length ? <EmptyState title="No staff records found" description="Adjust the filters or install the employee master extension." /> : <DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Staff ID</DataTableHead><DataTableHead>Name</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Jenjang</DataTableHead><DataTableHead>Job title</DataTableHead><DataTableHead>NIP</DataTableHead><DataTableHead>NUPTK</DataTableHead><DataTableHead>Dapodik</DataTableHead><DataTableHead>Age</DataTableHead><DataTableHead>Service</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{staff.data.items.map((member) => <DataTableRow key={member.id}><DataTableCell><Link className="font-bold text-brand hover:underline" to={`/staff/${member.id}`}><UserRound className="mr-1 inline size-3" aria-hidden="true" />{member.source_staff_id || "—"}</Link></DataTableCell><DataTableCell className="font-black">{member.full_name}</DataTableCell><DataTableCell><Badge variant={member.employment_status === "ACTIVE" ? "success" : member.employment_status === "FORMER" ? "secondary" : "warning"}>{member.employment_status.replaceAll("_", " ")}</Badge></DataTableCell><DataTableCell><div className="flex flex-wrap gap-1">{member.jenjangs.length ? member.jenjangs.map((item) => <Badge key={item.id} variant="information">{item.name}</Badge>) : <span>—</span>}</div></DataTableCell><DataTableCell>{member.job_title || "—"}</DataTableCell><DataTableCell>{member.nip || "—"}</DataTableCell><DataTableCell>{member.nuptk || "—"}</DataTableCell><DataTableCell>{member.dapodik_status.replaceAll("_", " ")}</DataTableCell><DataTableCell>{member.age_years === null ? "—" : `${member.age_years}y`}</DataTableCell><DataTableCell>{serviceLabel(member)}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>}
  </div>;
}
