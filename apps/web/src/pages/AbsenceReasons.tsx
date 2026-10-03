import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";

import { getAttendanceBasis } from "../api/attendanceBasis";
import {
  getLegacyAbsenceReasons,
  getMonthlyClassAbsenceStudentTotals,
  getMonthlyClassAbsenceTotals,
  reopenMonthlyClassAbsenceLedger,
  saveMonthlyClassAbsenceTotals,
  submitMonthlyClassAbsenceLedger,
} from "../api/manualAbsence";
import { getReportFilters, type ReportFiltersResponse } from "../api/reports";
import type { AttendanceBasisClass } from "@operatoros/contracts/analytics";
import type {
  LegacyAbsenceReasonsResponse,
  ManualAbsenceMonthlyResponse,
  ManualAbsenceStudentTotalsResponse,
} from "@operatoros/contracts/reports";
import { useSearchParams } from "react-router-dom";
import { getPageApiError, isApiError } from "../lib/api/errors";
import { PageHeader } from "../components/common/page-header";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

type EntryMode = "TOTALS_ONLY" | "PER_STUDENT";
type Reasons = { sakit: string; izin: string; alfa: string };
type ManualClassRow = Omit<ManualAbsenceMonthlyResponse["classes"][number], keyof Reasons> & Reasons & {
  original: Reasons;
  draftMode: EntryMode;
};
type ManualStudentRow = Omit<ManualAbsenceStudentTotalsResponse["students"][number], keyof Reasons> & Reasons & { original: Reasons };
type LegacyRow = LegacyAbsenceReasonsResponse["rows"][number];

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function manualRows(value: ManualAbsenceMonthlyResponse): ManualClassRow[] {
  return value.classes.map((item) => {
    const original = { sakit: String(item.sakit), izin: String(item.izin), alfa: String(item.alfa) };
    return { ...item, ...original, original, draftMode: item.entry_mode ?? "TOTALS_ONLY" };
  });
}

function manualStudentRows(value: ManualAbsenceStudentTotalsResponse): ManualStudentRow[] {
  return value.students.map((item) => {
    const original = { sakit: String(item.sakit), izin: String(item.izin), alfa: String(item.alfa) };
    return { ...item, ...original, original };
  });
}

function isIntegerInput(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
}

function basisErrorMessage(cause: unknown) {
  if (isApiError(cause) && cause.code === "CANONICAL_CLASS_UNRESOLVED")
    return "Basis dan rekonsiliasi belum tersedia karena sebagian riwayat kelas kehadiran belum dapat dipetakan.";
  return getPageApiError(cause, "Gagal memuat basis kehadiran.");
}

