import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Filter, Loader2, Printer } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { downloadReportBlob } from "../api/reports";
import { downloadRekapAbsensiExcel, getRekapAbsensiReport, type RekapReport, type ReportQuery } from "../lib/api/endpoints";
import { getPageApiError } from "../lib/api/errors";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { FilterBar } from "../components/common/filter-bar";
import { PageHeader } from "../components/common/page-header";
import { FormField, FieldLabel } from "../components/ui/field";
import { NativeSelect } from "../components/ui/native-select";
import { useAttendanceEffectiveTermsQuery } from "../hooks/useAnalyticsQueries";
import { useReportFilters } from "../hooks/useReportQueries";

const PERIODS = [
  { value: "month", label: "Bulan" },
  { value: "term", label: "Term" },
  { value: "date_range", label: "Rentang Tanggal" },
  { value: "yearly", label: "Tahun Ajaran" },
] as const;
type PeriodType = typeof PERIODS[number]["value"];

function display(value: number | null) {
  return value === null ? "Belum diinput" : value.toLocaleString("id-ID");
}

function RekapAbsensi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [academicYearId, setAcademicYearId] = useState(() => Number(searchParams.get("academic_year_id")) || 0);
  const [periodType, setPeriodType] = useState<PeriodType>(() => PERIODS.some((item) => item.value === searchParams.get("period_type")) ? searchParams.get("period_type") as PeriodType : "month");
  const [period, setPeriod] = useState(() => searchParams.get("period") ?? "");
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("start_date") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("end_date") ?? "");
  const [report, setReport] = useState<RekapReport | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const filtersQuery = useReportFilters(academicYearId || null, "combined");
  const termsQuery = useAttendanceEffectiveTermsQuery(academicYearId || null);
  const filters = filtersQuery.data ?? null;
  const months = filters?.months ?? [];
  const terms = termsQuery.data ?? [];
  const loading = filtersQuery.isPending || Boolean(academicYearId && termsQuery.isPending);

  useEffect(() => {
    if (!academicYearId && filters) setAcademicYearId(filters.default_academic_year_id ?? filters.academic_years.at(-1)?.id ?? 0);
  }, [academicYearId, filters]);
  useEffect(() => {
    if (!academicYearId || !filters) return;
    const selected = filters.academic_years.find((year) => year.id === academicYearId);
    if (selected) {
      setDateFrom((current) => current || selected.start_date);
      setDateTo((current) => current || selected.end_date);
    }
  }, [academicYearId, filters]);
  useEffect(() => {
    if (filtersQuery.error || termsQuery.error) setError(getPageApiError(filtersQuery.error ?? termsQuery.error, "Gagal memuat pilihan laporan."));
  }, [filtersQuery.error, termsQuery.error]);
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const values: Record<string, string | number | null> = {
      academic_year_id: academicYearId || null,
      period_type: periodType,
      period: periodType === "date_range" ? null : period,
      start_date: periodType === "date_range" ? dateFrom : null,
      end_date: periodType === "date_range" ? dateTo : null,
    };
    for (const [key, value] of Object.entries(values)) value === null || value === "" ? next.delete(key) : next.set(key, String(value));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [academicYearId, dateFrom, dateTo, period, periodType, searchParams, setSearchParams]);

  const options = useMemo(() => {
    if (periodType === "month") return months;
    if (periodType === "term") return terms.map((term) => ({ value: String(term.term_number), label: `${term.label} (${term.start_date} – ${term.end_date})` }));
    if (periodType === "yearly") return [{ value: "all", label: "Seluruh Tahun Ajaran" }];
    return [{ value: "custom", label: "Pilih tanggal mulai dan akhir" }];
  }, [months, periodType, terms]);

  useEffect(() => {
    if (!options.some((option) => option.value === period)) setPeriod(options[0]?.value ?? "");
  }, [options, period]);

  const query = useMemo<ReportQuery>(() => ({
    academic_year_id: academicYearId,
    period_type: periodType,
    period: periodType === "date_range" ? `${dateFrom}..${dateTo}` : period,
    ...(periodType === "date_range" ? { start_date: dateFrom, end_date: dateTo } : {}),
  }), [academicYearId, dateFrom, dateTo, period, periodType]);

  async function generate() {
    setWorking(true); setError("");
    try { setReport(await getRekapAbsensiReport(query)); }
    catch (cause) { setReport(null); setError(getPageApiError(cause, "Gagal membuat rekap absensi.")); }
    finally { setWorking(false); }
  }

  async function exportExcel() {
    setWorking(true); setError("");
    try {
      const exportQuery: ReportQuery = report ? {
        academic_year_id: report.scope.academic_year_id,
        period_type: report.scope.period_type,
        period: report.scope.period,
        ...(report.scope.period_type === "date_range" ? { start_date: report.scope.start_date, end_date: report.scope.end_date } : {}),
      } : query;
      const blob = await downloadRekapAbsensiExcel(exportQuery);
      downloadReportBlob(blob, `rekap-absensi-${report?.scope.period ?? period}.xlsx`);
    } catch (cause) { setError(getPageApiError(cause, "Gagal mengunduh Excel.")); }
    finally { setWorking(false); }
  }

  function printReport() {
    const cleanup = () => document.body.classList.remove("printing-rekap-absensi");
    document.body.classList.add("printing-rekap-absensi");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  const manual = report?.manual_absence;
  const basisRows = report?.attendance_basis ?? [];
  const basisError = report?.attendance_basis_unavailable_reason;
  return <div className="space-y-6 pb-12">
    <style>{`@media print {
      .no-print { display: none !important; }
      body.printing-rekap-absensi .app-sidebar { display: none !important; }
      body.printing-rekap-absensi .app-main { margin-left: 0 !important; padding: 0 !important; }
      body.printing-rekap-absensi .report-print-area { padding: 0 !important; }
      body.printing-rekap-absensi .report-section { box-shadow: none !important; border-radius: 0 !important; border-color: #cbd5e1 !important; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
    }`}</style>
    <div className="no-print"><PageHeader title="Rekap Absensi" description="Rekap manual Sakit, Izin, dan Alfa per kelas." actions={report && <div className="flex gap-2"><Button variant="outline" onClick={printReport} disabled={working}><Printer size={16} /> Cetak</Button><Button variant="outline" onClick={exportExcel} disabled={working}><Download size={16} /> Ekspor Excel</Button></div>} /></div>
    <FilterBar className="no-print p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3"><Filter size={17} className="text-brand" /><h2 className="font-semibold text-slate-800">Filter Laporan</h2></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="rekap-year"><FieldLabel>Tahun Ajaran</FieldLabel><NativeSelect value={academicYearId || ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setDateFrom(""); setDateTo(""); setReport(null); }}>
          {filters?.academic_years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
        </NativeSelect></FormField>
        <FormField id="rekap-period-type"><FieldLabel>Periode</FieldLabel><NativeSelect value={periodType} onChange={(event) => { setPeriodType(event.target.value as PeriodType); setPeriod(""); setReport(null); }}>
          {PERIODS.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}
        </NativeSelect></FormField>
        {periodType !== "date_range" && <FormField id="rekap-period"><FieldLabel>Pilih periode</FieldLabel><NativeSelect value={period} onChange={(event) => setPeriod(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect></FormField>}
        {periodType === "date_range" && <>
          <FormField id="rekap-date-from"><FieldLabel>Dari tanggal</FieldLabel><input id="rekap-date-from" className="h-10 rounded-md border border-input bg-background px-3 text-sm" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></FormField>
          <FormField id="rekap-date-to"><FieldLabel>Sampai tanggal</FieldLabel><input id="rekap-date-to" className="h-10 rounded-md border border-input bg-background px-3 text-sm" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></FormField>
        </>}
      </div>
      <div className="mt-4"><Button onClick={generate} disabled={loading || working || !academicYearId || !period || periodType === "date_range" && (!dateFrom || !dateTo)}><FileText size={16} /> Buat Laporan</Button></div>
    </FilterBar>
      {error && <p role="alert" className="no-print rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    {basisError && <p role="status" className="no-print rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Rekonsiliasi basis tidak tersedia: {basisError}.</p>}
    {(loading || working) && <div role="status" className="no-print flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Memuat laporan…</div>}
    {manual && report && <section className="report-print-area">
      <Card className="report-section space-y-4 p-5">
      <header><h2 className="text-xl font-bold text-slate-900">Rekap Manual Sakit / Izin / Alfa</h2><p className="text-sm text-slate-500">Sumber: Input total bulanan per kelas. Tahun Ajaran {report.scope.academic_year_label} · {report.scope.start_date} – {report.scope.end_date}</p></header>
      <div className={manual.completeness.complete ? "text-sm text-emerald-700" : "text-sm text-amber-700"}>
        Data manual {manual.completeness.complete ? "lengkap" : "belum lengkap"}: {manual.completeness.completed_class_month_entries}/{manual.completeness.expected_class_month_entries} entri kelas-bulan.
      </div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-3 pr-4">Kelas</th><th className="py-3 pr-4">Jenjang</th><th className="py-3 pr-4">Sakit</th><th className="py-3 pr-4">Izin</th><th className="py-3 pr-4">Alfa</th><th className="py-3 pr-4">Status</th></tr></thead>
        <tbody>{manual.classes.map((value) => <tr key={value.class_id} className="border-b border-slate-100"><td className="py-3 pr-4 font-medium">{value.class_name}</td><td className="py-3 pr-4">{value.jenjang}</td><td className="py-3 pr-4">{display(value.sakit)}</td><td className="py-3 pr-4">{display(value.izin)}</td><td className="py-3 pr-4">{display(value.alfa)}</td><td className="py-3 pr-4">{value.missing_months.length ? `Belum diinput: ${value.missing_months.join(", ")}` : "Lengkap"}</td></tr>)}
        <tr className="bg-slate-50 font-bold"><td className="py-3 pr-4">TOTAL</td><td /><td className="py-3 pr-4">{display(manual.totals.sakit)}</td><td className="py-3 pr-4">{display(manual.totals.izin)}</td><td className="py-3 pr-4">{display(manual.totals.alfa)}</td><td /></tr></tbody></table></div>
      {manual.completeness.missing.length > 0 && <div className="no-print text-sm text-amber-800"><h3 className="font-semibold">Entri belum diisi</h3><ul className="list-disc pl-5">{manual.completeness.missing.map((value) => <li key={`${value.class_id}-${value.month}`}>{value.class_name} / {value.month}: Belum diinput</li>)}</ul></div>}
      </Card>
      <Card className="report-section space-y-4 p-5">
        <header><h2 className="text-xl font-bold text-slate-900">Basis and Reconciliation</h2><p className="text-sm text-slate-500">Server-resolved class-month values. Sakit, Izin, and Alfa use Student-Days.</p></header>
        <div className="overflow-x-auto"><table className="min-w-[1050px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-3 pr-4">Class / month</th><th className="py-3 pr-4">Basis</th><th className="py-3 pr-4">Canonical S / I / A</th><th className="py-3 pr-4">Declared S / I / A</th><th className="py-3 pr-4">Coverage</th><th className="py-3 pr-4">Reconciliation</th></tr></thead><tbody>
          {basisRows.map((basis) => {
            const conflict = basis.conflict;
            const coverage = basis.canonical.coverage_rate;
            const inputHref = `/attendance/monthly-recap?academic_year_id=${academicYearId}&month=${basis.month}&class_id=${basis.class_id}`;
            return <tr key={`${basis.class_id}-${basis.month}`} className="border-b border-slate-100 align-top">
              <th scope="row" className="py-3 pr-4 text-left font-semibold">{basis.class_name}<span className="block text-xs font-normal text-slate-500">{basis.month} · {basis.jenjang} · {basis.program}</span></th>
              <td className="py-3 pr-4">{basis.basis === "OBSERVED" ? "Tercatat" : basis.basis === "DECLARED" ? "Dilaporkan" : "Belum dilaporkan"}</td>
              <td className="py-3 pr-4">{basis.canonical.sakit_count} / {basis.canonical.izin_count} / {basis.canonical.alfa_count}</td>
              <td className="py-3 pr-4">{basis.declared.sakit_student_days ?? "—"} / {basis.declared.izin_student_days ?? "—"} / {basis.declared.alfa_student_days ?? "—"}</td>
              <td className="py-3 pr-4">Recorded {basis.canonical.recorded_student_days}/{basis.canonical.expected_student_days}<br />Unrecorded {basis.canonical.unrecorded_student_days} · {coverage === null ? "—" : `${coverage.toFixed(1)}%`}{basis.basis === "OBSERVED" && basis.canonical.unrecorded_student_days > 0 && <span className="block font-semibold text-amber-700">Data belum lengkap</span>}{basis.basis === "DECLARED" && basis.lateness.availability === "UNAVAILABLE" && <span className="block font-semibold">Lateness data unavailable</span>}</td>
              <td className="py-3 pr-4">{conflict ? <div role="alert" className="space-y-1 text-rose-800"><strong>Conflict: canonical non-Hadir {conflict.canonical_non_hadir_student_days}; declared {conflict.declared_absence_student_days}; delta {conflict.delta_student_days} Student-Days.</strong><p>Delta = declared S/I/A total minus canonical non-Hadir Student-Days.</p><Link className="font-semibold underline" to={inputHref}>Review class-month</Link></div> : basis.reconciliation.status === "NOT_COMPARABLE" ? `Not comparable: ${basis.reconciliation.reason_code}` : basis.reconciliation.status === "MATCH" ? "Matches" : basis.basis === "NOT_REPORTED" ? "Not reported" : "No conflict"}</td>
            </tr>;
          })}
        </tbody></table></div>
        {basisRows.length === 0 && !basisError && <p className="text-sm text-slate-500">No class-month basis rows are available for this period.</p>}
      </Card>
    </section>}
  </div>;
}

export default RekapAbsensi;
