import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { fetchStaff } from "../api/staff";
import { PageHeader } from "../components/common/page-header";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";

export default function StaffManagement() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const staff = useQuery({ queryKey: ["staff", "list", { search, status }], queryFn: () => fetchStaff({ search: search || undefined, status: status || undefined, page: 1, page_size: 100 }) });
  return <div className="space-y-6">
    <PageHeader eyebrow="People and administration" title="Employee Directory" description="Review staff master records. Sensitive identifiers and contact details are excluded from the directory by default." />
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Label className="sr-only" htmlFor="staff-search">Search employees</Label><Input id="staff-search" className="pl-9" placeholder="Search name or staff code" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div><Label className="sr-only" htmlFor="staff-status">Employment status</Label><NativeSelect id="staff-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="FORMER">Former</option><option value="REVIEW_REQUIRED">Review required</option></NativeSelect></div>
    </CardContent></Card>
    {staff.isPending ? <LoadingState title="Loading employee directory" /> : staff.isError ? <ErrorState title="Employee directory unavailable" description={staff.error.message} /> : !staff.data?.items.length ? <EmptyState title="No staff records found" description="Adjust the filters or install the employee master extension." /> : <DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Name</DataTableHead><DataTableHead>Staff code</DataTableHead><DataTableHead>Job title</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Dapodik</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{staff.data.items.map((member) => <DataTableRow key={member.id}><DataTableCell className="font-black">{member.full_name}</DataTableCell><DataTableCell>{member.source_staff_id || "—"}</DataTableCell><DataTableCell>{member.job_title || "—"}</DataTableCell><DataTableCell><Badge variant={member.employment_status === "ACTIVE" ? "success" : member.employment_status === "FORMER" ? "secondary" : "warning"}>{member.employment_status.replaceAll("_", " ")}</Badge></DataTableCell><DataTableCell>{member.dapodik_status.replaceAll("_", " ")}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>}
  </div>;
  }
