import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import { Download } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState, PermissionRestrictedState, SetupRequiredState } from "../components/common/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { Input } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { createDownloadUrl, revokeDownloadUrl } from "../lib/api/client";
import { downloadAttendanceAnalytics, type AttendanceAnalyticsFilters } from "../api/attendanceAnalytics";
import { useAnalyticsFiltersQuery } from "../hooks/useAnalyticsQueries";
import { useAttendanceAnalyticsOptionsQuery, useAttendanceClassesQuery, useAttendanceDailyQuery, useAttendanceJenjangQuery, useAttendanceOverviewQuery, useAttendanceStudentsQuery } from "../hooks/useAttendanceAnalyticsQueries";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const STATUS_LABELS = { present: "Present", late: "Late", incomplete: "Incomplete", absent: "Absent", sakit: "Sakit", izin: "Izin", alfa: "Alfa", unrecorded: "Unrecorded" } as const;
type Sort = "name" | "attendance_rate" | "late" | "alfa";

function pct(value: number) { return `${value.toFixed(2)}%`; }
function queryId(value: string | null): number | null { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

export default function AttendanceAnalytics() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const allowed = can("view_attendance");
  const [academicYearId, setAcademicYearId] = useState<number | null>(() => queryId(searchParams.get("academic_year_id")));
  const [jenjangId, setJenjangId] = useState<number | null>(() => queryId(searchParams.get("jenjang_id")));
  const [classId, setClassId] = useState<number | null>(() => queryId(searchParams.get("class_id")));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const filterQuery = useAnalyticsFiltersQuery({}, allowed);
  const yearOptions = filterQuery.data?.academic_years ?? [];
  useEffect(() => {
    if (academicYearId === null) {
      const year = yearOptions.find((item) => item.is_default) ?? yearOptions[0];
      if (year) setAcademicYearId(year.id);
    }
  }, [academicYearId, yearOptions]);

  const optionsQuery = useAttendanceAnalyticsOptionsQuery(academicYearId, jenjangId, allowed);
  useEffect(() => {
    const year = optionsQuery.data?.academicYears.find((item) => item.id === academicYearId);
    if (year && (!dateFrom || !dateTo)) { setDateFrom(year.startDate); setDateTo(year.endDate); }
  }, [academicYearId, dateFrom, dateTo, optionsQuery.data]);
  useEffect(() => { if (classId !== null && optionsQuery.data && !optionsQuery.data.classes.some((item) => item.id === classId)) setClassId(null); }, [classId, optionsQuery.data]);
  useEffect(() => { setPage(1); }, [academicYearId, jenjangId, classId, dateFrom, dateTo, search, sort, order]);

  const filters = useMemo<AttendanceAnalyticsFilters | null>(() => {
    if (academicYearId === null || !dateFrom || !dateTo || dateFrom > dateTo) return null;
    return { academic_year_id: academicYearId, date_from: dateFrom, date_to: dateTo, jenjang_id: jenjangId, class_id: classId };
  }, [academicYearId, dateFrom, dateTo, jenjangId, classId]);
  const overview = useAttendanceOverviewQuery(filters, allowed);
  const classes = useAttendanceClassesQuery(filters, allowed);
  const jenjangs = useAttendanceJenjangQuery(filters, allowed);
  const daily = useAttendanceDailyQuery(filters, allowed);
  const students = useAttendanceStudentsQuery(filters ? { ...filters, search, sort, order, page, page_size: 25 } : null, allowed);

  if (!allowed) return <PermissionRestrictedState title="Akses Terbatas" description="Anda tidak memiliki izin untuk melihat analitik kehadiran." />;
  if (filterQuery.isPending || optionsQuery.isPending) return <LoadingState title="Memuat analitik kehadiran" description="Menyiapkan pilihan periode dan data." />;
  if (filterQuery.error || optionsQuery.error) return <ErrorState title="Gagal Memuat Analitik Kehadiran" description="Pilihan analitik tidak dapat dimuat." action={<Button onClick={() => { void filterQuery.refetch(); void optionsQuery.refetch(); }}>Coba Lagi</Button>} />;
  if (yearOptions.length === 0) return <SetupRequiredState title="Konfigurasi Akademik Diperlukan" description="Tambahkan tahun akademik sebelum membuka analitik kehadiran." action={<Button onClick={() => navigate("/academic-management")}>Buka Pengaturan Akademik</Button>} />;
  if (!filters) return <ErrorState title="Rentang tanggal tidak valid" description="Pilih tanggal mulai yang tidak melewati tanggal akhir." />;
  const dataError = [overview, classes, jenjangs, daily, students].find((query) => query.error);
  if (dataError) return <ErrorState title="Gagal Memuat Data Kehadiran" description="Server tidak dapat memuat data pada cakupan ini." action={<Button onClick={() => { void overview.refetch(); void classes.refetch(); void jenjangs.refetch(); void daily.refetch(); void students.refetch(); }}>Coba Lagi</Button>} />;
  if (overview.isPending || classes.isPending || jenjangs.isPending || daily.isPending || students.isPending) return <LoadingState title="Memuat data kehadiran" description="Menghitung ringkasan pada server." />;
  const summary = overview.data!;
  const statusRows = Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label, value: summary.counts[key as keyof typeof summary.counts] }));
  const chartData = { labels: statusRows.map((item) => item.label), datasets: [{ label: "Records", data: statusRows.map((item) => item.value), backgroundColor: "#1d4ed8" }] };
  const exportReport = async () => {
    setExportError(""); setExporting(true);
    try {
      const blob = await downloadAttendanceAnalytics(filters);
      const url = createDownloadUrl(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `attendance-analytics-${filters.date_from}-${filters.date_to}.xlsx`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); revokeDownloadUrl(url);
    } catch { setExportError("File Excel tidak dapat dibuat."); } finally { setExporting(false); }
  };
  const toggleSort = (next: Sort) => { if (sort === next) setOrder((value) => value === "asc" ? "desc" : "asc"); else { setSort(next); setOrder("asc"); } };
  const pageCount = Math.max(1, Math.ceil((students.data?.total ?? 0) / (students.data?.pageSize ?? 25)));

  return <div className="space-y-7">
    <PageHeader eyebrow="Management Analytics" title="Attendance Analytics" description="Descriptive attendance metrics from canonical server-side attendance records." actions={<Button onClick={exportReport} disabled={exporting}><Download className="h-4 w-4" aria-hidden="true" />{exporting ? "Mengekspor…" : "Export Attendance Analytics"}</Button>} />
    {exportError && <ErrorState title="Ekspor gagal" description={exportError} />}
    <Card><CardHeader><CardTitle>Filters</CardTitle></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <div><FieldLabel htmlFor="attendance-year">Academic year</FieldLabel><NativeSelect id="attendance-year" value={academicYearId ?? ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setDateFrom(""); setDateTo(""); setJenjangId(null); setClassId(null); }}><option value="">Select year</option>{yearOptions.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="attendance-from">Date from</FieldLabel><Input id="attendance-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
      <div><FieldLabel htmlFor="attendance-to">Date to</FieldLabel><Input id="attendance-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
      <div><FieldLabel htmlFor="attendance-jenjang">Jenjang</FieldLabel><NativeSelect id="attendance-jenjang" value={jenjangId ?? ""} onChange={(event) => { setJenjangId(event.target.value ? Number(event.target.value) : null); setClassId(null); }}><option value="">All jenjang</option>{optionsQuery.data?.jenjangs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="attendance-class">Class / Rombel</FieldLabel><NativeSelect id="attendance-class" value={classId ?? ""} onChange={(event) => setClassId(event.target.value ? Number(event.target.value) : null)}><option value="">All classes</option>{optionsQuery.data?.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></div>
    </div></CardContent></Card>
    <section aria-label="Attendance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[['Attendance rate', pct(summary.attendanceRate)], ['Present', summary.counts.present], ['Late', summary.counts.late], ['Alfa', summary.counts.alfa], ['Overrides', `${summary.overriddenRecords} (${pct(summary.overridePercentage)})`]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-5"><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></CardContent></Card>)}
    </section>
    <div className="grid gap-7 xl:grid-cols-2"><Card><CardHeader><CardTitle>Status distribution</CardTitle></CardHeader><CardContent><div className="h-72"><Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div><table className="mt-4 w-full text-sm"><caption className="sr-only">Attendance status counts</caption><tbody>{statusRows.map((item) => <tr key={item.key} className="border-b border-slate-100"><th className="py-2 text-left font-semibold">{item.label}</th><td className="py-2 text-right">{item.value}</td></tr>)}</tbody></table></CardContent></Card>
      <Card><CardHeader><CardTitle>Scope</CardTitle></CardHeader><CardContent><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Academic year</dt><dd>{summary.scope.academicYearLabel}</dd></div><div><dt className="font-semibold text-muted-foreground">Date range</dt><dd>{summary.scope.dateFrom} – {summary.scope.dateTo}</dd></div><div><dt className="font-semibold text-muted-foreground">Records</dt><dd>{summary.totalRecords}</dd></div><div><dt className="font-semibold text-muted-foreground">Students</dt><dd>{summary.students}</dd></div><div><dt className="font-semibold text-muted-foreground">Classes</dt><dd>{summary.classes}</dd></div><div><dt className="font-semibold text-muted-foreground">HEB total</dt><dd>{summary.hebTotal}</dd></div></dl><p className="mt-6 text-sm text-muted-foreground">Attendance rate uses the existing denominator: Present + Late + Sakit + Izin + Alfa. Incomplete and Absent remain visible as counts.</p></CardContent></Card></div>
    <DataTable title="By Class" headers={["Class", "Students", "Present", "Late", "Sakit", "Izin", "Alfa", "Incomplete", "Rate", "Tardiness", "Unexcused"]} sortableColumns={[0, 3, 6, 8, 9, 10]} rows={(classes.data?.rows ?? []).map((item) => [item.className, item.students, item.counts.present, item.counts.late, item.counts.sakit, item.counts.izin, item.counts.alfa, item.counts.incomplete, pct(item.attendanceRate), pct(item.tardinessRate), pct(item.unexcusedAbsenceRate)])} />
    <DataTable title="By Jenjang" headers={["Jenjang", "Students", "Present", "Late", "Sakit", "Izin", "Alfa", "Incomplete", "Rate", "Tardiness", "Unexcused"]} sortableColumns={[0, 3, 6, 8, 9, 10]} rows={(jenjangs.data?.rows ?? []).map((item) => [item.jenjang, item.students, item.counts.present, item.counts.late, item.counts.sakit, item.counts.izin, item.counts.alfa, item.counts.incomplete, pct(item.attendanceRate), pct(item.tardinessRate), pct(item.unexcusedAbsenceRate)])} />
    <DataTable title="Daily" headers={["Date", "Records", "Present", "Late", "Absent", "Sakit", "Izin", "Alfa", "Rate"]} rows={(daily.data?.rows ?? []).map((item) => [item.date, item.records, item.counts.present, item.counts.late, item.counts.absent, item.counts.sakit, item.counts.izin, item.counts.alfa, pct(item.attendanceRate)])} />
    <Card><CardHeader><CardTitle>Students</CardTitle></CardHeader><CardContent><div className="mb-4 flex flex-wrap items-end gap-3"><div className="min-w-60 flex-1"><FieldLabel htmlFor="attendance-search">Search student</FieldLabel><Input id="attendance-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name" /></div><p className="text-sm text-muted-foreground">{students.data?.total ?? 0} students</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Student attendance totals</caption><thead><tr className="border-b border-slate-200 text-left">{[["Student", "name"], ["Class", null], ["Present", null], ["Late", "late"], ["Alfa", "alfa"], ["Incomplete", null], ["Rate", "attendance_rate"]].map(([label, key]) => <th scope="col" className="py-2 pr-4 font-black" key={String(label)}>{key ? <button className="underline-offset-4 hover:underline" onClick={() => toggleSort(key as Sort)}>{label}</button> : label}</th>)}</tr></thead><tbody>{(students.data?.rows ?? []).map((item) => <tr key={item.studentId} className="border-b border-slate-100"><th scope="row" className="py-2 pr-4 text-left font-semibold">{item.studentName}</th><td className="py-2 pr-4">{item.className ?? "Unknown"}</td><td className="py-2 pr-4">{item.counts.present}</td><td className="py-2 pr-4">{item.counts.late}</td><td className="py-2 pr-4">{item.counts.alfa}</td><td className="py-2 pr-4">{item.counts.incomplete}</td><td className="py-2 pr-4">{pct(item.attendanceRate)}</td></tr>)}</tbody></table></div>{students.data?.rows.length === 0 && <EmptyState className="mt-4" title="No students found" description="No attendance records match this scope." />}<div className="mt-4 flex items-center justify-between"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next</Button></div></CardContent></Card>
  </div>;
}

