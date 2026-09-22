import { useEffect, useMemo, useState } from "react";
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { Download, Printer, RotateCcw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { ManagementReviewProfileResponse } from "@operatoros/contracts/analytics";
import { exportManagementReviewProfile, type ManagementReviewProfileFilters } from "../api/managementReviewProfile";
import { PageHeader } from "../components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../context/AuthContext";
import { useAcademicAnalyticsOptionsQuery } from "../hooks/useAcademicAnalyticsQueries";
import { useAnalyticsFiltersQuery, useManagementReviewProfileQuery, useManagementReviewTermsQuery } from "../hooks/useAnalyticsQueries";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
type CountRow = { label: string; count: number; percentage: number };
const palette = ["#0f766e", "#2563eb", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d", "#475569"];
const numberParam = (params: URLSearchParams, name: string) => { const value = Number(params.get(name)); return Number.isInteger(value) && value > 0 ? value : null; };
const percent = (value: number) => `${Number(value.toFixed(1))}%`;

function Distribution({ title, rows, donut = false }: { title: string; rows: CountRow[]; donut?: boolean }) {
  const data = { labels: rows.map((value) => value.label), datasets: [{ label: "Siswa", data: rows.map((value) => value.count), backgroundColor: rows.map((_value, index) => palette[index % palette.length]) }] };
  return <Card className="break-inside-avoid"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="h-64" role="img" aria-label={`${title}: ${rows.map((value) => `${value.label} ${value.count}`).join(", ")}`}>{donut ? <Doughnut data={data} options={{ responsive: true, maintainAspectRatio: false }} /> : <Bar data={data} options={{ responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } } }} />}</div><table className="w-full text-sm"><caption className="sr-only">{title}</caption><thead><tr className="border-b"><th className="py-2 text-left">Kategori</th><th className="text-right">Jumlah</th><th className="text-right">Persentase</th></tr></thead><tbody>{rows.map((value) => <tr className="border-b" key={value.label}><th className="py-2 text-left font-medium">{value.label}</th><td className="text-right tabular-nums">{value.count}</td><td className="text-right tabular-nums">{percent(value.percentage)}</td></tr>)}</tbody></table></CardContent></Card>;
}
function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 100); }

