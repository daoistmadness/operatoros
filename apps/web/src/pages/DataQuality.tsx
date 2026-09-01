import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { FileSpreadsheet, Users, UserRound } from "lucide-react";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { NativeSelect } from "../components/ui/native-select";
import { FieldLabel } from "../components/ui/field";
import { ErrorState, LoadingState } from "../components/common/state-message";
import { useAuth } from "../context/AuthContext";
import { queryKeys } from "../lib/query/queryKeys";
import { createDownloadUrl, revokeDownloadUrl } from "../lib/api/client";
import { downloadStaffQualityExcel, downloadStudentQualityExcel, fetchDataQualityResolution, fetchStaffQuality, fetchStaffQualityIssues, fetchStudentQuality, fetchStudentQualityIssues } from "../api/dataQuality";
import type { DataQualityResolutionItem, DataQualityResolutionTarget } from "@operatoros/contracts/analytics";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const STUDENT_FIELDS = ["gender", "religion", "birth_date", "class_assignment"] as const;
const STAFF_FIELDS = ["education", "jenjang_assignment", "job_title"] as const;
const fieldLabels: Record<string, string> = {
  gender: "Gender", religion: "Religion", birth_date: "Birth date", class_assignment: "Class assignment",
  education: "Education", jenjang_assignment: "Jenjang assignment", job_title: "Job title",
  enrollment: "Enrollment", employment_status: "Employment status",
};
const issueTypeLabels: Record<string, string> = {
  MISSING_OPTIONAL_FIELD: "Missing optional field",
  MISSING_CLASS_ASSIGNMENT: "Missing class assignment",
  MISSING_ENROLLMENT: "No current enrollment",
  MISSING_STAFF_EDUCATION: "No education record",
  MISSING_STAFF_ASSIGNMENT: "No jenjang assignment",
  UNMAPPED_JOB_TITLE: "Job title not mapped",
  UNKNOWN_CATEGORY_VALUE: "Recorded as Unknown",
};

const resolutionLabels: Record<string, string> = {
  EDITABLE_IN_OPERATOROS: "Editable in OperatorOS",
  VIEW_ONLY_IN_OPERATOROS: "View only",
  EXTERNAL_SOURCE_REQUIRED: "External source required",
  UNSUPPORTED_CORRECTION: "No correction workflow",
};

const qualityStateLabels: Record<string, string> = { MISSING: "Missing", UNKNOWN: "Unknown", UNMAPPED: "Unmapped" };

function resolutionPath(target: DataQualityResolutionTarget): string {
  const id = encodeURIComponent(target.entityId);
  return target.type === "STAFF_PROFILE" ? `/staff/${id}` : `/students/${id}`;
}