function DataTable({ title, headers, rows, sortableColumns = [] }: { title: string; headers: string[]; rows: (string | number)[][]; sortableColumns?: number[] }) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [descending, setDescending] = useState(false);
  const orderedRows = useMemo(() => {
    if (sortColumn === null) return rows;
    return [...rows].sort((left, right) => {
      const a = left[sortColumn]; const b = right[sortColumn];
      const aNumber = typeof a === "number" ? a : Number(String(a).replace("%", ""));
      const bNumber = typeof b === "number" ? b : Number(String(b).replace("%", ""));
      const result = Number.isNaN(aNumber) || Number.isNaN(bNumber) ? String(a).localeCompare(String(b)) : aNumber - bNumber;
      return descending ? -result : result;
    });
  }, [descending, rows, sortColumn]);
  const toggleSort = (column: number) => { if (sortColumn === column) setDescending((value) => !value); else { setSortColumn(column); setDescending(false); } };
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{title}</caption><thead><tr className="border-b border-slate-200 text-left">{headers.map((header, index) => <th scope="col" className="py-2 pr-4 font-black" key={header}>{sortableColumns.includes(index) ? <button className="underline-offset-4 hover:underline" onClick={() => toggleSort(index)}>{header}</button> : header}</th>)}</tr></thead><tbody>{orderedRows.map((values, index) => <tr className="border-b border-slate-100" key={`${title}-${index}`}>{values.map((value, cellIndex) => cellIndex === 0 ? <th scope="row" className="py-2 pr-4 text-left font-semibold" key={cellIndex}>{value}</th> : <td className="py-2 pr-4" key={cellIndex}>{value}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <EmptyState className="mt-4" title={`No ${title.toLowerCase()} data`} description="No attendance records match this scope." />}</div></CardContent></Card>;
}
