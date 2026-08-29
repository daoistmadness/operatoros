import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { Download, FileSpreadsheet, Users, UserRound, Layers, School } from "lucide-react";
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
import {
  downloadStaffRecapExcel,
  downloadStudentRecapExcel,
  fetchStaffRecap,
  fetchStudentRecap,
} from "../api/recapitulation";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const STUDENT_DIMENSIONS = ["gender", "religion", "jenjang", "class", "age", "status"] as const;
const STAFF_DIMENSIONS = ["employment", "job_title", "education", "jenjang"] as const;
const dimensionTitles: Record<string, string> = {
  gender: "Gender", religion: "Religion", jenjang: "Jenjang", class: "Class / Rombel",
  age: "Age", status: "Enrollment Status", employment: "Employment Status",
  job_title: "Job Title", education: "Education", jenjang_assignment: "Jenjang Assignment",
};

function RecapTable({ rows, matrix }: { rows: { key: string; label: string; count: number; percentage: number }[]; matrix: any }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th scope="col" className="py-2 pr-4 font-black">Category</th>
            <th scope="col" className="py-2 pr-4 font-black">Count</th>
            <th scope="col" className="py-2 pr-4 font-black">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-100">
              <td className="py-2 pr-4 font-semibold">{row.label}</td>
              <td className="py-2 pr-4">{row.count}</td>
              <td className="py-2 pr-4">{row.percentage}%</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-black">
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4">{rows.reduce((sum, row) => sum + row.count, 0)}</td>
            <td className="py-2 pr-4">100%</td>
          </tr>
        </tbody>
      </table>
      {matrix && matrix.rows.length > 0 && (
        <table className="mt-6 w-full text-sm">
          <caption className="sr-only">Recapitulation matrix by class</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th scope="col" className="py-2 pr-4 font-black">Class / Rombel</th>
              {matrix.columns.map((column: any) => (
                <th scope="col" key={column.key} className="py-2 pr-4 font-black">{column.label}</th>
              ))}
              <th scope="col" className="py-2 pr-4 font-black">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row: any) => (
              <tr key={row.key} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-semibold">{row.label}</td>
                {row.cells.map((cell: number, index: number) => <td key={index} className="py-2 pr-4">{cell}</td>)}
                <td className="py-2 pr-4 font-bold">{row.rowTotal}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-black">
              <td className="py-2 pr-4">Total</td>
              {matrix.columnTotals.map((total: number, index: number) => <td key={index} className="py-2 pr-4">{total}</td>)}
              <td className="py-2 pr-4">{matrix.grandTotal}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecapChart({ rows, title }: { rows: { key: string; label: string; count: number }[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6" role="img" aria-label={`${title} bar chart`}>
      <Bar
        data={{
          labels: rows.map((row) => row.label),
          datasets: [{ label: title, data: rows.map((row) => row.count), backgroundColor: "#4f46e5" }],
        }}
        options={{ responsive: true, plugins: { legend: { display: false } } }}
      />
    </div>
  );
}

export default function DataRecapitulation() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"students" | "staff">("students");
  const [studentDimension, setStudentDimension] = useState<string>("gender");
  const [staffDimension, setStaffDimension] = useState<string>("employment");
  const [studentStatus, setStudentStatus] = useState<string>("ACTIVE");
  const [staffEmploymentStatus, setStaffEmploymentStatus] = useState<string>("ACTIVE");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const studentFilters = { dimension: studentDimension, status: studentStatus };
  const staffFilters = { dimension: staffDimension, employment_status: staffEmploymentStatus };
  const studentQuery = useQuery({
    queryKey: queryKeys.analytics.recap("students", studentFilters),
    queryFn: () => fetchStudentRecap(studentFilters),
    enabled: tab === "students",
  });
  const staffQuery = useQuery({
    queryKey: queryKeys.analytics.recap("staff", staffFilters),
    queryFn: () => fetchStaffRecap(staffFilters),
    enabled: tab === "staff" && can("view_staff"),
  });

  const download = async (kind: "students" | "staff") => {
    setExporting(kind); setExportError(null);
    try {
      const blob = kind === "students"
        ? await downloadStudentRecapExcel({ status: studentStatus })
        : await downloadStaffRecapExcel({ employment_status: staffEmploymentStatus });
      const url = createDownloadUrl(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = kind === "students" ? "rekap_siswa.xlsx" : "rekap_staff.xlsx";
      link.click();
      revokeDownloadUrl(url);
    } catch (error) {
      setExportError((error as { message?: string })?.message || "Recapitulation export failed.");
    } finally {
      setExporting(null);
    }
  };

  const activeQuery = tab === "students" ? studentQuery : staffQuery;
  const activeRows = (activeQuery.data as any)?.rows ?? [];
  const activeDimension = tab === "students" ? studentDimension : staffDimension;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Data Recapitulation"
        description="Descriptive summaries of canonical student and staff data, computed server-side."
        actions={can(tab === "students" ? "export_student_data" : "export_staff") && (
          <Button variant="outline" onClick={() => download(tab)} disabled={exporting !== null} aria-busy={exporting === tab} className="gap-2">
            <FileSpreadsheet className="size-4" />
            {exporting === tab ? "Preparing…" : "Export Excel"}
          </Button>
        )}
      />
      {exportError && <Alert variant="danger"><AlertTitle>Export failed</AlertTitle><AlertDescription>{exportError}</AlertDescription></Alert>}
      <div className="flex gap-2" role="tablist" aria-label="Recapitulation target">
        <Button variant={tab === "students" ? "primary" : "outline"} size="sm" onClick={() => setTab("students")} aria-pressed={tab === "students"} className="gap-2"><Users className="size-4" />Students</Button>
        {can("view_staff") && <Button variant={tab === "staff" ? "primary" : "outline"} size="sm" onClick={() => setTab("staff")} aria-pressed={tab === "staff"} className="gap-2"><UserRound className="size-4" />Staff / PTK</Button>}
      </div>

      {tab === "students" && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor="recap-student-dimension">Category</FieldLabel>
            <NativeSelect id="recap-student-dimension" value={studentDimension} onChange={(event) => setStudentDimension(event.target.value)} className="w-48">
              {STUDENT_DIMENSIONS.map((dimension) => <option key={dimension} value={dimension}>{dimensionTitles[dimension]}</option>)}
            </NativeSelect>
          </div>
          <div>
            <FieldLabel htmlFor="recap-student-status">Enrollment status</FieldLabel>
            <NativeSelect id="recap-student-status" value={studentStatus} onChange={(event) => setStudentStatus(event.target.value)} className="w-44">
              {["ACTIVE", "GRADUATED", "WITHDRAWN", "ENDED", "ALL"].map((status) => <option key={status} value={status}>{status}</option>)}
            </NativeSelect>
          </div>
        </div>
      )}
      {tab === "staff" && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor="recap-staff-dimension">Category</FieldLabel>
            <NativeSelect id="recap-staff-dimension" value={staffDimension} onChange={(event) => setStaffDimension(event.target.value)} className="w-48">
              {STAFF_DIMENSIONS.map((dimension) => <option key={dimension} value={dimension}>{dimensionTitles[dimension]}</option>)}
            </NativeSelect>
          </div>
          <div>
            <FieldLabel htmlFor="recap-staff-status">Employment status</FieldLabel>
            <NativeSelect id="recap-staff-status" value={staffEmploymentStatus} onChange={(event) => setStaffEmploymentStatus(event.target.value)} className="w-44">
              {["ACTIVE", "FORMER", "UNKNOWN", "ALL"].map((status) => <option key={status} value={status}>{status}</option>)}
            </NativeSelect>
          </div>
        </div>
      )}

      {activeQuery.isPending && <LoadingState title="Loading recapitulation" />}
      {activeQuery.isError && <ErrorState title="Recapitulation could not be loaded" description={activeQuery.error?.message} />}
      {activeQuery.data && activeRows.length === 0 && (
        <Card><CardContent><p className="text-sm text-muted-foreground">No records match the current scope. Adjust the filters.</p></CardContent></Card>
      )}
      {activeQuery.data && activeRows.length > 0 && (
        <div className="space-y-4">
          {tab === "students" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Students</CardTitle></CardHeader><CardContent className="text-2xl font-black">{(studentQuery.data as any).total}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Male</CardTitle></CardHeader><CardContent className="text-2xl font-black">{(studentQuery.data as any).summary.male}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Female</CardTitle></CardHeader><CardContent className="text-2xl font-black">{(studentQuery.data as any).summary.female}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Classes</CardTitle></CardHeader><CardContent className="text-2xl font-black flex items-center gap-2"><School className="size-5 text-muted-foreground" />{(studentQuery.data as any).summary.classes}</CardContent></Card>
            </div>
          )}
          {tab === "staff" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Staff</CardTitle></CardHeader><CardContent className="text-2xl font-black">{(staffQuery.data as any).total}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm font-black text-muted-foreground">Dimension</CardTitle></CardHeader><CardContent className="text-2xl font-black flex items-center gap-2"><Layers className="size-5 text-muted-foreground" />{dimensionTitles[staffDimension]}</CardContent></Card>
            </div>
          )}
          <Card>
            <CardHeader><CardTitle>{dimensionTitles[activeDimension]}</CardTitle></CardHeader>
            <CardContent>
              <RecapTable rows={activeRows} matrix={(activeQuery.data as any).matrix} />
              <RecapChart rows={activeRows} title={dimensionTitles[activeDimension]} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
