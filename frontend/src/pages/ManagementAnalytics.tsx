import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  Download,
  GraduationCap,
  Info,
  RefreshCw,
  TrendingUp,
  UserX,
} from "lucide-react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

import {
  fetchAnalyticsFilters,
  fetchManagementSummary,
  type FetchSummaryParams,
} from "../api/analytics";
import type {
  AnalyticsFiltersResponse,
  ManagementSummaryResponse,
} from "../types/analytics";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const TERM_OPTIONS = [
  { value: "term_1", label: "Term 1 (July - September)" },
  { value: "term_2", label: "Term 2 (October - December)" },
  { value: "term_3", label: "Term 3 (January - March)" },
  { value: "term_4", label: "Term 4 (April - June)" },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Terjadi kesalahan saat memuat data analisis manajemen.";
}

export default function ManagementAnalytics() {
  const [filterOptions, setFilterOptions] = useState<AnalyticsFiltersResponse | null>(null);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [jenjangId, setJenjangId] = useState<number | null>(null);
  const [className, setClassName] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [term, setTerm] = useState<string | null>(null);

  const [summaryData, setSummaryData] = useState<ManagementSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingFilters, setIsUpdatingFilters] = useState(false);
  const [error, setError] = useState<string>("");

  // Load initial filter parameters
  useEffect(() => {
    async function loadInitialFilters() {
      try {
        const filters = await fetchAnalyticsFilters();
        setFilterOptions(filters);

        // Auto-select default academic year
        const defaultYear = filters.academic_years.find((y) => y.is_default);
        if (defaultYear) {
          setAcademicYearId(defaultYear.id);
        } else if (filters.academic_years.length > 0) {
          setAcademicYearId(filters.academic_years[0].id);
        }
      } catch (err) {
        setError(getErrorMessage(err));
        setIsLoading(false);
      }
    }
    loadInitialFilters();
  }, []);

  // Update classes and subjects reactively when academic year or jenjang changes
  useEffect(() => {
    if (academicYearId === null) return;

    async function updateDependentOptions() {
      setIsUpdatingFilters(true);
      try {
        const updated = await fetchAnalyticsFilters({
          academic_year_id: academicYearId,
          jenjang_id: jenjangId || undefined,
        });
        setFilterOptions((prev) => {
          if (!prev) return updated;
          return {
            ...prev,
            class_names: updated.class_names,
            subjects: updated.subjects,
          };
        });

        // Safe cleanup: reset selected class/subject if no longer valid
        if (className && !updated.class_names.includes(className)) {
          setClassName(null);
        }
        if (subjectId && !updated.subjects.some((s) => s.id === subjectId)) {
          setSubjectId(null);
        }
      } catch (err) {
        console.error("Failed to update dependent filters", err);
      } finally {
        setIsUpdatingFilters(false);
      }
    }

    updateDependentOptions();
  }, [academicYearId, jenjangId]);

  // Load summary data
  const loadSummaryData = async () => {
    if (academicYearId === null) return;
    setIsLoading(true);
    setError("");

    try {
      const summary = await fetchManagementSummary({
        academic_year_id: academicYearId,
        jenjang_id: jenjangId,
        class_name: className,
        term: term,
        subject_id: subjectId,
      });
      setSummaryData(summary);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummaryData();
  }, [academicYearId, jenjangId, className, subjectId, term]);

  // Charts config
  const attendanceChartData = useMemo(() => {
    if (!summaryData) return null;
    const counts = summaryData.attendance_summary.status_counts;
    return {
      labels: ["Hadir", "Sakit", "Izin", "Alfa"],
      datasets: [
        {
          data: [counts.hadir, counts.sakit, counts.izin, counts.alfa],
          backgroundColor: [
            "#10b981", // Hadir: emerald-500
            "#3b82f6", // Sakit: blue-500
            "#f59e0b", // Izin: amber-500
            "#ef4444", // Alfa: red-500
          ],
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    };
  }, [summaryData]);

  const latenessChartData = useMemo(() => {
    if (!summaryData || summaryData.lateness_by_class.length === 0) return null;
    const items = summaryData.lateness_by_class;
    return {
      labels: items.map((i) => i.class_name),
      datasets: [
        {
          label: "Hari Terlambat",
          data: items.map((i) => i.late_days),
          backgroundColor: "#f97316", // Terlambat: orange-500
          borderRadius: 8,
        },
      ],
    };
  }, [summaryData]);

  const gradesChartData = useMemo(() => {
    if (!summaryData || summaryData.grade_by_class.length === 0) return null;
    const items = summaryData.grade_by_class;
    return {
      labels: items.map((i) => i.class_name),
      datasets: [
        {
          label: "Rata-rata Sumatif",
          data: items.map((i) => i.sumatif_average ?? 0),
          backgroundColor: "#6366f1", // Indigo
          borderRadius: 6,
        },
        {
          label: "Rata-rata Formatif",
          data: items.map((i) => i.formatif_average ?? 0),
          backgroundColor: "#a855f7", // Purple
          borderRadius: 6,
        },
      ],
    };
  }, [summaryData]);

  const subjectsChartData = useMemo(() => {
    if (!summaryData || summaryData.grade_by_subject.length === 0) return null;
    const items = summaryData.grade_by_subject;
    return {
      labels: items.map((i) => i.subject_name),
      datasets: [
        {
          label: "Rata-rata Sumatif",
          data: items.map((i) => i.sumatif_average ?? 0),
          backgroundColor: "#3b82f6", // Blue
          borderRadius: 6,
        },
        {
          label: "Rata-rata Formatif",
          data: items.map((i) => i.formatif_average ?? 0),
          backgroundColor: "#14b8a6", // Teal
          borderRadius: 6,
        },
      ],
    };
  }, [summaryData]);

  const belowKKMCount = useMemo(() => {
    if (!summaryData) return 0;
    return summaryData.grade_by_student.filter((s) => s.below_threshold).length;
  }, [summaryData]);

  const overallGradeAverage = useMemo(() => {
    if (!summaryData || summaryData.grade_by_class.length === 0) return null;
    const classes = summaryData.grade_by_class;
    let sum = 0;
    let count = 0;
    classes.forEach((c) => {
      if (c.sumatif_average !== null) {
        sum += c.sumatif_average;
        count++;
      }
      if (c.formatif_average !== null) {
        sum += c.formatif_average;
        count++;
      }
    });
    return count > 0 ? (sum / count).toFixed(1) : "—";
  }, [summaryData]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-brand" />
            Management Analytics
          </h1>
          <p className="text-slate-500 font-semibold mt-1">
            Tinjauan Kinerja Tata Kelola Akademik dan Rekapitulasi Laporan Efektivitas
          </p>
        </div>
        <button
          onClick={loadSummaryData}
          disabled={isLoading}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-sm hover:shadow transition-all"
        >
          <RefreshCw className={`h-5 w-5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <Info className="h-4 w-4" />
          Filter Analisis
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
          {/* Academic Year */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Tahun Ajaran</label>
            <select
              value={academicYearId || ""}
              onChange={(e) => setAcademicYearId(Number(e.target.value) || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              {filterOptions?.academic_years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label} {year.is_default ? "(Default)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Jenjang */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Jenjang</label>
            <select
              value={jenjangId || ""}
              onChange={(e) => setJenjangId(Number(e.target.value) || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              <option value="">Semua Jenjang</option>
              {filterOptions?.jenjangs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>

          {/* Class */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Kelas</label>
            <select
              value={className || ""}
              onChange={(e) => setClassName(e.target.value || null)}
              disabled={isUpdatingFilters}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all disabled:opacity-50"
            >
              <option value="">Semua Kelas</option>
              {filterOptions?.class_names.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Mata Pelajaran</label>
            <select
              value={subjectId || ""}
              onChange={(e) => setSubjectId(Number(e.target.value) || null)}
              disabled={isUpdatingFilters}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all disabled:opacity-50"
            >
              <option value="">Semua Mapel</option>
              {filterOptions?.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Term */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500">Term</label>
            <select
              value={term || ""}
              onChange={(e) => setTerm(e.target.value || null)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
            >
              <option value="">Sepanjang Tahun</option>
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((val) => (
              <div key={val} className="h-28 animate-pulse rounded-3xl bg-slate-200/50" />
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="h-96 animate-pulse rounded-3xl bg-slate-200/50" />
            <div className="h-96 animate-pulse rounded-3xl bg-slate-200/50" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <h3 className="text-lg font-black">Gagal memuat visualisasi analisis</h3>
              <p className="mt-1 text-sm font-semibold">{error}</p>
            </div>
          </div>
        </div>
      ) : summaryData ? (
        <div className="space-y-8 animate-[fadeIn_0.2s_ease-out]">
          {/* Warnings Banner */}
          {summaryData.warnings.map((warn, index) => (
            <div key={index} className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 text-amber-800 rounded-2xl text-sm font-semibold">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              <span>{warn}</span>
            </div>
          ))}

          {/* KPI Dashboard Grid */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Kehadiran (Hadir)</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {summaryData.attendance_summary.status_percentages.hadir}%
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Kasus Terlambat</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {summaryData.lateness_by_class.reduce((acc, c) => acc + c.late_days, 0)} Hari
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                <GraduationCap className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Rata-rata Nilai</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {overallGradeAverage}
                </h3>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600">
                <UserX className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400">Di Bawah KKM (Edelweiss)</span>
                <h3 className="text-2xl font-black text-slate-800 mt-0.5">
                  {belowKKMCount} Siswa
                </h3>
              </div>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Penyebaran Status Kehadiran</h3>
              {attendanceChartData && summaryData.attendance_summary.total_records > 0 ? (
                <div className="flex-1 max-h-64 flex justify-center">
                  <Doughnut
                    data={attendanceChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "right" },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data absensi
                </div>
              )}
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Frekuensi Keterlambatan Kelas</h3>
              {latenessChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={latenessChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data keterlambatan kelas
                </div>
              )}
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Rata-rata Nilai per Kelas</h3>
              {gradesChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={gradesChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom" } },
                      scales: {
                        y: { min: 0, max: 100 },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data nilai per kelas
                </div>
              )}
            </div>

            <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm flex flex-col justify-between min-h-[350px]">
              <h3 className="text-lg font-black text-slate-800 mb-4">Rata-rata Nilai per Mapel</h3>
              {subjectsChartData ? (
                <div className="flex-1 max-h-64">
                  <Bar
                    data={subjectsChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom" } },
                      scales: {
                        y: { min: 0, max: 100 },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 font-bold">
                  Tidak ada data nilai per mata pelajaran
                </div>
              )}
            </div>
          </div>

          {/* Table: Lateness Breakdown */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <h3 className="text-lg font-black text-slate-800">Detail Rekapitulasi Keterlambatan Kelas</h3>
            {summaryData.lateness_by_class.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Hari Terlambat</th>
                      <th className="px-6 py-4">Total Durasi</th>
                      <th className="px-6 py-4">% Hari Terlambat</th>
                      <th className="px-6 py-4">% Total Durasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.lateness_by_class.map((item) => (
                      <tr key={item.class_name} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-black text-slate-800">{item.class_name}</td>
                        <td className="px-6 py-4">{item.late_days} Hari</td>
                        <td className="px-6 py-4">{item.late_duration_label} ({item.late_minutes}m)</td>
                        <td className="px-6 py-4">{item.late_day_percentage}%</td>
                        <td className="px-6 py-4">{item.late_duration_percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data rekapitulasi keterlambatan.
              </div>
            )}
          </div>

          {/* Table: Grade by Class */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <h3 className="text-lg font-black text-slate-800">Rangkuman Prestasi Nilai Kelas</h3>
            {summaryData.grade_by_class.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Siswa Terdaftar</th>
                      <th className="px-6 py-4">Rerata Sumatif</th>
                      <th className="px-6 py-4">Rerata Formatif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.grade_by_class.map((item) => (
                      <tr key={item.class_name} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-black text-slate-800">{item.class_name}</td>
                        <td className="px-6 py-4">{item.student_count} Siswa</td>
                        <td className="px-6 py-4">{item.sumatif_average ?? "—"}</td>
                        <td className="px-6 py-4">{item.formatif_average ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data rerata kelas.
              </div>
            )}
          </div>

          {/* Table: Grade by Student (Registry with alert highlights) */}
          <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800">Daftar Prestasi Siswa & Deteksi KKM</h3>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Menampilkan status KKM Edelweiss (Batas KKM = {summaryData.thresholds.kkm_edelweiss})
                </p>
              </div>
            </div>

            {summaryData.grade_by_student.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[11px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4">Nama Siswa</th>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Rerata Sumatif</th>
                      <th className="px-6 py-4">Rerata Formatif</th>
                      <th className="px-6 py-4">Status KKM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                    {summaryData.grade_by_student.map((student) => (
                      <tr
                        key={student.student_id}
                        className={`hover:bg-slate-50/50 transition-colors ${
                          student.below_threshold
                            ? "bg-rose-50/30 text-rose-950 hover:bg-rose-50/50"
                            : ""
                        }`}
                      >
                        <td className={`px-6 py-4 ${student.below_threshold ? "font-bold" : ""}`}>
                          {student.student_name}
                        </td>
                        <td className="px-6 py-4">{student.class_name}</td>
                        <td className="px-6 py-4">{student.sumatif_average ?? "—"}</td>
                        <td className="px-6 py-4">{student.formatif_average ?? "—"}</td>
                        <td className="px-6 py-4">
                          {student.below_threshold ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-100 text-rose-800 rounded-full text-xs font-black">
                              Di Bawah KKM
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-black">
                              Lulus KKM
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-400 text-center py-8 font-bold">
                Tidak ada data nilai siswa untuk filter terpilih.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
