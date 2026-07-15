import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock3, Pencil, Trash2, CheckCircle2, XCircle } from "lucide-react";

import api from "../api";
import { getPageApiError } from "../lib/api/errors";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function JenjangConfig() {
  const [availableJenjangs, setAvailableJenjangs] = useState([]);
  const [configuredMap, setConfiguredMap] = useState({});
  const [unconfigured, setUnconfigured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingJenjang, setEditingJenjang] = useState("");
  const [deleteConfirmJenjang, setDeleteConfirmJenjang] = useState("");
  const [form, setForm] = useState({ cutoff_time: "07:00" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [configResponse, availableResponse] = await Promise.all([
        api.get("/api/config/jenjang"),
        api.get("/api/config/jenjang/available"),
      ]);

      const configuredRows = Array.isArray(configResponse.data?.configured)
        ? configResponse.data.configured
        : [];

      const nextConfiguredMap = configuredRows.reduce((accumulator, item) => {
        accumulator[item.jenjang] = {
          jenjang: item.jenjang,
          cutoff_time: item.cutoff_time,
          updated_at: item.updated_at || null,
        };
        return accumulator;
      }, {});

      setConfiguredMap(nextConfiguredMap);
      setUnconfigured(Array.isArray(configResponse.data?.unconfigured) ? configResponse.data.unconfigured : []);
      setAvailableJenjangs(
        Array.isArray(availableResponse.data?.jenjang_list) ? availableResponse.data.jenjang_list : []
      );
    } catch (err) {
      setError(getPageApiError(err, "Gagal memuat konfigurasi jenjang."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rows = useMemo(() => {
    return availableJenjangs
      .map((jenjang) => {
        const configured = configuredMap[jenjang] || null;
        return {
          jenjang,
          cutoff_time: configured?.cutoff_time || "",
          updated_at: configured?.updated_at || null,
          isConfigured: Boolean(configured),
        };
      })
      .sort((a, b) => a.jenjang.localeCompare(b.jenjang));
  }, [availableJenjangs, configuredMap]);

  const resetInlineForm = useCallback(() => {
    setEditingJenjang("");
    setDeleteConfirmJenjang("");
    setForm({ cutoff_time: "07:00" });
  }, []);

  const openInlineForm = useCallback((row) => {
    setMessage("");
    setError("");
    setDeleteConfirmJenjang("");
    setEditingJenjang(row.jenjang);
    setForm({ cutoff_time: row.cutoff_time || "07:00" });
  }, []);

  const handleSave = useCallback(async () => {
    const cutoff = form.cutoff_time.trim();
    if (!TIME_PATTERN.test(cutoff)) {
      setError("Cutoff time harus berformat HH:MM.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      const response = await api.put(`/api/config/jenjang/${encodeURIComponent(editingJenjang)}`, {
        cutoff_time: cutoff,
      });

      const updated = response.data;
      setConfiguredMap((prev) => ({
        ...prev,
        [updated.jenjang]: {
          jenjang: updated.jenjang,
          cutoff_time: updated.cutoff_time,
          updated_at: updated.updated_at || null,
        },
      }));
      setUnconfigured((prev) => prev.filter((item) => item !== updated.jenjang));
      setMessage(`Cutoff untuk ${updated.jenjang} berhasil disimpan.`);
      resetInlineForm();
    } catch (err) {
      setError(err.response?.data?.detail || "Gagal menyimpan cutoff jenjang.");
    } finally {
      setSubmitting(false);
    }
  }, [editingJenjang, form.cutoff_time, resetInlineForm]);

  const handleDelete = useCallback(async (jenjang) => {
    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      await api.delete(`/api/config/jenjang/${encodeURIComponent(jenjang)}`);
      setConfiguredMap((prev) => {
        const next = { ...prev };
        delete next[jenjang];
        return next;
      });
      setUnconfigured((prev) => Array.from(new Set([...prev, jenjang])).sort((a, b) => a.localeCompare(b)));
      setDeleteConfirmJenjang("");
      if (editingJenjang === jenjang) {
        resetInlineForm();
      }
      setMessage(`Konfigurasi cutoff untuk ${jenjang} berhasil dihapus.`);
    } catch (err) {
      setError(err.response?.data?.detail || `Gagal menghapus konfigurasi ${jenjang}.`);
    } finally {
      setSubmitting(false);
    }
  }, [editingJenjang, resetInlineForm]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Konfigurasi Jenjang</h1>
        <p className="text-slate-500 mt-1">
          Atur cutoff keterlambatan berdasarkan jenjang yang sudah ada di data siswa.
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

      <section className="card p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Clock3 size={18} className="text-brand" />
            <h2 className="text-lg font-bold text-slate-900">Daftar Jenjang dari Database</h2>
          </div>
          <div className="text-sm text-slate-500">
            {unconfigured.length > 0 ? `${unconfigured.length} jenjang belum dikonfigurasi` : "Semua jenjang sudah dikonfigurasi"}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Memuat daftar jenjang...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 space-y-3">
            <p>Belum ada data jenjang. Selesaikan pemetaan kelas terlebih dahulu.</p>
            <Link
              to="/mapping"
              className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-white font-semibold hover:bg-brand-hover"
            >
              Buka Mapping
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="text-left py-3 pr-4">Jenjang</th>
                  <th className="text-left py-3 pr-4">Status</th>
                  <th className="text-left py-3 pr-4">Cutoff</th>
                  <th className="text-left py-3 pr-4">Terakhir Diubah</th>
                  <th className="text-right py-3">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <React.Fragment key={row.jenjang}>
                    <tr className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-semibold text-slate-800">{row.jenjang}</td>
                      <td className="py-3 pr-4">
                        {row.isConfigured ? (
                          <span className="inline-flex rounded-[9999px] bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Terkonfigurasi
                          </span>
                        ) : (
                          <span className="inline-flex rounded-[9999px] bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                            Belum dikonfigurasi
                          </span>
                        )}
                      </td>
                      <td className={`py-3 pr-4 ${row.isConfigured ? "text-slate-700" : "text-slate-400"}`}>
                        {row.isConfigured ? row.cutoff_time : "Belum dikonfigurasi"}
                      </td>
                      <td className="py-3 pr-4 text-slate-500 text-sm">
                        {row.updated_at ? new Date(row.updated_at).toLocaleString("id-ID") : "—"}
                      </td>
                      <td className="py-3 text-right">
                        {deleteConfirmJenjang === row.jenjang ? (
                          <div className="inline-flex items-center gap-2 text-xs">
                            <span className="text-rose-700 font-semibold">Hapus cutoff {row.jenjang}?</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(row.jenjang)}
                              disabled={submitting}
                              className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-50"
                            >
                              Konfirmasi
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmJenjang("")}
                              disabled={submitting}
                              className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openInlineForm(row)}
                              disabled={submitting}
                              className="px-3 py-1.5 rounded-lg bg-brand/10 text-brand text-xs font-semibold hover:bg-brand/20 inline-flex items-center gap-1 disabled:opacity-50"
                            >
                              {row.isConfigured ? <><Pencil size={13} /> Ubah</> : <><CheckCircle2 size={13} /> Atur Cutoff</>}
                            </button>
                            {row.isConfigured && (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmJenjang(row.jenjang)}
                                disabled={submitting}
                                className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 inline-flex items-center gap-1 disabled:opacity-50"
                              >
                                <Trash2 size={13} /> Hapus
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {editingJenjang === row.jenjang && (
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <td colSpan="5" className="px-4 py-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
                              <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Cutoff time untuk {row.jenjang}
                                </label>
                                <input
                                  type="time"
                                  value={form.cutoff_time}
                                  onChange={(event) => setForm({ cutoff_time: event.target.value })}
                                  disabled={submitting}
                                  className="w-full max-w-xs px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30"
                                />
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={handleSave}
                                  disabled={submitting}
                                  className="px-5 py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-2"
                                >
                                  <CheckCircle2 size={16} /> Simpan
                                </button>
                                <button
                                  type="button"
                                  onClick={resetInlineForm}
                                  disabled={submitting}
                                  className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 inline-flex items-center gap-2"
                                >
                                  <XCircle size={16} /> Batal
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default JenjangConfig;