function ManualAbsenceEntry() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<ReportFiltersResponse | null>(null);
  const [academicYearId, setAcademicYearId] = useState(() => Number(searchParams.get("academic_year_id")) || 0);
  const [months, setMonths] = useState<ReportFiltersResponse["months"]>([]);
  const [month, setMonth] = useState(() => searchParams.get("month") ?? "");
  const [rows, setRows] = useState<ManualClassRow[]>([]);
  const [students, setStudents] = useState<ManualStudentRow[]>([]);
  const [legacyRows, setLegacyRows] = useState<LegacyRow[]>([]);
  const [basisByClass, setBasisByClass] = useState<Map<number, AttendanceBasisClass>>(new Map());
  const [jenjangId, setJenjangId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [classId, setClassId] = useState(() => searchParams.get("class_id") ?? "all");
  const [loading, setLoading] = useState(true);
  const [studentLoading, setStudentLoading] = useState(false);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionClassId, setActionClassId] = useState<number | null>(null);
  const [studentRefresh, setStudentRefresh] = useState(0);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [error, setError] = useState("");
  const [basisError, setBasisError] = useState("");
  const [studentError, setStudentError] = useState("");
  const [legacyError, setLegacyError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmConflictClassId, setConfirmConflictClassId] = useState<number | null>(null);

  useEffect(() => {
    getReportFilters().then((value) => {
      setFilters(value);
      setAcademicYearId((current) => current || value.default_academic_year_id || value.academic_years.at(-1)?.id || 0);
      setMonths(value.months);
      setMonth((current) => value.months.some((item) => item.value === current)
        ? current
        : value.months.find((item) => item.value === monthKey())?.value ?? value.months[0]?.value ?? "");
    }).catch((cause) => setError(getPageApiError(cause, "Gagal memuat tahun ajaran."))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!academicYearId || !filters) return;
    getReportFilters({ academic_year_id: academicYearId }).then((value) => {
      setMonths(value.months);
      if (!value.months.some((item) => item.value === month)) setMonth(value.months[0]?.value ?? "");
    }).catch((cause) => setError(getPageApiError(cause, "Gagal memuat bulan tahun ajaran.")));
  }, [academicYearId, filters]);

  const loadMonth = useCallback(async () => {
    const [monthly, basis] = await Promise.allSettled([
      getMonthlyClassAbsenceTotals(academicYearId, month),
      getAttendanceBasis(academicYearId, month),
    ]);
    if (monthly.status === "rejected") throw monthly.reason;
    setRows(manualRows(monthly.value));
    setConfirmConflictClassId(null);
    if (basis.status === "fulfilled") {
      setBasisByClass(new Map(basis.value.classes.map((item) => [item.class_id, item])));
      setBasisError("");
    } else {
      setBasisByClass(new Map());
      setBasisError(basisErrorMessage(basis.reason));
    }
  }, [academicYearId, month]);

  useEffect(() => {
    if (!academicYearId || !month) return;
    setLoading(true);
    setError("");
    loadMonth().catch((cause) => {
      setRows([]);
      setError(getPageApiError(cause, "Gagal memuat rekap bulanan."));
    }).finally(() => setLoading(false));
  }, [academicYearId, month, loadMonth]);

  const refreshRows = async () => {
    await loadMonth();
    setStudentRefresh((value) => value + 1);
  };

  const jenjangs = useMemo(() => Array.from(new Map(rows.map((item) => [item.jenjang_id, item.jenjang])).entries()), [rows]);
  const programs = useMemo(() => Array.from(new Map(rows.filter((item) => jenjangId === "all" || item.jenjang_id === Number(jenjangId)).map((item) => [item.program_id, item.program])).entries()), [rows, jenjangId]);
  const classOptions = useMemo(() => rows.filter((item) =>
    (jenjangId === "all" || item.jenjang_id === Number(jenjangId))
    && (programId === "all" || item.program_id === Number(programId))), [rows, jenjangId, programId]);
  const visibleRows = classOptions.filter((item) => classId === "all" || item.class_id === Number(classId));
  const selectedClass = classId === "all" ? null : rows.find((item) => item.class_id === Number(classId)) ?? null;
  const selectedStudentClassId = selectedClass?.draftMode === "PER_STUDENT" ? selectedClass.class_id : null;

  useEffect(() => {
    if (!academicYearId || !month || selectedStudentClassId === null) {
      setStudents([]);
      setStudentError("");
      return;
    }
    let active = true;
    setStudentLoading(true);
    setStudentError("");
    getMonthlyClassAbsenceStudentTotals(academicYearId, month, selectedStudentClassId)
      .then((value) => {
        if (!active) return;
        // A background refresh (e.g. after save/submit/reopen) must not clobber
        // edits the user made while it was in flight; enrollment ids are unique.
        setStudents((current) => {
          const pending = new Map<number, ManualStudentRow>();
          for (const item of current)
            if (item.sakit !== item.original.sakit || item.izin !== item.original.izin || item.alfa !== item.original.alfa)
              pending.set(item.enrollment_id, item);
          const fresh = manualStudentRows(value);
          if (!pending.size) return fresh;
          return fresh.map((row) => {
            const dirty = pending.get(row.enrollment_id);
            return dirty ? { ...row, sakit: dirty.sakit, izin: dirty.izin, alfa: dirty.alfa } : row;
          });
        });
      })
      .catch((cause) => { if (active) { setStudents([]); setStudentError(getPageApiError(cause, "Gagal memuat daftar siswa kelas ini.")); } })
      .finally(() => { if (active) setStudentLoading(false); });
    return () => { active = false; };
  }, [academicYearId, month, selectedStudentClassId, studentRefresh]);

  useEffect(() => {
    if (!legacyOpen || !month) return;
    let active = true;
    setLegacyLoading(true);
    setLegacyError("");
    getLegacyAbsenceReasons(month)
      .then((value) => { if (active) setLegacyRows(value.rows); })
      .catch((cause) => { if (active) { setLegacyRows([]); setLegacyError(getPageApiError(cause, "Gagal memuat data historis legacy.")); } })
      .finally(() => { if (active) setLegacyLoading(false); });
    return () => { active = false; };
  }, [legacyOpen, month]);

  const changed = (item: ManualClassRow) => item.sakit !== item.original.sakit || item.izin !== item.original.izin || item.alfa !== item.original.alfa;
  const studentsChanged = students.some((item) => item.sakit !== item.original.sakit || item.izin !== item.original.izin || item.alfa !== item.original.alfa);
  const rowNeedsSave = (item: ManualClassRow) => {
    if (item.state === "SUBMITTED" || item.is_locked) return false;
    if (item.entry_mode !== null && item.entry_mode !== item.draftMode) return true;
    if (item.draftMode === "TOTALS_ONLY") return !item.has_data || changed(item);
    return !item.has_data || item.class_id === selectedStudentClassId && studentsChanged;
  };
  const canSave = visibleRows.some(rowNeedsSave);

  const clearFeedback = () => { setMessage(""); setConfirmConflictClassId(null); };
  const update = (id: number, field: keyof Reasons, value: string) => {
    setRows((current) => current.map((item) => item.class_id === id ? { ...item, [field]: value } : item));
    clearFeedback();
  };
  const updateMode = (item: ManualClassRow, draftMode: EntryMode) => {
    setRows((current) => current.map((value) => value.class_id === item.class_id ? { ...value, draftMode } : value));
    if (draftMode === "PER_STUDENT") setClassId(String(item.class_id));
    clearFeedback();
  };
  const updateStudent = (id: number, field: keyof Reasons, value: string) => {
    setStudents((current) => current.map((item) => item.enrollment_id === id ? { ...item, [field]: value } : item));
    clearFeedback();
  };

  const save = async () => {
    const changedRows = visibleRows.filter(rowNeedsSave);
    const invalidTotals = changedRows.some((item) => item.draftMode === "TOTALS_ONLY" && ![item.sakit, item.izin, item.alfa].every(isIntegerInput));
    const invalidStudentRows = selectedStudentClassId !== null && students.some((item) => ![item.sakit, item.izin, item.alfa].every(isIntegerInput));
    if (invalidTotals || invalidStudentRows) {
      setError("Sakit, Izin, dan Alfa harus berupa bilangan bulat nol atau lebih.");
      return;
    }
    setSaving(true);
    setError("");
    clearFeedback();
    try {
      const classes = [];
      for (const item of changedRows) {
        const changeMode = item.entry_mode !== null && item.entry_mode !== item.draftMode;
        let changeReason: string | undefined;
        if (changeMode) {
          changeReason = window.prompt(`Alasan mengubah mode rekap ${item.class_name}:`)?.trim();
          if (!changeReason || changeReason.length < 5) {
            setError("Alasan perubahan mode harus berisi sedikitnya lima karakter.");
            return;
          }
        }
        if (item.draftMode === "TOTALS_ONLY") classes.push({
          class_id: item.class_id, entry_mode: item.draftMode,
          sakit: Number(item.sakit), izin: Number(item.izin), alfa: Number(item.alfa), change_reason: changeReason,
        });
        else classes.push({
          class_id: item.class_id, entry_mode: item.draftMode, change_reason: changeReason,
          student_totals: item.class_id === selectedStudentClassId ? students
            .filter((student) => Number(student.sakit) + Number(student.izin) + Number(student.alfa) > 0)
            .map((student) => ({ enrollment_id: student.enrollment_id, sakit: Number(student.sakit), izin: Number(student.izin), alfa: Number(student.alfa) })) : [],
        });
      }
      const result = await saveMonthlyClassAbsenceTotals({
        academic_year_id: academicYearId, month,
        jenjang_id: jenjangId === "all" ? undefined : Number(jenjangId),
        program_id: programId === "all" ? undefined : Number(programId),
        classes,
      });
      setMessage(`Draf tersimpan: ${result.total} kelas untuk ${month}. Tinjau rekonsiliasi sebelum mengirim.`);
      await refreshRows();
    } catch (cause) {
      setError(getPageApiError(cause, "Gagal menyimpan rekap bulanan."));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (item: ManualClassRow) => {
    if (rowNeedsSave(item)) {
      setError("Simpan perubahan sebagai draf sebelum mengirim rekap kelas.");
      return;
    }
    const hasConflict = basisByClass.get(item.class_id)?.draft_conflict !== null && basisByClass.get(item.class_id)?.draft_conflict !== undefined;
    if (hasConflict && confirmConflictClassId !== item.class_id) {
      setConfirmConflictClassId(item.class_id);
      setMessage("Tinjau selisih Student-Days pada baris ini. Klik kirim sekali lagi untuk mengirim draf yang berbeda.");
      return;
    }
    setActionClassId(item.class_id); setError(""); setMessage("");
    try {
      await submitMonthlyClassAbsenceLedger({ academic_year_id: academicYearId, month, class_id: item.class_id });
      setMessage(`Rekap ${item.class_name} untuk ${month} berhasil dikirim.`);
      await refreshRows();
    } catch (cause) { setError(getPageApiError(cause, "Gagal mengirim rekap bulanan.")); }
    finally { setActionClassId(null); }
  };

  const reopen = async (item: ManualClassRow) => {
    const reason = window.prompt(`Alasan membuka kembali rekap ${item.class_name} untuk ${month}:`)?.trim();
    if (!reason) return;
    if (reason.length < 5) { setError("Alasan pembukaan kembali harus berisi sedikitnya lima karakter."); return; }
    setActionClassId(item.class_id); setError(""); setMessage("");
    try {
      await reopenMonthlyClassAbsenceLedger({ academic_year_id: academicYearId, month, class_id: item.class_id, reason });
      setMessage(`Rekap ${item.class_name} dibuka kembali.`);
      await refreshRows();
    } catch (cause) { setError(getPageApiError(cause, "Gagal membuka kembali rekap bulanan.")); }
    finally { setActionClassId(null); }
  };

  const selectedYear = filters?.academic_years.find((value) => value.id === academicYearId);
  const submittedCount = visibleRows.filter((item) => item.state === "SUBMITTED").length;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader title="Input Rekap Bulanan" description="Catat Sakit, Izin, dan Alfa sebagai Student-Days. Nilai manual tidak mengubah kehadiran harian." />

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Tahun Ajaran
            <select aria-label="Tahun Ajaran" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={academicYearId || ""} onChange={(event) => { setAcademicYearId(Number(event.target.value)); setMonth(""); setJenjangId("all"); setProgramId("all"); setClassId("all"); }}>
              {filters?.academic_years.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Bulan
            <select aria-label="Bulan" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={month} onChange={(event) => { setMonth(event.target.value); setClassId("all"); clearFeedback(); }}>
              {months.map((value) => <option key={value.value} value={value.value}>{value.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Jenjang
            <select aria-label="Jenjang" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={jenjangId} onChange={(event) => { setJenjangId(event.target.value); setProgramId("all"); setClassId("all"); }}>
              <option value="all">Semua jenjang</option>
              {jenjangs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Program
            <select aria-label="Program" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={programId} onChange={(event) => { setProgramId(event.target.value); setClassId("all"); }}>
              <option value="all">Semua program</option>
              {programs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Kelas
            <select aria-label="Kelas" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={classId} onChange={(event) => setClassId(event.target.value)}>
              <option value="all">Semua kelas</option>
              {classOptions.map((value) => <option key={value.class_id} value={value.class_id}>{value.class_name}</option>)}
            </select>
          </label>
        </div>
        {selectedYear && <p className="text-xs text-slate-500">Periode data mengikuti {selectedYear.start_date} sampai {selectedYear.end_date}.</p>}
      </Card>

      {(error || message) && <div role={error ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
        <span className="inline-flex items-center gap-2">{error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{error || message}</span>
      </div>}
      {basisError && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{basisError} Draf tetap terpisah dan tidak ditampilkan sebagai kehadiran teramati.</div>}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">Kelas — {months.find((value) => value.value === month)?.label ?? month}</h2>
            <p className="text-sm text-slate-500">Simpan membuat draf. Tinjau basis dan selisih sebelum mengirim setiap kelas.</p>
            <p aria-live="polite" className="mt-1 text-xs text-slate-500">{submittedCount} dari {visibleRows.length} kelas terkirim · {visibleRows.length - submittedCount} belum terkirim</p>
          </div>
          <Button onClick={save} disabled={saving || loading || !canSave}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Simpan Total Absensi Bulanan
          </Button>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Memuat kelas…</div> : visibleRows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Tidak ada kelas untuk Tahun Ajaran dan filter ini.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th scope="col" className="px-5 py-3">Kelas</th><th scope="col" className="px-5 py-3">Mode</th><th scope="col" className="w-24 px-4 py-3 text-center">Sakit</th><th scope="col" className="w-24 px-4 py-3 text-center">Izin</th><th scope="col" className="w-24 px-4 py-3 text-center">Alfa</th><th scope="col" className="px-5 py-3">Status · Expected Student-Days</th><th scope="col" className="min-w-[300px] px-5 py-3">Basis dan rekonsiliasi</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((item) => {
                  const basis = basisByClass.get(item.class_id);
                  const conflict = basis?.draft_conflict ?? basis?.conflict;
                  const unsaved = rowNeedsSave(item);
                  const reasonFields = ["sakit", "izin", "alfa"] as const;
                  const displayedTotal = (field: keyof Reasons) => {
                    if (item.draftMode !== "PER_STUDENT") return item[field];
                    if (item.class_id !== selectedStudentClassId) return item.entry_mode === "PER_STUDENT" ? item[field] : "0";
                    if (students.some((student) => !isIntegerInput(student[field]))) return "—";
                    return String(students.reduce((total, student) => total + Number(student[field]), 0));
                  };
                  return (
                    <tr key={item.class_id}>
                      <td className="px-5 py-3"><span className="font-semibold text-slate-900">{item.class_name}</span><span className="ml-2 text-xs text-slate-500">{item.jenjang} · {item.program} · {item.grade}</span></td>
                      <td className="px-4 py-3">
                        <select aria-label={`Mode input ${item.class_name}`} value={item.draftMode} disabled={item.state === "SUBMITTED" || item.is_locked} onChange={(event) => updateMode(item, event.target.value as EntryMode)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 disabled:bg-slate-100">
                          <option value="TOTALS_ONLY">Total kelas</option><option value="PER_STUDENT">Per siswa</option>
                        </select>
                        {item.draftMode === "PER_STUDENT" && classId !== String(item.class_id) && <button type="button" onClick={() => setClassId(String(item.class_id))} className="mt-1 block text-xs font-semibold text-brand underline">Input per siswa</button>}
                      </td>
                      {reasonFields.map((field) => <td key={field} className="px-4 py-3 text-center">
                        {item.draftMode === "TOTALS_ONLY" ? <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${field} ${item.class_name}`} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center disabled:bg-slate-100" value={item[field]} disabled={item.state === "SUBMITTED" || item.is_locked} onChange={(event) => update(item.class_id, field, event.target.value)} /> : <span aria-label={`${field} ${item.class_name}`} className="font-semibold text-slate-700">{displayedTotal(field)}</span>}
                      </td>)}
                      <td className="px-5 py-3">
                        <span className={item.is_locked ? "text-rose-700" : item.state === "SUBMITTED" ? "text-emerald-700" : "text-amber-700"}>{item.is_locked ? "Dikunci oleh periode finalized" : item.state === "SUBMITTED" ? "Terkirim" : item.state === "OPEN" ? unsaved ? "Draf berubah" : "Draft" : unsaved ? "Belum disimpan" : "Belum diisi"}</span>
                        <span className="ml-2 block text-xs text-slate-500">{item.expected_student_days} hari-siswa · {item.draftMode === "TOTALS_ONLY" ? "total kelas" : "total diturunkan dari siswa"}</span>
                        {item.state === "OPEN" && <button type="button" onClick={() => submit(item)} disabled={saving || actionClassId !== null || item.is_locked || unsaved} className="mt-1 text-xs font-semibold text-brand underline disabled:opacity-50">{actionClassId === item.class_id ? "Mengirim…" : conflict ? confirmConflictClassId === item.class_id ? "Kirim dengan selisih" : "Tinjau selisih" : "Kirim"}</button>}
                        {item.state === "SUBMITTED" && <button type="button" onClick={() => reopen(item)} disabled={saving || actionClassId !== null || item.is_locked} className="mt-1 text-xs font-semibold text-brand underline disabled:opacity-50">{actionClassId === item.class_id ? "Membuka…" : "Buka kembali"}</button>}
                      </td>
                      <td className="px-5 py-3 align-top text-xs text-slate-600">
                        {basis ? <>
                          <p className="font-semibold text-slate-800">{basis.basis === "OBSERVED" ? "Tercatat" : basis.basis === "DECLARED" ? "Dilaporkan" : "Belum dilaporkan"}</p>
                          <p>Hadir {basis.canonical.hadir_count} · Sakit {basis.canonical.sakit_count} · Izin {basis.canonical.izin_count} · Alfa {basis.canonical.alfa_count}</p>
                          <p>Recorded {basis.canonical.recorded_student_days}/{basis.canonical.expected_student_days} · Unrecorded {basis.canonical.unrecorded_student_days} · Coverage {basis.canonical.coverage_rate === null ? "—" : `${basis.canonical.coverage_rate.toFixed(1)}%`}</p>
                          {basis.presumed_hadir_student_days !== null && <p className="font-semibold">Hadir dihitung: {basis.presumed_hadir_student_days} hari-siswa</p>}
                          {basis.draft && <p>Draf S/I/A: {basis.draft.sakit_student_days}/{basis.draft.izin_student_days}/{basis.draft.alfa_student_days}</p>}
                          {unsaved && <p>Simpan draf untuk memperbarui rekonsiliasi.</p>}
                          {conflict && <p role="alert" className="mt-1 rounded bg-rose-50 p-2 font-semibold text-rose-800">Selisih {conflict.class_name}: kanonis {conflict.canonical_non_hadir_student_days}, {basis.draft_conflict ? "draf" : "dilaporkan"} {conflict.declared_absence_student_days}, delta {conflict.delta_student_days} hari-siswa.</p>}
                          {!conflict && basis.draft_reconciliation?.status === "NOT_COMPARABLE" && <p>Rekonsiliasi draf belum dapat dibandingkan: {basis.draft_reconciliation.reason_code}.</p>}
                          {basis.reconciliation.status === "NOT_COMPARABLE" && <p>Rekonsiliasi tersimpan: {basis.reconciliation.reason_code}.</p>}
                        </> : basisError ? <p>Basis tidak tersedia.</p> : <p>Memuat basis…</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedStudentClassId !== null && <Card className="overflow-hidden p-0" aria-label={`Sakit Izin Alfa per siswa ${selectedClass?.class_name ?? ""}`}>
        <div className="border-b border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">Sakit, Izin, dan Alfa per siswa — {selectedClass?.class_name}</h2>
          <p className="text-sm text-slate-500">Daftar mengikuti kelas historis pada hari sekolah di bulan ini. Nilai kelas di atas dihitung dari baris siswa.</p>
        </div>
        {studentLoading ? <div className="p-8 text-center text-sm text-slate-500">Memuat daftar siswa…</div> : studentError ? <div role="alert" className="p-5 text-sm text-rose-700">{studentError}</div> : students.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Tidak ada Student-Days yang diharapkan untuk kelas ini pada bulan tersebut.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-5 py-3">Siswa</th><th scope="col" className="px-5 py-3">Expected Student-Days</th><th scope="col" className="px-5 py-3">Sakit</th><th scope="col" className="px-5 py-3">Izin</th><th scope="col" className="px-5 py-3">Alfa</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((student) => <tr key={student.enrollment_id}>
                  <td className="px-5 py-3 font-semibold text-slate-900">{student.student_name}</td><td className="px-5 py-3">{student.expected_student_days} hari-siswa</td>
                  {(["sakit", "izin", "alfa"] as const).map((field) => <td key={field} className="px-5 py-3"><input type="number" min="0" step="1" inputMode="numeric" aria-label={`${field} ${student.student_name}`} value={student[field]} disabled={selectedClass?.state === "SUBMITTED" || selectedClass?.is_locked} onChange={(event) => updateStudent(student.enrollment_id, field, event.target.value)} className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-center disabled:bg-slate-100" /></td>)}
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>}

      <Card className="p-5">
        <details onToggle={(event) => setLegacyOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold text-slate-900">Data siswa legacy — historis, read-only, tidak masuk total terpadu</summary>
          <p className="mt-3 text-sm text-slate-600">Tabel lama hanya menyimpan bulan kalender, ID siswa lama, dan nama kelas teks. Baris ini tidak menjadi dasar kehadiran atau alasan siswa yang baru dilaporkan.</p>
          {legacyLoading ? <p className="mt-4 text-sm text-slate-500">Memuat data legacy…</p> : legacyError ? <p role="alert" className="mt-4 text-sm text-rose-700">{legacyError}</p> : legacyRows.length === 0 ? <p className="mt-4 text-sm text-slate-500">Tidak ada baris legacy untuk {month}.</p> : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-4 py-3">Siswa</th><th scope="col" className="px-4 py-3">Kelas teks lama</th><th scope="col" className="px-4 py-3">Sakit</th><th scope="col" className="px-4 py-3">Izin</th><th scope="col" className="px-4 py-3">Alfa</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{legacyRows.map((item, index) => <tr key={`${item.class_name}-${item.student_name}-${index}`}><td className="px-4 py-3">{item.student_name}</td><td className="px-4 py-3">{item.class_name ?? "—"}</td><td className="px-4 py-3">{item.sakit}</td><td className="px-4 py-3">{item.izin}</td><td className="px-4 py-3">{item.alfa}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </details>
      </Card>
    </div>
  );
}

export default ManualAbsenceEntry;