export default function ManagementReviewStudentProfile() {
  const { can } = useAuth(); const canExport = can("export_student_data");
  const [search, setSearch] = useSearchParams(); const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null); const [exportError, setExportError] = useState("");
  const filterOptions = useAnalyticsFiltersQuery({}, true); const years = filterOptions.data?.academic_years ?? []; const jenjangs = filterOptions.data?.jenjangs ?? [];
  const academicYearId = numberParam(search, "academic_year_id"); const termId = numberParam(search, "term_id"); const jenjangId = numberParam(search, "jenjang_id"); const classId = numberParam(search, "class_id");
  const groupBy = (["kelurahan", "kecamatan", "city_regency", "province"].includes(search.get("residence_group_by") ?? "") ? search.get("residence_group_by") : "kelurahan") as ManagementReviewProfileFilters["residence_group_by"];
  const topN = search.get("residence_top_n") === "5" ? 5 : search.get("residence_top_n") === "all" ? "all" : 10;
  const termsQuery = useManagementReviewTermsQuery(academicYearId); const classesQuery = useAcademicAnalyticsOptionsQuery(academicYearId, jenjangId, true); const terms = termsQuery.data ?? []; const classes = classesQuery.data?.classes ?? [];
  const filters = useMemo<ManagementReviewProfileFilters | null>(() => academicYearId && termId ? { academic_year_id: academicYearId, term_id: termId, jenjang_id: jenjangId, class_id: classId, residence_group_by: groupBy, residence_top_n: topN } : null, [academicYearId, termId, jenjangId, classId, groupBy, topN]);
  const reportQuery = useManagementReviewProfileQuery(filters);
  const update = (values: Record<string, string | number | null>) => setSearch((current) => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(values)) value === null || value === "" ? next.delete(key) : next.set(key, String(value)); return next; });
  useEffect(() => { if (!academicYearId && years.length) update({ academic_year_id: (years.find((value) => value.is_default) ?? years[0])!.id }); }, [academicYearId, years]);
  useEffect(() => { if (academicYearId && terms.length && !terms.some((term) => term.id === termId)) { const today = new Date().toISOString().slice(0, 10); update({ term_id: (terms.find((term) => term.start_date <= today && term.end_date >= today) ?? terms[0])!.id, jenjang_id: null, class_id: null }); } }, [academicYearId, termId, terms]);
  useEffect(() => { if (classId && !classes.some((value) => value.id === classId)) update({ class_id: null }); }, [classId, classes]);
  const runExport = async (format: "pdf" | "xlsx") => { if (!filters) return; setExporting(format); setExportError(""); try { download(await exportManagementReviewProfile(format, filters), `management-review-student-profile.${format}`); } catch { setExportError(`Ekspor ${format.toUpperCase()} gagal.`); } finally { setExporting(null); } };

  if (filterOptions.isPending) return <LoadingState title="Memuat Management Review" description="Menyiapkan tahun akademik dan jenjang." />;
  if (filterOptions.error) return <ErrorState title="Management Review tidak dapat dimuat" description="Pilihan laporan tidak tersedia." action={<Button onClick={() => void filterOptions.refetch()}>Coba lagi</Button>} />;
  if (!years.length) return <EmptyState title="Tahun akademik belum tersedia" description="Konfigurasikan tahun akademik sebelum membuat laporan." />;
  const reset = () => setSearch({ academic_year_id: String((years.find((value) => value.is_default) ?? years[0])!.id) });
  const actions = <div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={reset}><RotateCcw className="mr-2 size-4" />Reset Filters</Button>{canExport && <><Button variant="outline" disabled={!filters || Boolean(exporting)} onClick={() => void runExport("xlsx")}><Download className="mr-2 size-4" />Excel</Button><Button variant="outline" disabled={!filters || Boolean(exporting)} onClick={() => void runExport("pdf")}><Download className="mr-2 size-4" />PDF</Button></>}<Button onClick={() => window.print()} disabled={!reportQuery.data}><Printer className="mr-2 size-4" />Print</Button></div>;
  if (termsQuery.isPending) return <LoadingState title="Memuat term" description="Memeriksa konfigurasi periode kanonik." />;
  if (!terms.length) return <div className="space-y-6"><PageHeader eyebrow="Management Review" title="Student Profile" description="Laporan profil siswa per term." actions={actions} /><EmptyState title="Term belum memiliki konfigurasi periode yang valid" description="Laporan diblokir karena periode term tidak boleh ditebak." action={<Link className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground" to="/academic-management">Buka konfigurasi term</Link>} /></div>;

  return <div className="space-y-7 pb-12 print:p-0"><PageHeader eyebrow="Management Review" title="Student Profile" description="Profil agregat siswa untuk populasi enrollment term yang dipilih." actions={actions} />
    <Card className="print:hidden"><CardHeader><CardTitle>Filter Laporan</CardTitle></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      <div><FieldLabel htmlFor="review-year">Academic Year</FieldLabel><NativeSelect id="review-year" value={academicYearId ?? ""} onChange={(event) => update({ academic_year_id: event.target.value, term_id: null, jenjang_id: null, class_id: null })}>{years.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="review-term">Term</FieldLabel><NativeSelect id="review-term" value={termId ?? ""} onChange={(event) => update({ term_id: event.target.value })}>{terms.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="review-jenjang">Jenjang</FieldLabel><NativeSelect id="review-jenjang" value={jenjangId ?? ""} onChange={(event) => update({ jenjang_id: event.target.value, class_id: null })}><option value="">Semua</option>{jenjangs.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="review-class">Class</FieldLabel><NativeSelect id="review-class" value={classId ?? ""} onChange={(event) => update({ class_id: event.target.value })}><option value="">Semua</option>{classes.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></div>
      <div><FieldLabel htmlFor="review-group">Tempat Tinggal</FieldLabel><NativeSelect id="review-group" value={groupBy} onChange={(event) => update({ residence_group_by: event.target.value })}><option value="kelurahan">Kelurahan</option><option value="kecamatan">Kecamatan</option><option value="city_regency">Kabupaten/Kota</option><option value="province">Provinsi</option></NativeSelect></div>
      <div><FieldLabel htmlFor="review-top">Tampilkan</FieldLabel><NativeSelect id="review-top" value={topN} onChange={(event) => update({ residence_top_n: event.target.value })}><option value="5">Top 5</option><option value="10">Top 10</option><option value="all">Semua</option></NativeSelect></div>
    </div></CardContent></Card>
    {exportError && <p role="alert" className="text-sm font-semibold text-destructive">{exportError}</p>}
    {(reportQuery.isPending || reportQuery.isFetching) && <LoadingState title="Menyiapkan profil siswa" description="Menghitung satu populasi siswa unik untuk term ini." />}
    {reportQuery.error && <ErrorState title="Laporan tidak dapat dimuat" description="Data agregat tidak tersedia. Nilai nol tidak ditampilkan sebagai pengganti error." action={<Button onClick={() => void reportQuery.refetch()}>Coba lagi</Button>} />}
    {reportQuery.data && <Report report={reportQuery.data} />}
  </div>;
}

function Report({ report }: { report: ManagementReviewProfileResponse }) {
  if (!report.summary.totalStudents) return <EmptyState title="Tidak ada siswa pada term ini" description="Populasi enrollment untuk filter yang dipilih kosong." />;
  const cards = [["Total Students", report.summary.totalStudents], ["Programs / Jenjang", report.summary.programs], ["Classes", report.summary.classes], ["Male", report.summary.male], ["Female", report.summary.female], ["Gender Not Specified", report.summary.genderNotSpecified], ["Profile Data Needs Completion", report.summary.needsCompletion]];
  return <div className="space-y-7"><div className="rounded-lg border bg-card p-5"><h2 className="text-xl font-black">{report.context.academicYearLabel} · {report.context.termLabel}</h2><p className="mt-1 text-sm text-muted-foreground">{report.context.termStart} – {report.context.termEnd} · Generated {new Date(report.context.generatedAt).toLocaleString("id-ID")}</p><p className="mt-2 text-sm font-semibold">{report.context.demographicSemantics}</p></div>
    <section><h2 className="mb-3 text-xl font-black">Student Summary</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <Card key={label}><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-black tabular-nums">{value}</p></CardContent></Card>)}</div></section>
    <Distribution title="Profil Siswa - Jenjang" rows={report.programs} />
    <div className="grid gap-7 xl:grid-cols-2"><Distribution title="Profil Siswa - Jenis Kelamin" rows={report.gender} donut /><Distribution title={`Profil Siswa - Tempat Tinggal (${report.residence.groupBy})`} rows={report.residence.rows} /></div>
    <div className="grid gap-7 xl:grid-cols-2"><Distribution title="Pekerjaan Ayah" rows={report.fatherOccupation} /><Distribution title="Pekerjaan Ibu" rows={report.motherOccupation} /></div>
    <Card><CardHeader><CardTitle>Data Quality</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-surface-muted p-4"><p>Complete for Management Review</p><strong className="text-2xl">{report.dataQuality.complete}</strong></div><div className="rounded-md bg-surface-muted p-4"><p>Needs Completion</p><strong className="text-2xl">{report.dataQuality.needsCompletion}</strong></div></div><p className="mt-4 text-sm text-muted-foreground">Optional profile fields are reported as missing, not invalid. Corrections remain in the existing Student Profile workflow.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Key Insights</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5">{report.insights.map((value) => <li key={value}>{value}</li>)}</ul></CardContent></Card>
    <p className="text-sm text-muted-foreground">OPR KPI Actual values remain operator-managed/manual because no canonical automated KPI source was identified.</p>
  </div>;
}
