import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, Pencil, Trash2, XCircle } from "lucide-react";

import api from "../api";
import { useAuth } from "../context/AuthContext";
import { getPageApiError } from "../lib/api/errors";
import { PageHeader } from "../components/common/page-header";
import { Card } from "../components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionRestrictedState,
} from "../components/common/state-message";

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function responseStatus(error) {
  return Number(error?.status || error?.response?.status || 0);
}

export function getJenjangConfigError(error, fallback) {
  const status = responseStatus(error);
  if (status === 401) return "Sesi Anda telah berakhir. Masuk kembali lalu coba lagi.";
  if (status === 403) return "Akun Anda tidak memiliki izin untuk melakukan tindakan ini.";
  if (status === 409) return "Konfigurasi berubah di server. Muat ulang data sebelum menyimpan kembali.";
  if (status === 400 || status === 422) return "Nilai cutoff tidak valid. Gunakan format waktu HH:MM.";
  return getPageApiError(
    { ...error, response: error?.response ? { ...error.response, data: undefined } : undefined },
    fallback,
  );
}

export function normalizeJenjangPayload(configPayload, availablePayload) {
  if (!Array.isArray(configPayload?.configured) || !Array.isArray(configPayload?.unconfigured)) {
    throw new Error("INVALID_CONFIG_RESPONSE");
  }
  if (!Array.isArray(availablePayload?.jenjang_list)) {
    throw new Error("INVALID_AVAILABLE_RESPONSE");
  }

  const available = availablePayload.jenjang_list;
  if (available.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("INVALID_AVAILABLE_ITEM");
  }
  const availableJenjangs = [...new Set(available.map((item) => item.trim()))].sort((a, b) => a.localeCompare(b));
  const configuredMap = {};
  for (const item of configPayload.configured) {
    if (!item || typeof item.jenjang !== "string" || !item.jenjang.trim() || !TIME_PATTERN.test(item.cutoff_time || "")) {
      throw new Error("INVALID_CONFIG_ITEM");
    }
    const name = item.jenjang.trim();
    if (configuredMap[name]) throw new Error("DUPLICATE_CONFIG_ITEM");
    configuredMap[name] = { jenjang: name, cutoff_time: item.cutoff_time, updated_at: item.updated_at || null };
  }

  const derivedUnconfigured = availableJenjangs.filter((name) => !configuredMap[name]);
  const reportedUnconfigured = configPayload.unconfigured
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())
    .sort((a, b) => a.localeCompare(b));
  const partial = JSON.stringify(derivedUnconfigured) !== JSON.stringify(reportedUnconfigured);
  return { availableJenjangs, configuredMap, unconfigured: derivedUnconfigured, partial };
}