function ResolutionWorkspace({ scope, can }: { scope: Record<string, string | undefined>; can: (capability: string) => boolean }) {
  const [qualityState, setQualityState] = useState("");
  const [resolutionClass, setResolutionClass] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filters = {
    ...scope,
    entity_type: "ALL",
    quality_state: qualityState || undefined,
    resolution_class: resolutionClass || undefined,
    search: search.trim() || undefined,
    page,
    page_size: 10,
  };
  const query = useQuery({
    queryKey: queryKeys.analytics.dataQualityResolution(filters),
    queryFn: () => fetchDataQualityResolution(filters),
    placeholderData: keepPreviousData,
  });
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (query.data?.pageSize ?? 10)));
  const reset = () => setPage(1);
  return <div className="space-y-4" aria-labelledby="data-quality-resolution-heading">
    <div><h2 id="data-quality-resolution-heading" className="text-xl font-black">Resolution workspace</h2><p className="text-sm text-muted-foreground">Derived findings with a controlled path to the canonical source. Corrected findings disappear after refresh.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <div><FieldLabel htmlFor="quality-resolution-search">Search entity or issue</FieldLabel><input id="quality-resolution-search" className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm" value={search} onChange={(event) => { setSearch(event.target.value); reset(); }} /></div>
      <div><FieldLabel htmlFor="quality-resolution-state">Quality state</FieldLabel><NativeSelect id="quality-resolution-state" value={qualityState} onChange={(event) => { setQualityState(event.target.value); reset(); }}><option value="">All states</option>{Object.entries(qualityStateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="quality-resolution-class">Resolution</FieldLabel><NativeSelect id="quality-resolution-class" value={resolutionClass} onChange={(event) => { setResolutionClass(event.target.value); reset(); }}><option value="">All resolutions</option>{Object.entries(resolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></div>
    </div>
    {query.isPending && <LoadingState title="Loading resolution findings" />}
    {query.isError && <ErrorState title="Resolution findings could not be loaded" description={query.error?.message} />}
    {query.data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {([["Issues", query.data.summary.totalIssues], ["Editable here", query.data.summary.editableIssues], ["View only", query.data.summary.viewOnlyIssues], ["External source", query.data.summary.externalIssues], ["No workflow", query.data.summary.unsupportedIssues]] as const).map(([label, value]) => <Card key={label}><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-black">{value}</CardContent></Card>)}
      </div>
      {query.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No data-quality issues found in this scope.</p> : <Card><CardHeader><CardTitle>Findings</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Data-quality resolution findings</caption><thead><tr className="border-b border-slate-200 text-left"><th scope="col" className="py-2 pr-4 font-black">Entity</th><th scope="col" className="py-2 pr-4 font-black">Field</th><th scope="col" className="py-2 pr-4 font-black">Issue</th><th scope="col" className="py-2 pr-4 font-black">Current value</th><th scope="col" className="py-2 pr-4 font-black">Resolution</th><th scope="col" className="py-2 pr-4 font-black">Action</th></tr></thead><tbody>{query.data.items.map((item) => <ResolutionRow key={item.issueKey} item={item} can={can} />)}</tbody></table></div><div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {query.data.page} of {pageCount} · {query.data.total} findings</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div></CardContent></Card>}
    </>}
  </div>;
}

function ResolutionRow({ item, can }: { item: DataQualityResolutionItem; can: (capability: string) => boolean }) {
  const target = item.resolutionTarget;
  const action = target && can(target.capability)
    ? <Link className="font-black text-brand hover:underline" to={resolutionPath(target)}>Fix source</Link>
    : <span className="text-muted-foreground">{item.resolutionClass === "EDITABLE_IN_OPERATOROS" ? "Permission required" : "No local edit"}</span>;
  return <tr className="border-b border-slate-100"><th scope="row" className="py-2 pr-4 text-left font-semibold">{item.entityLabel}<span className="block text-xs font-normal text-muted-foreground">{item.entityType} · {item.context}</span></th><td className="py-2 pr-4">{fieldLabels[item.field] ?? item.field}</td><td className="py-2 pr-4">{item.label}<span className="block text-xs text-muted-foreground">{qualityStateLabels[item.qualityState] ?? item.qualityState}</span></td><td className="py-2 pr-4">{item.currentValue ?? "Not recorded"}</td><td className="py-2 pr-4"><span>{resolutionLabels[item.resolutionClass] ?? item.resolutionClass}</span><span className="block text-xs text-muted-foreground">{item.resolutionNote}</span></td><td className="py-2 pr-4">{action}</td></tr>;
}

export default function DataQuality() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<"analytics" | "resolution">("analytics");
  const [tab, setTab] = useState<"students" | "staff">("students");
  const [studentStatus, setStudentStatus] = useState<string>("ACTIVE");
  const [staffEmploymentStatus, setStaffEmploymentStatus] = useState<string>("ACTIVE");
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [issuePage, setIssuePage] = useState<number>(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const scope = { academic_year_id: searchParams.get("academic_year_id") ?? undefined, jenjang_id: searchParams.get("jenjang_id") ?? undefined, class_id: searchParams.get("class_id") ?? undefined };
  const studentScope = { ...scope, status: studentStatus };
  const staffScope = { ...scope, employment_status: staffEmploymentStatus };
  const studentOverview = useQuery({
    queryKey: queryKeys.analytics.dataQuality("students", studentScope),
    queryFn: () => fetchStudentQuality(studentScope),
    enabled: tab === "students",
  });
  const staffOverview = useQuery({
    queryKey: queryKeys.analytics.dataQuality("staff", staffScope),
    queryFn: () => fetchStaffQuality(staffScope),
    enabled: tab === "staff" && can("view_staff"),
  });
  const issueScope = tab === "students"
    ? { ...studentScope, field: selectedField ?? undefined, page: issuePage, page_size: 10 }
    : { ...staffScope, field: selectedField ?? undefined, page: issuePage, page_size: 10 };
  const issuesQuery = useQuery({
    queryKey: queryKeys.analytics.dataQualityIssues(tab, issueScope),
    queryFn: () => tab === "students"
      ? fetchStudentQualityIssues(issueScope as any)
      : fetchStaffQualityIssues(issueScope as any),
    enabled: tab === "students" || (tab === "staff" && can("view_staff")),
    placeholderData: keepPreviousData,
  });

  const overview = tab === "students" ? studentOverview.data : staffOverview.data;
  const completeness = overview?.fieldCompleteness ?? [];
  const totalItems = issuesQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalItems / (issuesQuery.data?.pageSize ?? 10)));

  const download = async () => {
    setExporting(tab); setExportError(null);
    try {
      const blob = tab === "students" ? await downloadStudentQualityExcel(studentScope) : await downloadStaffQualityExcel(staffScope);
      const url = createDownloadUrl(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = tab === "students" ? "kualitas_data_siswa.xlsx" : "kualitas_data_staff.xlsx";
      link.click();
      revokeDownloadUrl(url);
    } catch (error) {
      setExportError((error as { message?: string })?.message || "Data quality export failed.");
    } finally {
      setExporting(null);
    }
  };

  const selectField = (field: string) => {
    setSelectedField((current) => (current === field ? null : field));
    setIssuePage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Data Quality"
        description="Completeness and consistency of canonical student and staff master data, computed server-side."
        actions={workspace === "analytics" && can(tab === "students" ? "export_student_data" : "export_staff") && (
          <Button variant="outline" onClick={download} disabled={exporting !== null} aria-busy={exporting === tab} className="gap-2">
            <FileSpreadsheet className="size-4" />
            {exporting === tab ? "Preparing…" : "Export Excel"}
          </Button>
        )}
      />
      {exportError && <Alert variant="danger"><AlertTitle>Export failed</AlertTitle><AlertDescription>{exportError}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Data quality workspace">
        <Button variant={workspace === "analytics" ? "primary" : "outline"} size="sm" onClick={() => setWorkspace("analytics")} aria-pressed={workspace === "analytics"}>Analytics</Button>
        <Button variant={workspace === "resolution" ? "primary" : "outline"} size="sm" onClick={() => setWorkspace("resolution")} aria-pressed={workspace === "resolution"}>Resolution workspace</Button>
      </div>

      {workspace === "resolution" ? <ResolutionWorkspace scope={scope} can={can} /> : <>
      <div className="flex gap-2" role="tablist" aria-label="Data quality target">
        <Button variant={tab === "students" ? "primary" : "outline"} size="sm" onClick={() => { setTab("students"); setSelectedField(null); setIssuePage(1); }} aria-pressed={tab === "students"} className="gap-2"><Users className="size-4" />Students</Button>
        {can("view_staff") && <Button variant={tab === "staff" ? "primary" : "outline"} size="sm" onClick={() => { setTab("staff"); setSelectedField(null); setIssuePage(1); }} aria-pressed={tab === "staff"} className="gap-2"><UserRound className="size-4" />Staff / PTK</Button>}
      </div>

      {tab === "students" && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor="quality-student-status">Enrollment status</FieldLabel>
            <NativeSelect id="quality-student-status" value={studentStatus} onChange={(event) => { setStudentStatus(event.target.value); setSelectedField(null); setIssuePage(1); }} className="w-44">
              {["ACTIVE", "GRADUATED", "WITHDRAWN", "ENDED", "ALL"].map((status) => <option key={status} value={status}>{status}</option>)}
            </NativeSelect>
          </div>
        </div>
      )}
      {tab === "staff" && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor="quality-staff-status">Employment status</FieldLabel>
            <NativeSelect id="quality-staff-status" value={staffEmploymentStatus} onChange={(event) => { setStaffEmploymentStatus(event.target.value); setSelectedField(null); setIssuePage(1); }} className="w-44">
              {["ACTIVE", "FORMER", "UNKNOWN", "ALL"].map((status) => <option key={status} value={status}>{status}</option>)}
            </NativeSelect>
          </div>
        </div>
      )}

      {(tab === "students" ? studentOverview : staffOverview).isPending && <LoadingState title="Loading data quality" />}
      {(tab === "students" ? studentOverview : staffOverview).isError && <ErrorState title="Data quality could not be loaded" description={(tab === "students" ? studentOverview : staffOverview).error?.message} />}
      {overview && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">{tab === "students" ? "Students" : "Staff"}</CardTitle></CardHeader><CardContent className="text-2xl font-black">{tab === "students" ? (overview as any).totalStudents : (overview as any).totalStaff}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Fully complete</CardTitle></CardHeader><CardContent className="text-2xl font-black">{overview.cleanRecords}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Needs attention</CardTitle></CardHeader><CardContent className="text-2xl font-black">{tab === "students" ? (overview as any).recordsWithRequiredIssues + (overview as any).recordsWithOptionalIssues : (overview as any).recordsWithIssues}</CardContent></Card>
            {tab === "students" && <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Missing current enrollment</CardTitle></CardHeader><CardContent className="text-2xl font-black">{(overview as any).missingEnrollmentCount}</CardContent></Card>}
          </div>

          <Card>
            <CardHeader><CardTitle>Completeness by field</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th scope="col" className="py-2 pr-4 font-black">Field</th>
                      <th scope="col" className="py-2 pr-4 font-black">Applicability</th>
                      <th scope="col" className="py-2 pr-4 font-black">Applicable</th>
                      <th scope="col" className="py-2 pr-4 font-black">Complete</th>
                      <th scope="col" className="py-2 pr-4 font-black">Missing</th>
                      <th scope="col" className="py-2 pr-4 font-black">Completeness %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completeness.map((metric) => (
                      <tr key={metric.field} className={`border-b border-slate-100 ${selectedField === metric.field ? "bg-slate-50" : ""}`}>
                        <td className="py-2 pr-4">
                          <button type="button" className="font-semibold text-brand hover:underline" onClick={() => selectField(metric.field)}>
                            {fieldLabels[metric.field] ?? metric.field}
                          </button>
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{metric.applicability.replaceAll("_", " ").toLowerCase()}</td>
                        <td className="py-2 pr-4">{metric.applicable}</td>
                        <td className="py-2 pr-4">{metric.complete}</td>
                        <td className="py-2 pr-4">{metric.missing + metric.unknown + metric.unmapped}</td>
                        <td className="py-2 pr-4">{metric.completenessPercentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {completeness.length > 0 && (
                <div className="mt-6 max-w-xl" role="img" aria-label="Completeness by field bar chart">
                  <Bar
                    data={{
                      labels: completeness.map((metric) => fieldLabels[metric.field] ?? metric.field),
                      datasets: [{ label: "Completeness %", data: completeness.map((metric) => metric.completenessPercentage), backgroundColor: "#4f46e5" }],
                    }}
                    options={{ responsive: true, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {tab === "students" && (overview as any).classBreakdown?.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Quality by class</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th scope="col" className="py-2 pr-4 font-black">Class</th>
                        <th scope="col" className="py-2 pr-4 font-black">Students</th>
                        <th scope="col" className="py-2 pr-4 font-black">Fully complete</th>
                        <th scope="col" className="py-2 pr-4 font-black">With required issues</th>
                        <th scope="col" className="py-2 pr-4 font-black">Missing optional fields</th>
                        <th scope="col" className="py-2 pr-4 font-black">Completeness %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview as any).classBreakdown.map((entry: any) => (
                        <tr key={entry.class} className="border-b border-slate-100">
                          <td className="py-2 pr-4 font-semibold">{entry.class}</td>
                          <td className="py-2 pr-4">{entry.students}</td>
                          <td className="py-2 pr-4">{entry.fullyComplete}</td>
                          <td className="py-2 pr-4">{entry.withRequiredIssues}</td>
                          <td className="py-2 pr-4">{entry.missingOptionalFields}</td>
                          <td className="py-2 pr-4">{entry.completenessPercentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Issues{selectedField ? ` — ${fieldLabels[selectedField] ?? selectedField}` : ""}</CardTitle>
              {selectedField && <Button variant="ghost" size="sm" onClick={() => { setSelectedField(null); setIssuePage(1); }}>Clear field filter</Button>}
            </CardHeader>
            <CardContent>
              {issuesQuery.isPending && <LoadingState title="Loading issues" />}
              {issuesQuery.isError && <ErrorState title="Issues could not be loaded" description={issuesQuery.error?.message} />}
              {issuesQuery.data && issuesQuery.data.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No issues match the current scope and filters.</p>
              )}
              {issuesQuery.data && issuesQuery.data.items.length > 0 && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left">
                          <th scope="col" className="py-2 pr-4 font-black">{tab === "students" ? "Student" : "Staff"}</th>
                          <th scope="col" className="py-2 pr-4 font-black">Context</th>
                          <th scope="col" className="py-2 pr-4 font-black">Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issuesQuery.data.items.map((item) => (
                          <tr key={item.entityId} className="border-b border-slate-100">
                            <td className="py-2 pr-4 font-semibold">{item.entityName}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{item.context}</td>
                            <td className="py-2 pr-4">
                              <ul className="list-disc pl-4">
                                {item.issues.map((issue) => (
                                  <li key={`${issue.field}-${issue.type}`}>{issue.label} <span className="text-xs text-muted-foreground">({issueTypeLabels[issue.type] ?? issue.type})</span></li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Page {issuesQuery.data.page} of {pageCount} · {issuesQuery.data.total} records with issues</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={issuePage <= 1} onClick={() => setIssuePage((current) => Math.max(1, current - 1))}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={issuePage >= pageCount} onClick={() => setIssuePage((current) => Math.min(pageCount, current + 1))}>Next</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      </>}
    </div>
  );
}
