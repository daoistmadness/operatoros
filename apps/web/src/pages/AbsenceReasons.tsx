import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";

import { getMonthlyClassAbsenceTotals, saveMonthlyClassAbsenceTotals } from "../api/manualAbsence";
import { getReportFilters, type ReportFiltersResponse } from "../api/reports";
import type { ManualAbsenceMonthlyResponse } from "@operatoros/contracts/reports";
import { getPageApiError } from "../lib/api/errors";
import { PageHeader } from "../components/common/page-header";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

type ManualClassRow = Omit<ManualAbsenceMonthlyResponse["classes"][number], "sakit" | "izin" | "alfa"> & {
  sakit: string; izin: string; alfa: string;
  original: { sakit: string; izin: string; alfa: string };
};

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function ManualAbsenceEntry() {
  const [filters, setFilters] = useState<ReportFiltersResponse | null>(null);
  const [academicYearId, setAcademicYearId] = useState(0);
  const [months, setMonths] = useState<ReportFiltersResponse["months"]>([]);
  const [month, setMonth] = useState("");
  const [rows, setRows] = useState<ManualClassRow[]>([]);
  const [jenjangId, setJenjangId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getReportFilters().then((value) => {
      setFilters(value);
      setAcademicYearId(value.default_academic_year_id ?? value.academic_years.at(-1)?.id ?? 0);
      setMonths(value.months);
      setMonth(value.months.find((item) => item.value === monthKey())?.value ?? value.months[0]?.value ?? "");
    }).catch((cause) => setError(getPageApiError(cause, "Gagal memuat tahun ajaran."))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!academicYearId || !filters) return;
    getReportFilters({ academic_year_id: academicYearId }).then((value) => {
      setMonths(value.months);
      if (!value.months.some((item) => item.value === month)) setMonth(value.months[0]?.value ?? "");
    }).catch((cause) => setError(getPageApiError(cause, "Gagal memuat bulan tahun ajaran.")));
  }, [academicYearId, filters]);

  useEffect(() => {
    if (!academicYearId || !month) return;
    setLoading(true);
    setError("");
    getMonthlyClassAbsenceTotals(academicYearId, month).then((value) => {
      setRows(value.classes.map((item) => {
        const original = { sakit: String(item.sakit), izin: String(item.izin), alfa: String(item.alfa) };
        return { ...item, ...original, original };
      }));
    }).catch((cause) => {
      setRows([]);
      setError(getPageApiError(cause, "Gagal memuat rekap manual."));
    }).finally(() => setLoading(false));
  }, [academicYearId, month]);

  const jenjangs = useMemo(() => Array.from(new Map(rows.map((item) => [item.jenjang_id, item.jenjang])).entries()), [rows]);
  const programs = useMemo(() => Array.from(new Map(rows.filter((item) => jenjangId === "all" || item.jenjang_id === Number(jenjangId)).map((item) => [item.program_id, item.program])).entries()), [rows, jenjangId]);
  const visibleRows = useMemo(() => rows.filter((item) =>
    (jenjangId === "all" || item.jenjang_id === Number(jenjangId)) &&
    (programId === "all" || item.program_id === Number(programId))), [rows, jenjangId, programId]);
  const changed = (item: ManualClassRow) => item.sakit !== item.original.sakit || item.izin !== item.original.izin || item.alfa !== item.original.alfa;
  const canSave = visibleRows.length > 0 && visibleRows.some((item) => !item.has_data || changed(item));

  const update = (classId: number, field: "sakit" | "izin" | "alfa", value: string) => {
    setRows((current) => current.map((item) => item.class_id === classId ? { ...item, [field]: value } : item));
    setMessage("");
  };

  const save = async () => {
    if (visibleRows.some((item) => [item.sakit, item.izin, item.alfa].some((value) => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))))) {
      setError("Sakit, Izin, dan Alfa harus berupa bilangan bulat nol atau lebih.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await saveMonthlyClassAbsenceTotals({
        academic_year_id: academicYearId,
        month,
        jenjang_id: jenjangId === "all" ? undefined : Number(jenjangId),
        program_id: programId === "all" ? undefined : Number(programId),
        classes: visibleRows.map((item) => ({
          class_id: item.class_id,
          sakit: Number(item.sakit),
          izin: Number(item.izin),
          alfa: Number(item.alfa),
        })),
      });
      setMessage(`Tersimpan: ${result.total} kelas untuk ${month}.`);
      const value = await getMonthlyClassAbsenceTotals(academicYearId, month);
      setRows(value.classes.map((item) => {
        const original = { sakit: String(item.sakit), izin: String(item.izin), alfa: String(item.alfa) };
        return { ...item, ...original, original };
      }));
    } catch (cause) {
      setError(getPageApiError(cause, "Gagal menyimpan rekap manual."));
    } finally {
      setSaving(false);
    }
  };

  const selectedYear = filters?.academic_years.find((value) => value.id === academicYearId);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader title="Rekap Manual Sakit / Izin / Alfa" description="Masukkan total bulanan per kelas untuk laporan manajemen." />

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Tahun Ajaran
            <select aria-label="Tahun Ajaran" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={academicYearId || ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setMonth(""); setJenjangId("all"); setProgramId("all"); }}>
              {filters?.academic_years.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Bulan
            <select aria-label="Bulan" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Jenjang
            <select aria-label="Jenjang" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={jenjangId} onChange={(event) => { setJenjangId(event.target.value); setProgramId("all"); }}>
              <option value="all">Semua jenjang</option>
              {jenjangs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Program
            <select aria-label="Program" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={programId} onChange={(event) => setProgramId(event.target.value)}>
              <option value="all">Semua program</option>
              {programs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>
        {selectedYear && <p className="text-xs text-slate-500">Periode data mengikuti {selectedYear.start_date} sampai {selectedYear.end_date}.</p>}
      </Card>

      {(error || message) && <div role={error ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
        <span className="inline-flex items-center gap-2">{error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{error || message}</span>
      </div>}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">Kelas — {months.find((value) => value.value === month)?.label ?? month}</h2>
            <p className="text-sm text-slate-500">Nilai awal nol belum dianggap tersimpan. Simpan untuk mengonfirmasi total setiap kelas.</p>
          </div>
          <Button onClick={save} disabled={saving || loading || !canSave}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Simpan Total Absensi Bulanan
          </Button>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Memuat kelas…</div> : visibleRows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Tidak ada kelas untuk Tahun Ajaran dan filter ini.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Kelas</th><th className="w-32 px-5 py-3 text-center">Sakit</th><th className="w-32 px-5 py-3 text-center">Izin</th><th className="w-32 px-5 py-3 text-center">Alfa</th><th className="w-44 px-5 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((item) => (
                  <tr key={item.class_id}>
                    <td className="px-5 py-3"><span className="font-semibold text-slate-900">{item.class_name}</span><span className="ml-2 text-xs text-slate-500">{item.jenjang} · {item.program} · {item.grade}</span></td>
                    {(["sakit", "izin", "alfa"] as const).map((field) => <td key={field} className="px-5 py-3">
                      <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${field} ${item.class_name}`} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center" value={item[field]} onChange={(event) => update(item.class_id, field, event.target.value)} />
                    </td>)}
                    <td className="px-5 py-3"><span className={item.has_data && !changed(item) ? "text-emerald-700" : "text-amber-700"}>{item.has_data && !changed(item) ? "Tersimpan" : changed(item) ? "Belum disimpan" : "Belum diisi"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default ManualAbsenceEntry;
