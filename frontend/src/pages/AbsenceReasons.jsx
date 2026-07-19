import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Copy, Loader2, Save, Wand2 } from "lucide-react";

import api from "../api";
import { getPageApiError } from "../lib/api/errors";
import { PageHeader } from "../components/common/page-header";

const MONTH_OPTIONS = [
  { value: 1, label: "Januari" },
  { value: 2, label: "Februari" },
  { value: 3, label: "Maret" },
  { value: 4, label: "April" },
  { value: 5, label: "Mei" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "Agustus" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Desember" },
];

const ENTERED_BY_STORAGE_KEY = "absence-reasons-entered-by";

function getMonthLabel(month) {
  return MONTH_OPTIONS.find((item) => item.value === Number(month))?.label || `Bulan ${month}`;
}

function getMonthKey(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(month, year, delta) {
  const anchor = new Date(year, month - 1 + delta, 1);
  return { month: anchor.getMonth() + 1, year: anchor.getFullYear() };
}

function buildMonthRange(earliestDate, latestDate) {
  if (!earliestDate || !latestDate) {
    return [];
  }

  const result = [];
  const current = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  const end = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);

  while (current <= end) {
    result.push({ month: current.getMonth() + 1, year: current.getFullYear() });
    current.setMonth(current.getMonth() + 1);
  }

  return result;
}

function AbsenceReasons() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [enteredBy, setEnteredBy] = useState(() => window.localStorage.getItem(ENTERED_BY_STORAGE_KEY) || "");
  const [rows, setRows] = useState([]);
  const [originalRows, setOriginalRows] = useState({});
  const [coverageRows, setCoverageRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ visible: false, type: "success", text: "" });
  const [recentlySavedClasses, setRecentlySavedClasses] = useState([]);
  const [quickFillJenjang, setQuickFillJenjang] = useState("");
  const [quickFillForm, setQuickFillForm] = useState({ sakit: 0, izin: 0, alfa: 0 });
  const feedbackRef = useRef(null);
  const tableSectionRef = useRef(null);
  const inputRefs = useRef({});

  useEffect(() => {
    window.localStorage.setItem(ENTERED_BY_STORAGE_KEY, enteredBy);
  }, [enteredBy]);

  useEffect(() => {
    if (!toast.visible) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [toast.visible, toast.text, toast.type]);

  const fetchRows = useCallback(async (targetMonth = month, targetYear = year) => {
    setLoading(true);
    setError("");

    try {
      const response = await api.get("/api/config/absence-reasons", {
        params: { month: targetMonth, year: targetYear },
      });
      const nextRows = (Array.isArray(response.data) ? response.data : []).map((row) => ({
        ...row,
        sakit: Number(row.sakit || 0),
        izin: Number(row.izin || 0),
        alfa: Number(row.alfa || 0),
        note: row.note || "",
        dirty: false,
      }));

      setRows(nextRows);
      setOriginalRows(
        nextRows.reduce((accumulator, row) => {
          accumulator[row.class_name] = {
            sakit: Number(row.sakit || 0),
            izin: Number(row.izin || 0),
            alfa: Number(row.alfa || 0),
            note: row.note || "",
          };
          return accumulator;
        }, {})
      );
    } catch (err) {
      setRows([]);
      setOriginalRows({});
      setError(getPageApiError(err, "Gagal memuat data SIA."));
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  const fetchCoverage = useCallback(async () => {
    try {
      const rangeResponse = await api.get("/api/analytics/attendance-date-range");
      const earliestText = rangeResponse.data?.earliest_date;
      const latestText = rangeResponse.data?.latest_date;

      if (!earliestText || !latestText) {
        setCoverageRows([]);
        return;
      }

      const range = buildMonthRange(new Date(earliestText), new Date(latestText));
      if (range.length === 0) {
        setCoverageRows([]);
        return;
      }

      const results = await Promise.all(
        range.map(async (item) => {
          const response = await api.get("/api/config/absence-reasons", {
            params: { month: item.month, year: item.year },
          });
          const data = Array.isArray(response.data) ? response.data : [];
          const missingCount = data.filter((row) => !row.has_data).length;
          return {
            ...item,
            totalClasses: data.length,
            missingCount,
            enteredCount: data.length - missingCount,
          };
        })
      );

      setCoverageRows(results.filter((item) => item.missingCount > 0));
    } catch (err) {
      setCoverageRows([]);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  const updateRow = useCallback((className, field, value) => {
    setRows((previousRows) =>
      previousRows.map((row) => {
        if (row.class_name !== className) {
          return row;
        }

        const nextValue = field === "note" ? value : Math.max(0, Number(value || 0));
        const nextRow = { ...row, [field]: nextValue };
        const original = originalRows[className] || { sakit: 0, izin: 0, alfa: 0, note: "" };

        return {
          ...nextRow,
          dirty:
            Number(nextRow.sakit) !== Number(original.sakit) ||
            Number(nextRow.izin) !== Number(original.izin) ||
            Number(nextRow.alfa) !== Number(original.alfa) ||
            (nextRow.note || "") !== (original.note || ""),
        };
      })
    );
    setRecentlySavedClasses((previous) => previous.filter((item) => item !== className));
  }, [originalRows]);

  const groupedRows = useMemo(() => {
    return rows.reduce((accumulator, row) => {
      if (!accumulator[row.jenjang]) {
        accumulator[row.jenjang] = [];
      }
      accumulator[row.jenjang].push(row);
      return accumulator;
    }, {});
  }, [rows]);

  const modifiedRows = useMemo(() => rows.filter((row) => row.dirty), [rows]);
  const firstMissingCoverage = coverageRows[0] || null;
  const previousMonth = useMemo(() => shiftMonth(month, year, -1), [month, year]);

  const handleSaveAll = async () => {
    if (!enteredBy.trim()) {
      setError("Kolom 'Diisi oleh' wajib diisi.");
      setToast({ visible: true, type: "error", text: "Kolom 'Diisi oleh' wajib diisi." });
      return;
    }

    if (modifiedRows.length === 0) {
      setMessage("Tidak ada perubahan untuk disimpan.");
      setToast({ visible: true, type: "success", text: "Tidak ada perubahan untuk disimpan." });
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const savedClassNames = modifiedRows.map((row) => row.class_name);
      const response = await api.post("/api/config/absence-reasons/bulk", {
        entries: modifiedRows.map((row) => ({
          class_name: row.class_name,
          month,
          year,
          sakit: Number(row.sakit || 0),
          izin: Number(row.izin || 0),
          alfa: Number(row.alfa || 0),
          note: row.note || "",
          entered_by: enteredBy.trim(),
        })),
      });
      const inserted = Number(response.data?.inserted || 0);
      const updated = Number(response.data?.updated || 0);
      const totalSaved = Number(response.data?.total || modifiedRows.length);
      setRecentlySavedClasses(savedClassNames);
      setMessage(
        `Berhasil menyimpan ${totalSaved} kelas untuk ${getMonthLabel(month)} ${year} ` +
        `(baru: ${inserted}, diperbarui: ${updated}).`
      );
      setToast({
        visible: true,
        type: "success",
        text: `SIA ${getMonthLabel(month)} ${year} tersimpan: ${totalSaved} kelas.`,
      });
      await Promise.all([fetchRows(month, year), fetchCoverage()]);
      window.setTimeout(() => {
        feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      window.setTimeout(() => {
        setRecentlySavedClasses([]);
      }, 6000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const errorText = detail.map((item) => `${item.class_name || "(tanpa kelas)"}: ${item.errors.join(", ")}`).join(" | ");
        setError(errorText);
        setToast({ visible: true, type: "error", text: errorText });
      } else {
        const errorText = detail || "Gagal menyimpan data SIA.";
        setError(errorText);
        setToast({ visible: true, type: "error", text: errorText });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPreviousMonth = async () => {
    setError("");
    setMessage("");

    try {
      const response = await api.get("/api/config/absence-reasons", {
        params: { month: previousMonth.month, year: previousMonth.year },
      });
      const previousRows = Array.isArray(response.data) ? response.data : [];
      const previousMap = previousRows.reduce((accumulator, row) => {
        accumulator[row.class_name] = row;
        return accumulator;
      }, {});

      const hasAnyData = previousRows.some((row) => row.has_data);
      if (!hasAnyData) {
        setMessage("Tidak ada data bulan sebelumnya.");
        return;
      }

      setRows((currentRows) =>
        currentRows.map((row) => {
          const previous = previousMap[row.class_name];
          if (!previous || !previous.has_data) {
            return row;
          }

          const nextRow = {
            ...row,
            sakit: Number(previous.sakit || 0),
            izin: Number(previous.izin || 0),
            alfa: Number(previous.alfa || 0),
            note: previous.note || "",
          };
          const original = originalRows[row.class_name] || { sakit: 0, izin: 0, alfa: 0, note: "" };
          return {
            ...nextRow,
            dirty:
              Number(nextRow.sakit) !== Number(original.sakit) ||
              Number(nextRow.izin) !== Number(original.izin) ||
              Number(nextRow.alfa) !== Number(original.alfa) ||
              (nextRow.note || "") !== (original.note || ""),
          };
        })
      );
      setMessage(`Nilai dari ${getMonthLabel(previousMonth.month)} ${previousMonth.year} disalin ke tabel saat ini.`);
    } catch (err) {
      setError(err.response?.data?.detail || "Gagal menyalin data bulan sebelumnya.");
    }
  };

  const handleOpenQuickFill = (jenjang) => {
    setQuickFillJenjang(jenjang);
    setQuickFillForm({ sakit: 0, izin: 0, alfa: 0 });
  };

  const handleApplyQuickFill = () => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.jenjang !== quickFillJenjang) {
          return row;
        }

        const nextRow = {
          ...row,
          sakit: quickFillForm.sakit,
          izin: quickFillForm.izin,
          alfa: quickFillForm.alfa,
        };
        const original = originalRows[row.class_name] || { sakit: 0, izin: 0, alfa: 0, note: "" };
        return {
          ...nextRow,
          dirty:
            Number(nextRow.sakit) !== Number(original.sakit) ||
            Number(nextRow.izin) !== Number(original.izin) ||
            Number(nextRow.alfa) !== Number(original.alfa) ||
            (nextRow.note || "") !== (original.note || ""),
        };
      })
    );
    setQuickFillJenjang("");
  };

  const handleFocusFirstMissingMonth = () => {
    if (!firstMissingCoverage) {
      return;
    }
    setMonth(firstMissingCoverage.month);
    setYear(firstMissingCoverage.year);
    window.setTimeout(() => {
      tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  };

  const handleNumericKeyDown = (event, rowIndex, fieldIndex) => {
    if (event.key !== "Tab" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    const nextFieldIndex = fieldIndex === 2 ? 0 : fieldIndex + 1;
    const nextRowIndex = fieldIndex === 2 ? rowIndex + 1 : rowIndex;
    const nextTarget = inputRefs.current[`${nextRowIndex}-${nextFieldIndex}`];
    if (nextTarget) {
      nextTarget.focus();
      nextTarget.select();
    }
  };

  const flatRows = useMemo(() => rows, [rows]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      {toast.visible && (
        <div className="fixed right-6 top-6 z-50 max-w-md animate-in fade-in slide-in-from-top-3 duration-200 ease-out">
          <div
            className={`rounded-2xl border shadow-xl px-4 py-3 backdrop-blur-sm ${
              toast.type === "error"
                ? "border-rose-200 bg-rose-50/95 text-rose-700"
                : "border-emerald-200 bg-emerald-50/95 text-emerald-700"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                {toast.type === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold">
                  {toast.type === "error" ? "Simpan gagal" : "Simpan berhasil"}
                </p>
                <p className="text-sm leading-relaxed">{toast.text}</p>
              </div>
              <button
                type="button"
                onClick={() => setToast((previous) => ({ ...previous, visible: false }))}
                className="text-xs font-bold opacity-70 hover:opacity-100"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      <PageHeader
        title="Sakit / Izin / Alfa"
        description="Isi rekap SIA bulanan per kelas dengan workflow cepat untuk admin."
      />

      {coverageRows.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle size={18} />
                <h2 className="text-lg font-bold">Data SIA belum lengkap</h2>
              </div>
              <div className="space-y-1 text-sm text-amber-700">
                {coverageRows.map((item) => (
                  <p key={getMonthKey(item.month, item.year)}>
                    {getMonthLabel(item.month)} {item.year}: {item.missingCount} kelas belum diisi
                  </p>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleFocusFirstMissingMonth}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-200"
            >
              Isi Sekarang <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {(message || error) && (
        <div
          ref={feedbackRef}
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="pt-0.5">
              {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <div className="space-y-1">
              <p>{error || message}</p>
              {!error && recentlySavedClasses.length > 0 && (
                <p className="text-xs font-semibold opacity-80">
                  Kelas tersimpan: {recentlySavedClasses.join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-100 bg-white shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-brand" />
          <h2 className="text-lg font-bold text-slate-900">Periode & Petugas</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Bulan</label>
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-800"
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Tahun</label>
            <input
              type="number"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Diisi oleh</label>
            <input
              type="text"
              value={enteredBy}
              onChange={(event) => setEnteredBy(event.target.value)}
              placeholder="Nama admin"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fetchRows(month, year)}
              disabled={loading}
              className="flex-1 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover inline-flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section ref={tableSectionRef} className="rounded-2xl border border-slate-100 bg-white shadow-sm p-0 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Input Kelas — {getMonthLabel(month)} {year}</h2>
            <p className="text-sm text-slate-500">Isi rekap per kelas. Nilai tersimpan sebagai data catch-up bulanan.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopyPreviousMonth}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 inline-flex items-center gap-2"
            >
              <Copy size={16} /> Salin dari {getMonthLabel(previousMonth.month)}
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving || modifiedRows.length === 0}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Simpan Semua
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 size={32} className="animate-spin text-brand" />
            <p className="text-slate-500 font-medium">Memuat data kelas...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">Belum ada kelas untuk periode ini.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-6 py-4">Kelas</th>
                  <th className="px-6 py-4 text-center w-24">Sakit</th>
                  <th className="px-6 py-4 text-center w-24">Izin</th>
                  <th className="px-6 py-4 text-center w-24">Alfa</th>
                  <th className="px-6 py-4">Catatan</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(groupedRows).map(([jenjang, groupRows]) => (
                  <React.Fragment key={jenjang}>
                    <tr className="bg-slate-50/70">
                      <td colSpan={6} className="px-6 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-[0.18em]">{jenjang}</span>
                          <button
                            type="button"
                            onClick={() => handleOpenQuickFill(jenjang)}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
                          >
                            <Wand2 size={14} /> Isi semua {jenjang}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {groupRows.map((row) => {
                      const rowIndex = flatRows.findIndex((item) => item.class_name === row.class_name);
                      return (
                        <tr
                          key={row.class_name}
                          className={`transition-colors ${
                            recentlySavedClasses.includes(row.class_name)
                              ? "bg-emerald-50/80 ring-1 ring-inset ring-emerald-200"
                              : "hover:bg-slate-50/50"
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-bold text-slate-900">{row.class_name}</div>
                              {recentlySavedClasses.includes(row.class_name) && (
                                <span className="inline-flex items-center gap-1 rounded-[9999px] bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                                  <CheckCircle2 size={12} /> Baru disimpan
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {row.entry_mode === "class" ? "Mode catch-up kelas" : "Agregasi dari input siswa"}
                            </div>
                          </td>
                          {["sakit", "izin", "alfa"].map((field, fieldIndex) => (
                            <td key={field} className="px-6 py-4">
                              <input
                                ref={(node) => {
                                  inputRefs.current[`${rowIndex}-${fieldIndex}`] = node;
                                }}
                                type="number"
                                min="0"
                                value={row[field] || 0}
                                onChange={(event) => updateRow(row.class_name, field, event.target.value)}
                                onKeyDown={(event) => handleNumericKeyDown(event, rowIndex, fieldIndex)}
                                className="w-full text-center rounded-lg border border-slate-200 py-2 focus:ring-2 focus:ring-brand/30 outline-none"
                              />
                            </td>
                          ))}
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={row.note || ""}
                              onChange={(event) => updateRow(row.class_name, "note", event.target.value)}
                              placeholder="Catatan kelas"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-brand/30 outline-none text-slate-600"
                            />
                          </td>
                          <td className="px-6 py-4">
                            {row.dirty ? (
                              <span className="inline-flex items-center gap-1 rounded-[9999px] bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                                ✏️ Belum simpan
                              </span>
                            ) : row.has_data ? (
                              <span className="inline-flex items-center gap-1 rounded-[9999px] bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={12} /> Tersimpan
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-[9999px] bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                                Belum isi
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {quickFillJenjang && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setQuickFillJenjang("")} />
          <div className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl space-y-6">
            <div>
              <h3 className="text-xl font-bold text-slate-900">Isi semua kelas {quickFillJenjang}</h3>
              <p className="text-slate-500 text-sm mt-1">Terapkan nilai yang sama ke semua kelas pada jenjang ini.</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {["Sakit", "Izin", "Alfa"].map((label) => (
                <div key={label} className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400">{label}</label>
                  <input
                    type="number"
                    min="0"
                    value={quickFillForm[label.toLowerCase()]}
                    onChange={(event) =>
                      setQuickFillForm((prev) => ({
                        ...prev,
                        [label.toLowerCase()]: Math.max(0, Number(event.target.value || 0)),
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg font-bold"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setQuickFillJenjang("")}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApplyQuickFill}
                className="flex-1 px-4 py-3 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover transition-colors"
              >
                Terapkan ke semua kelas {quickFillJenjang}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AbsenceReasons;