function JenjangConfig() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [data, setData] = useState({ availableJenjangs: [], configuredMap: {}, unconfigured: [], partial: false });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [permissionRestricted, setPermissionRestricted] = useState(false);
  const [editingJenjang, setEditingJenjang] = useState("");
  const [deleteConfirmJenjang, setDeleteConfirmJenjang] = useState("");
  const [form, setForm] = useState({ cutoff_time: "07:00" });
  const [initialCutoff, setInitialCutoff] = useState("07:00");
  const [fieldError, setFieldError] = useState("");
  const requestIdRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const cutoffRef = useRef(null);

  const loadData = useCallback(async ({ background = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (!background) setLoading(true);
    setError("");
    setPermissionRestricted(false);
    try {
      const [configResponse, availableResponse] = await Promise.all([
        api.get("/api/config/jenjang"),
        api.get("/api/config/jenjang/available"),
      ]);
      const normalized = normalizeJenjangPayload(configResponse.data, availableResponse.data);
      if (requestId === requestIdRef.current) setData(normalized);
      return normalized;
    } catch (err) {
      if (requestId === requestIdRef.current) {
        if (responseStatus(err) === 403) setPermissionRestricted(true);
        else setError(getJenjangConfigError(err, "Konfigurasi cutoff jenjang belum dapat dimuat."));
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current && !background) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const rows = useMemo(() => data.availableJenjangs.map((jenjang) => ({
    jenjang,
    cutoff_time: data.configuredMap[jenjang]?.cutoff_time || "",
    updated_at: data.configuredMap[jenjang]?.updated_at || null,
    isConfigured: Boolean(data.configuredMap[jenjang]),
  })), [data]);

  const resetInlineForm = useCallback(() => {
    setEditingJenjang("");
    setDeleteConfirmJenjang("");
    setForm({ cutoff_time: "07:00" });
    setInitialCutoff("07:00");
    setFieldError("");
  }, []);

  const openInlineForm = useCallback((row) => {
    const cutoff = row.cutoff_time || "07:00";
    setMessage("");
    setError("");
    setDeleteConfirmJenjang("");
    setEditingJenjang(row.jenjang);
    setForm({ cutoff_time: cutoff });
    setInitialCutoff(cutoff);
    setFieldError("");
  }, []);

  const cutoff = form.cutoff_time.trim();
  const isDirty = Boolean(editingJenjang) && cutoff !== initialCutoff;
  const isValid = TIME_PATTERN.test(cutoff);

  const updateCutoff = (value) => {
    setForm({ cutoff_time: value });
    if (TIME_PATTERN.test(value.trim())) setFieldError("");
  };

  const handleSave = useCallback(async () => {
    if (!canEdit || mutationInFlightRef.current || !editingJenjang) return;
    const nextCutoff = form.cutoff_time.trim();
    if (!TIME_PATTERN.test(nextCutoff)) {
      setFieldError("Gunakan format waktu 24 jam HH:MM, misalnya 07:00.");
      cutoffRef.current?.focus();
      return;
    }
    if (nextCutoff === initialCutoff) {
      setMessage("Tidak ada perubahan untuk disimpan.");
      return;
    }

    mutationInFlightRef.current = true;
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      await api.put(`/api/config/jenjang/${encodeURIComponent(editingJenjang)}`, { cutoff_time: nextCutoff });
      const authoritative = await loadData({ background: true });
      if (!authoritative || authoritative.configuredMap[editingJenjang]?.cutoff_time !== nextCutoff) {
        setError("Perubahan diterima, tetapi hasil terbaru belum dapat dikonfirmasi. Muat ulang sebelum mencoba lagi.");
        return;
      }
      setMessage(`Cutoff keterlambatan ${editingJenjang} berhasil disimpan.`);
      resetInlineForm();
    } catch (err) {
      setError(getJenjangConfigError(err, "Cutoff jenjang belum dapat disimpan. Coba lagi."));
    } finally {
      mutationInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [canEdit, editingJenjang, form.cutoff_time, initialCutoff, loadData, resetInlineForm, submitting]);

  const handleDelete = useCallback(async (jenjang) => {
    if (!canEdit || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      await api.delete(`/api/config/jenjang/${encodeURIComponent(jenjang)}`);
      const authoritative = await loadData({ background: true });
      if (!authoritative || authoritative.configuredMap[jenjang]) {
        setError("Penghapusan diterima, tetapi hasil terbaru belum dapat dikonfirmasi. Muat ulang sebelum mencoba lagi.");
        return;
      }
      resetInlineForm();
      setMessage(`Cutoff khusus ${jenjang} dihapus. Perhitungan berikutnya menggunakan cutoff bawaan.`);
    } catch (err) {
      setError(getJenjangConfigError(err, `Cutoff ${jenjang} belum dapat dihapus. Coba lagi.`));
    } finally {
      mutationInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [canEdit, loadData, resetInlineForm, submitting]);

  const configuredCount = rows.length - data.unconfigured.length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <PageHeader
        title="Cutoff Keterlambatan per Jenjang"
        description="Atur batas waktu hadir untuk jenjang yang berasal dari data siswa. Pengaturan ini terpisah dari master akademik Jenjang."
      />

      {(message || (error && rows.length > 0)) && (
        <div role={error ? "alert" : "status"} aria-live="polite" className={`rounded-xl border px-4 py-3 text-sm font-medium ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error || message}
        </div>
      )}

      {permissionRestricted ? (
        <PermissionRestrictedState title="Akses konfigurasi dibatasi" description="Akun Anda tidak diizinkan melihat konfigurasi cutoff per jenjang." />
      ) : loading ? (
        <LoadingState title="Memuat konfigurasi cutoff jenjang…" description="Status konfigurasi sedang diperiksa dari server." />
      ) : error && rows.length === 0 ? (
        <ErrorState title="Konfigurasi tidak dapat dimuat" description={error} action={<button type="button" onClick={() => loadData()} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">Coba Lagi</button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada jenjang dari data siswa"
          description="Cutoff per jenjang baru dapat diatur setelah data siswa memiliki nilai jenjang. Master Jenjang akademik dikelola terpisah."
          action={canEdit ? <Link to="/students" className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover">Buka Data Siswa</Link> : <p className="text-xs font-semibold text-slate-500">Hubungi administrator untuk melengkapi data jenjang siswa.</p>}
        />
      ) : (
        <Card className="rounded-2xl p-4 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2"><Clock3 size={18} className="text-brand" aria-hidden="true" /><h2 className="text-lg font-bold text-slate-900">Status cutoff jenjang</h2></div>
              <p className="mt-1 text-sm text-slate-500">Dipakai untuk menentukan status terlambat saat data kehadiran diproses.</p>
            </div>
            <span className={`self-start rounded-full px-3 py-1 text-xs font-bold ${data.unconfigured.length ? "bg-amber-100 text-amber-800" : data.partial ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"}`}>
              {data.unconfigured.length ? `${configuredCount}/${rows.length} dikonfigurasi` : data.partial ? "Lengkap, perlu verifikasi" : "Konfigurasi lengkap"}
            </span>
          </div>

          {data.unconfigured.length > 0 && <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Konfigurasi belum lengkap.</strong> Atur cutoff untuk: {data.unconfigured.join(", ")}.</div>}
          {data.partial && <div role="status" className="mb-4 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Daftar status dari server tidak konsisten. Status di bawah dihitung ulang dari data yang tersedia; muat ulang sebelum mengubah konfigurasi.</span></div>}
          {!canEdit && <div role="note" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Anda memiliki akses baca. Hanya administrator yang dapat mengubah atau menghapus cutoff.</div>}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><th className="py-3 pr-4 text-left">Jenjang siswa</th><th className="py-3 pr-4 text-left">Status</th><th className="py-3 pr-4 text-left">Cutoff</th><th className="py-3 pr-4 text-left">Terakhir diubah</th>{canEdit && <th className="py-3 text-right">Aksi</th>}</tr></thead>
              <tbody>
                {rows.map((row) => (
                  <React.Fragment key={row.jenjang}>
                    <tr className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-semibold text-slate-800 break-words">{row.jenjang}</td>
                      <td className="py-3 pr-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.isConfigured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{row.isConfigured ? "Cutoff aktif" : "Cutoff belum diatur"}</span></td>
                      <td className={`py-3 pr-4 ${row.isConfigured ? "text-slate-700" : "text-slate-400"}`}>{row.isConfigured ? row.cutoff_time : "Menggunakan bawaan"}</td>
                      <td className="py-3 pr-4 text-sm text-slate-500">{row.updated_at ? new Date(row.updated_at).toLocaleString("id-ID") : "—"}</td>
                      {canEdit && <td className="py-3 text-right">
                        {deleteConfirmJenjang === row.jenjang ? <div className="inline-flex items-center gap-2 text-xs"><span className="font-semibold text-rose-700">Hapus cutoff khusus? Data historis tidak dihapus.</span><button type="button" onClick={() => handleDelete(row.jenjang)} disabled={submitting} className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{submitting ? "Menghapus…" : "Konfirmasi"}</button><button type="button" onClick={() => setDeleteConfirmJenjang("")} disabled={submitting} className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Batal</button></div> : <div className="inline-flex items-center gap-2"><button type="button" onClick={() => openInlineForm(row)} disabled={submitting} className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-50">{row.isConfigured ? <><Pencil size={13} aria-hidden="true" /> Ubah</> : <><CheckCircle2 size={13} aria-hidden="true" /> Atur Cutoff</>}</button>{row.isConfigured && <button type="button" onClick={() => setDeleteConfirmJenjang(row.jenjang)} disabled={submitting} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><Trash2 size={13} aria-hidden="true" /> Hapus</button>}</div>}
                      </td>}
                    </tr>
                    {canEdit && editingJenjang === row.jenjang && <tr className="border-b border-slate-100 bg-slate-50"><td colSpan="5" className="p-4"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-2"><label htmlFor={`cutoff-${row.jenjang}`} className="text-xs font-bold uppercase tracking-wider text-slate-500">Cutoff untuk {row.jenjang}</label><input ref={cutoffRef} id={`cutoff-${row.jenjang}`} type="time" value={form.cutoff_time} onChange={(event) => updateCutoff(event.target.value)} disabled={submitting} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? `cutoff-error-${row.jenjang}` : `cutoff-help-${row.jenjang}`} className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand/30" /><p id={`cutoff-help-${row.jenjang}`} className="text-xs text-slate-500">Waktu 24 jam; status terlambat dihitung setelah batas ini.</p>{fieldError && <p id={`cutoff-error-${row.jenjang}`} className="text-xs font-semibold text-rose-700">{fieldError}</p>}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={handleSave} disabled={submitting || !isDirty || !isValid || data.partial} title={!isDirty ? "Ubah waktu cutoff untuk mengaktifkan Simpan." : data.partial ? "Muat ulang data yang tidak konsisten sebelum menyimpan." : undefined} className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 size={16} aria-hidden="true" /> {submitting ? "Menyimpan…" : "Simpan"}</button><button type="button" onClick={resetInlineForm} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"><XCircle size={16} aria-hidden="true" /> Batal</button></div></div></div></td></tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default JenjangConfig;
