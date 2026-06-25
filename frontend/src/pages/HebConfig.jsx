import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, Pencil, Trash2, XCircle } from "lucide-react";

import api from "../api";

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

function getMonthLabel(month) {
  return MONTH_OPTIONS.find((item) => item.value === Number(month))?.label || `Bulan ${month}`;
}

function buildRowKey(month, jenjang) {
  return `${month}:${jenjang}`;
}

function HebConfig() {
  const today = new Date();
  const [yearInput, setYearInput] = useState(String(today.getFullYear()));
  const [activeYear, setActiveYear] = useState(today.getFullYear());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState([]);
  const [editingKey, setEditingKey] = useState("");
  const [deleteConfirmKey, setDeleteConfirmKey] = useState("");
  const [form, setForm] = useState({ heb_value: "", note: "", set_by: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async (targetYear = activeYear) => {
    setLoading(true);
    setError("");

    try {
      const requests = [
        api.get("/config/jenjang/available"),
        ...MONTH_OPTIONS.map((month) =>
          api.get("/analytics/heb", {
            params: { month: month.value, year: targetYear },
          })
        ),
      ];

      const [jenjangResponse, ...hebResponses] = await Promise.all(requests);
      const availableJenjangs = Array.isArray(jenjangResponse.data?.jenjang_list)
        ? jenjangResponse.data.jenjang_list
        : [];

      const responseRows = hebResponses.flatMap((response, index) => {
        const month = MONTH_OPTIONS[index].value;
        const items = Array.isArray(response.data?.heb_by_jenjang) ? response.data.heb_by_jenjang : [];
        return items.map((item) => ({ ...item, month, year: targetYear }));
      });

      const jenjangs = Array.from(
        new Set([...availableJenjangs, ...responseRows.map((item) => item.jenjang).filter(Boolean)])
      ).sort((left, right) => left.localeCompare(right));

      const responseMap = responseRows.reduce((accumulator, item) => {
        accumulator[buildRowKey(item.month, item.jenjang)] = item;
        return accumulator;
      }, {});

      const nextRows = MONTH_OPTIONS.flatMap((month) =>
        jenjangs.map((jenjang) => {
          const row = responseMap[buildRowKey(month.value, jenjang)];
          return {
            month: month.value,
            year: targetYear,
            jenjang,
            heb: Number(row?.heb || 0),
            auto_heb: Number(row?.auto_heb || 0),
            override_heb: row?.override_heb ?? null,
            source: row?.source || "auto",
            note: row?.override_note || row?.note || "",
            auto_median: Number(row?.auto_median || 0),
            override_set_by: row?.override_set_by || "",
            override_set_at: row?.override_set_at || null,
          };
        })
      );

      setRows(nextRows);
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.detail || "Gagal memuat konfigurasi HEB.");
    } finally {
      setLoading(false);
    }
  }, [activeYear]);

  useEffect(() => {
    loadData(activeYear);
  }, [activeYear, loadData]);

  const summaryRows = useMemo(() => {
    return rows.reduce((accumulator, row) => {
      if (!accumulator[row.jenjang]) {
        accumulator[row.jenjang] = { jenjang: row.jenjang, total_heb: 0 };
      }
      accumulator[row.jenjang].total_heb += Number(row.heb || 0);
      return accumulator;
    }, {});
  }, [rows]);

  const orderedSummaryRows = useMemo(
    () => Object.values(summaryRows).sort((left, right) => left.jenjang.localeCompare(right.jenjang)),
    [summaryRows]
  );

  const openForm = useCallback((row, options = {}) => {
    setEditingKey(buildRowKey(row.month, row.jenjang));
    setDeleteConfirmKey(options.openDeleteConfirm ? buildRowKey(row.month, row.jenjang) : "");
    setMessage("");
    setError("");
    setForm({
      heb_value: String(row.override_heb ?? row.heb ?? ""),
      note: row.note || "",
      set_by: row.override_set_by || "",
    });
  }, []);

  const closeForm = useCallback(() => {
    setEditingKey("");
    setDeleteConfirmKey("");
    setForm({ heb_value: "", note: "", set_by: "" });
  }, []);

  const handleRefresh = async () => {
    const nextYear = Number(yearInput);
    if (!Number.isInteger(nextYear) || nextYear < 2020) {
      setError("Tahun harus berupa angka dan minimal 2020.");
      return;
    }

    setActiveYear(nextYear);
    setEditingKey("");
    setDeleteConfirmKey("");
    setMessage("");
    setError("");
  };

  const handleSave = async (row) => {
    const hebValue = Number(form.heb_value);
    if (!Number.isInteger(hebValue) || hebValue < 1 || hebValue > 31) {
      setError("Nilai HEB harus berupa angka 1 sampai 31.");
      return;
    }

    if (!form.set_by.trim()) {
      setError("Kolom Set by wajib diisi.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      await api.put(`/config/heb/${encodeURIComponent(row.jenjang)}/${row.year}/${row.month}`, {
        heb_value: hebValue,
        note: form.note.trim(),
        set_by: form.set_by.trim(),
      });
      await loadData(activeYear);
      setMessage(`Override ${row.jenjang} untuk ${getMonthLabel(row.month)} ${row.year} disimpan.`);
      closeForm();
    } catch (err) {
      setError(err.response?.data?.detail || "Gagal menyimpan override HEB.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row) => {
    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      await api.delete(`/config/heb/${encodeURIComponent(row.jenjang)}/${row.year}/${row.month}`);
      await loadData(activeYear);
      setMessage(`Override ${row.jenjang} dihapus — kembali ke kalkulasi otomatis.`);
      closeForm();
    } catch (err) {
      setError(err.response?.data?.detail || "Gagal menghapus override HEB.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Override HEB</h1>
        <p className="text-slate-500 mt-1">
          Bandingkan HEB otomatis dengan override manual untuk setiap bulan dan jenjang.
        </p>
      </header>

      {(message || error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {error || message}
        </div>
      )}

      <section className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock3 size={18} className="text-brand" />
          <h2 className="text-lg font-bold text-slate-900">Filter Tahun</h2>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Tahun</label>
            <input
              type="number"
              value={yearInput}
              onChange={(event) => setYearInput(event.target.value)}
              className="w-40 rounded-xl border border-slate-200 px-3 py-2.5"
            />
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="px-5 py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover inline-flex items-center gap-2"
          >
            Tampilkan
          </button>
        </div>
      </section>

      <section className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-4">
            <Loader2 size={32} className="animate-spin text-brand" />
            <p className="text-slate-500 font-medium">Memuat data HEB tahunan...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">Belum ada data HEB untuk tahun ini.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-6 py-4">Bulan</th>
                  <th className="px-6 py-4">Jenjang</th>
                  <th className="px-6 py-4 text-center">HEB (Auto)</th>
                  <th className="px-6 py-4 text-center">HEB (Override)</th>
                  <th className="px-6 py-4">Source</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const rowKey = buildRowKey(row.month, row.jenjang);
                  const isEditing = editingKey === rowKey;
                  const isDeleteConfirming = deleteConfirmKey === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4 font-medium text-slate-700">{getMonthLabel(row.month)} {row.year}</td>
                        <td className="px-6 py-4 font-semibold text-slate-900">{row.jenjang}</td>
                        <td className="px-6 py-4 text-center text-slate-700">{row.auto_heb}</td>
                        <td className="px-6 py-4 text-center text-slate-700">{row.override_heb ?? "—"}</td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center rounded-[9999px] px-2.5 py-1 text-xs font-semibold ${
                                row.source === "manual"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {row.source === "manual" ? "Manual" : "Auto"}
                            </span>
                            <p className="text-xs text-slate-500">Median auto: {row.auto_median}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openForm(row)}
                              className="px-3 py-1.5 rounded-lg bg-brand/10 text-brand text-xs font-semibold hover:bg-brand/20 inline-flex items-center gap-1"
                            >
                              {row.source === "manual" ? <><Pencil size={13} /> Edit</> : <><CheckCircle2 size={13} /> Set Override</>}
                            </button>
                            {row.source === "manual" && (
                              <button
                                type="button"
                                onClick={() => openForm(row, { openDeleteConfirm: true })}
                                className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 inline-flex items-center gap-1"
                              >
                                <Trash2 size={13} /> Hapus
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isEditing && (
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <td colSpan="6" className="px-4 py-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                              <div>
                                <h3 className="text-base font-bold text-slate-900">
                                  HEB Override — {row.jenjang} — {getMonthLabel(row.month)} {row.year}
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                  Nilai otomatis: <span className="font-semibold text-slate-700">{row.auto_heb} hari</span>
                                </p>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">HEB Value</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min="1"
                                      max="31"
                                      value={form.heb_value}
                                      onChange={(event) => setForm((prev) => ({ ...prev, heb_value: event.target.value }))}
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                    />
                                    <span className="text-sm text-slate-500">hari</span>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Note</label>
                                  <input
                                    type="text"
                                    value={form.note}
                                    onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                                    placeholder="Catatan override"
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Set by</label>
                                  <input
                                    type="text"
                                    value={form.set_by}
                                    onChange={(event) => setForm((prev) => ({ ...prev, set_by: event.target.value }))}
                                    placeholder="Nama admin"
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSave(row)}
                                  disabled={submitting || !form.set_by.trim()}
                                  className="px-4 py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover disabled:opacity-50"
                                >
                                  {submitting ? "Menyimpan..." : "Simpan Override"}
                                </button>
                                <button
                                  type="button"
                                  onClick={closeForm}
                                  disabled={submitting}
                                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50"
                                >
                                  Batalkan
                                </button>
                              </div>

                              {row.source === "manual" && !isDeleteConfirming && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmKey(rowKey)}
                                  disabled={submitting}
                                  className="px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100 disabled:opacity-50"
                                >
                                  Hapus Override — Kembali ke Auto
                                </button>
                              )}

                              {row.source === "manual" && isDeleteConfirming && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                  <span className="text-sm font-medium text-rose-700">
                                    Yakin hapus override {row.jenjang} {getMonthLabel(row.month)} {row.year}?
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(row)}
                                      disabled={submitting}
                                      className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                                    >
                                      Ya
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteConfirmKey("")}
                                      disabled={submitting}
                                      className="px-3 py-2 rounded-lg bg-white text-slate-700 text-sm font-semibold border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Tidak
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 size={18} className="text-emerald-500" />
          <h2 className="text-lg font-bold text-slate-900">Total HEB per Jenjang ({activeYear})</h2>
        </div>

        {orderedSummaryRows.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada data untuk dihitung.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left py-3 pr-4">Jenjang</th>
                  <th className="text-right py-3">Total HEB</th>
                </tr>
              </thead>
              <tbody>
                {orderedSummaryRows.map((row) => (
                  <tr key={row.jenjang} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-3 pr-4 font-semibold text-slate-900">{row.jenjang}</td>
                    <td className="py-3 text-right text-slate-700 font-semibold">{row.total_heb} hari</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default HebConfig;
