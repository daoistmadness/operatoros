import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Filter, Loader2 } from "lucide-react";

import { fetchAttendanceReport } from "../api/attendanceReport";
import { fetchAttendanceAnalyticsOptions } from "../api/attendanceAnalytics";
import { fetchEffectiveTerms, type AcademicTermConfig } from "../api/academicConfig";
import { getReportFilters, downloadReportBlob, type ReportFiltersResponse } from "../api/reports";
import type { AttendanceReportQuery, AttendanceReportResponse } from "@operatoros/contracts/reports";
import { getPageApiError } from "../lib/api/errors";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { EmptyState } from "../components/common/state-message";
import { FormField, FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";

const PERIOD_TYPES = [
  { value: "month", label: "Bulanan" },
  { value: "bimonthly", label: "Dua Bulan" },
  { value: "term", label: "Term" },
  { value: "semester", label: "Semester" },
  { value: "yearly", label: "Tahun Ajaran" },
] as const;
type PeriodType = typeof PERIOD_TYPES[number]["value"];
type MonthOption = ReportFiltersResponse["months"][number];

function groups(months: MonthOption[], size: number) {
  const count = Math.ceil(months.length / size);
  return Array.from({ length: count }, (_, index) => {
    const selected = months.slice(index * size, (index + 1) * size);
    return { value: String(index + 1), label: `${selected[0]?.label ?? ""} – ${selected.at(-1)?.label ?? ""}` };
  });
}

function periodOptions(type: PeriodType, months: MonthOption[], terms: AcademicTermConfig[]) {
  if (type === "month") return months;
  if (type === "term") return terms.map((term) => ({ value: String(term.term_number), label: `${term.label} (${term.start_date} – ${term.end_date})` }));
  if (type === "bimonthly") return groups(months, 2);
  if (type === "semester") return groups(months, Math.ceil(months.length / 2) || 1);
  return [{ value: "all", label: "Seluruh Tahun Ajaran" }];
}

function csvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadAttendanceReport(report: AttendanceReportResponse) {
  const canonical = report.canonical_attendance.totals;
  const manual = report.manual_absence;
  const lines: unknown[][] = [
    ["Data Kehadiran Aktual", "Sumber: Catatan kehadiran siswa"],
    ["Expected Student-Days", canonical.expected_student_days],
    ["Recorded", canonical.recorded_student_days],
    ["Unrecorded", canonical.unrecorded_student_days],
    ["Coverage (%)", canonical.coverage_rate],
    ["Hadir", canonical.hadir_count],
    ["Sakit aktual", canonical.sakit_count],
    ["Izin aktual", canonical.izin_count],
    ["Alfa aktual", canonical.alfa_count],
    ["Attendance Rate (%)", canonical.attendance_rate],
    [],
    ["Siswa", "Jenjang", "Kelas", "Hadir", "Terlambat", "Sakit aktual", "Izin aktual", "Alfa aktual", "Absen", "Tidak lengkap", "Recorded"],
    ...report.students.map((value) => [value.name, value.jenjang, value.class_name, value.hadir, value.late, value.sakit, value.izin, value.alfa, value.absent, value.incomplete, value.recorded]),
    [],
    ["Rekap Manual Sakit / Izin / Alfa", "Sumber: Input total bulanan per kelas"],
    ["Kelengkapan", manual.completeness.complete ? "Lengkap" : "Belum lengkap"],
    ["Entri kelas-bulan diharapkan", manual.completeness.expected_class_month_entries],
    ["Entri lengkap", manual.completeness.completed_class_month_entries],
    ["Entri belum diisi", manual.completeness.missing_class_month_entries],
    [],
    ["Kelas", "Sakit", "Izin", "Alfa", "Bulan tersimpan", "Bulan diharapkan"],
    ...manual.classes.map((value) => [value.class_name, value.sakit ?? "Belum diinput", value.izin ?? "Belum diinput", value.alfa ?? "Belum diinput", value.completed_months, value.expected_months]),
    ["TOTAL", manual.totals.sakit ?? "Belum diinput", manual.totals.izin ?? "Belum diinput", manual.totals.alfa ?? "Belum diinput"],
    ...manual.completeness.missing.map((value) => ["Belum diinput", value.class_name, value.month]),
  ];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  downloadReportBlob(blob, `laporan-absensi-${report.scope.academic_year_id}-${report.scope.period}.csv`);
}

function displayCount(value: number | null) {
  return value === null ? "Belum diinput" : value.toLocaleString("id-ID");
}

function AttendanceReport() {
  const [filters, setFilters] = useState<ReportFiltersResponse | null>(null);
  const [academicYearId, setAcademicYearId] = useState(0);
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [terms, setTerms] = useState<AcademicTermConfig[]>([]);
  const [classes, setClasses] = useState<Array<{ id: number; name: string; jenjangId: number }>>([]);
  const [jenjangs, setJenjangs] = useState<Array<{ id: number; name: string }>>([]);
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [period, setPeriod] = useState("");
  const [jenjangId, setJenjangId] = useState("all");
  const [classId, setClassId] = useState("all");
  const [report, setReport] = useState<AttendanceReportResponse | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getReportFilters().then((value) => {
      setFilters(value);
      setAcademicYearId(value.default_academic_year_id ?? value.academic_years.at(-1)?.id ?? 0);
      setMonths(value.months);
      setLoadingOptions(false);
    }).catch((cause) => {
      setError(getPageApiError(cause, "Gagal memuat pilihan laporan."));
      setLoadingOptions(false);
    });
  }, []);

  useEffect(() => {
    if (!academicYearId) return;
    setLoadingOptions(true);
    Promise.all([
      getReportFilters({ academic_year_id: academicYearId }),
      fetchAttendanceAnalyticsOptions(academicYearId),
      fetchEffectiveTerms(academicYearId),
    ]).then(([reportFilters, attendanceOptions, effectiveTerms]) => {
      setMonths(reportFilters.months);
      setClasses(attendanceOptions.classes);
      setJenjangs(attendanceOptions.jenjangs);
      setTerms(effectiveTerms);
      setLoadingOptions(false);
    }).catch((cause) => {
      setError(getPageApiError(cause, "Gagal memuat pilihan tahun ajaran."));
      setLoadingOptions(false);
    });
  }, [academicYearId]);

  const options = useMemo(() => periodOptions(periodType, months, terms), [periodType, months, terms]);
  useEffect(() => {
    if (!options.some((value) => value.value === period)) setPeriod(options[0]?.value ?? "");
  }, [options, period]);
  const visibleClasses = useMemo(() => classes.filter((value) => jenjangId === "all" || value.jenjangId === Number(jenjangId)), [classes, jenjangId]);
  const selectedYear = filters?.academic_years.find((value) => value.id === academicYearId);

  const generate = async () => {
    if (!academicYearId || !period) return;
    setLoading(true);
    setError("");
    try {
      const query: AttendanceReportQuery = {
        academic_year_id: String(academicYearId), period_type: periodType, period,
        jenjang_id: jenjangId === "all" ? undefined : jenjangId,
        class_id: classId === "all" ? undefined : classId,
      };
      setReport(await fetchAttendanceReport(query));
    } catch (cause) {
      setReport(null);
      setError(getPageApiError(cause, "Gagal membuat laporan absensi."));
    } finally {
      setLoading(false);
    }
  };

  const canonical = report?.canonical_attendance.totals;
  const manual = report?.manual_absence;
  const rate = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader title="Laporan Kehadiran" description="Lihat kehadiran aktual dan rekap manual bulanan dalam bagian terpisah." actions={report && <Button variant="outline" onClick={() => downloadAttendanceReport(report)}><Download size={16} /> Ekspor CSV</Button>} />

      <FilterBar className="p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3"><Filter size={17} className="text-brand" /><h2 className="font-semibold text-slate-800">Filter Laporan</h2></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <FormField id="attendance-report-year"><FieldLabel>Tahun Ajaran</FieldLabel><NativeSelect value={academicYearId || ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setJenjangId("all"); setClassId("all"); setReport(null); }}>
            {filters?.academic_years.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
          </NativeSelect></FormField>
          <FormField id="attendance-report-period-type"><FieldLabel>Periode</FieldLabel><NativeSelect value={periodType} onChange={(event) => { setPeriodType(event.target.value as PeriodType); setPeriod(""); }}>
            {PERIOD_TYPES.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}
          </NativeSelect></FormField>
          <FormField id="attendance-report-period"><FieldLabel>Pilih periode</FieldLabel><NativeSelect value={period} onChange={(event) => setPeriod(event.target.value)}>
            {options.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}
          </NativeSelect></FormField>
          <FormField id="attendance-report-jenjang"><FieldLabel>Jenjang</FieldLabel><NativeSelect value={jenjangId} onChange={(event) => { setJenjangId(event.target.value); setClassId("all"); }}>
            <option value="all">Semua jenjang</option>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
          </NativeSelect></FormField>
          <FormField id="attendance-report-class"><FieldLabel>Kelas</FieldLabel><NativeSelect value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="all">Semua kelas</option>{visibleClasses.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
          </NativeSelect></FormField>
        </div>
        {selectedYear && <p className="mt-3 text-xs text-slate-500">Tahun ajaran: {selectedYear.start_date} – {selectedYear.end_date}.</p>}
        <div className="mt-4"><Button onClick={generate} disabled={loadingOptions || loading || !period}><FileText size={16} /> Buat Laporan</Button></div>
      </FilterBar>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat laporan…</div>}

      {report && canonical && manual && !loading && <>
        <section aria-labelledby="canonical-attendance-title" className="space-y-3">
          <div><h2 id="canonical-attendance-title" className="text-lg font-bold text-slate-900">Data Kehadiran Aktual</h2><p className="text-sm text-slate-500">Sumber: Catatan kehadiran siswa dan koreksi yang berlaku.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Expected Student-Days", canonical.expected_student_days], ["Recorded", canonical.recorded_student_days],
              ["Unrecorded", canonical.unrecorded_student_days], ["Coverage", rate(canonical.coverage_rate)],
              ["Hadir", canonical.hadir_count], ["Sakit aktual", canonical.sakit_count], ["Izin aktual", canonical.izin_count],
              ["Alfa aktual", canonical.alfa_count], ["Attendance Rate", rate(canonical.attendance_rate)], ["Terlambat", canonical.late_count],
            ].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{typeof value === "number" ? value.toLocaleString("id-ID") : value}</p></Card>)}
          </div>
        </section>

        <section aria-labelledby="manual-absence-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="manual-absence-title" className="text-lg font-bold text-slate-900">Rekap Manual Sakit / Izin / Alfa</h2><p className="text-sm text-slate-500">Sumber: Input total bulanan per kelas. Bulan yang beririsan dengan periode dihitung penuh.</p></div><span className={`rounded-full px-3 py-1 text-sm font-semibold ${manual.completeness.complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{manual.completeness.complete ? "Data lengkap" : "Data belum lengkap"}</span></div>
          <Card className="overflow-hidden p-0">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
              <p>Entri yang diharapkan: <strong>{manual.completeness.expected_class_month_entries}</strong></p>
              <p>Entri lengkap: <strong>{manual.completeness.completed_class_month_entries}</strong></p>
              <p>Belum diisi: <strong>{manual.completeness.missing_class_month_entries}</strong></p>
            </div>
            {manual.completeness.missing.length > 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Belum diinput:</strong> {manual.completeness.missing.map((value) => `${value.class_name} / ${value.month}`).join(", ")}</div>}
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Kelas</th><th className="px-4 py-3 text-right">Sakit</th><th className="px-4 py-3 text-right">Izin</th><th className="px-4 py-3 text-right">Alfa</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{manual.classes.map((value) => <tr key={value.class_id}>
                <td className="px-4 py-3"><span className="font-semibold">{value.class_name}</span><span className="ml-2 text-xs text-slate-500">{value.jenjang} · {value.program}</span></td>
                <td className="px-4 py-3 text-right">{displayCount(value.sakit)}</td><td className="px-4 py-3 text-right">{displayCount(value.izin)}</td><td className="px-4 py-3 text-right">{displayCount(value.alfa)}</td>
                <td className="px-4 py-3 text-xs">{value.completed_months === 0 ? "Belum diinput" : value.completed_months === value.expected_months ? "Lengkap" : `Sebagian (${value.completed_months}/${value.expected_months})`}</td>
              </tr>)}
              {manual.classes.length > 0 && <tr className="bg-slate-50 font-bold"><td className="px-4 py-3">TOTAL</td><td className="px-4 py-3 text-right">{displayCount(manual.totals.sakit)}</td><td className="px-4 py-3 text-right">{displayCount(manual.totals.izin)}</td><td className="px-4 py-3 text-right">{displayCount(manual.totals.alfa)}</td><td className="px-4 py-3">{manual.completeness.complete ? "Lengkap" : "Sebagian"}</td></tr>}
              </tbody>
            </table></div>
          </Card>
        </section>

        <section aria-labelledby="student-attendance-title" className="space-y-3">
          <div><h2 id="student-attendance-title" className="text-lg font-bold text-slate-900">Rincian Kehadiran Siswa</h2><p className="text-sm text-slate-500">Sumber: Catatan kehadiran siswa. Angka di bawah tidak mengambil total manual kelas.</p></div>
          {report.students.length === 0 ? <EmptyState title="Belum ada catatan kehadiran" description="Tidak ada catatan kanonis pada periode dan filter ini." /> : <Card className="overflow-x-auto p-0"><table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Siswa</th><th className="px-4 py-3">Jenjang</th><th className="px-4 py-3">Kelas</th><th className="px-4 py-3 text-right">Hadir</th><th className="px-4 py-3 text-right">Terlambat</th><th className="px-4 py-3 text-right">Sakit</th><th className="px-4 py-3 text-right">Izin</th><th className="px-4 py-3 text-right">Alfa</th><th className="px-4 py-3 text-right">Absen</th><th className="px-4 py-3 text-right">Tidak lengkap</th><th className="px-4 py-3 text-right">Recorded</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{report.students.map((value) => <tr key={value.student_id}><td className="px-4 py-3 font-medium">{value.name}</td><td className="px-4 py-3">{value.jenjang ?? "—"}</td><td className="px-4 py-3">{value.class_name ?? "—"}</td><td className="px-4 py-3 text-right">{value.hadir}</td><td className="px-4 py-3 text-right">{value.late}</td><td className="px-4 py-3 text-right">{value.sakit}</td><td className="px-4 py-3 text-right">{value.izin}</td><td className="px-4 py-3 text-right">{value.alfa}</td><td className="px-4 py-3 text-right">{value.absent}</td><td className="px-4 py-3 text-right">{value.incomplete}</td><td className="px-4 py-3 text-right">{value.recorded}</td></tr>)}</tbody>
          </table></Card>}
        </section>
      </>}

      {!report && !loading && !loadingOptions && !error && <EmptyState title="Laporan belum dibuat" description="Pilih Tahun Ajaran dan periode, lalu buat laporan." />}
    </div>
  );
}

export default AttendanceReport;
