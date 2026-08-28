import React, { useState, useEffect } from 'react';
import {
  Clock, Plus, Shield, CheckCircle, AlertTriangle, XCircle, Info, RefreshCw, Archive
} from 'lucide-react';
import {
  getDeparturePolicies, createDeparturePolicy, deactivateDeparturePolicy, DismissalPolicyItem
} from '../api/earlyDeparture';
import { fetchJenjangs } from '../api/enrollment';

const WEEKDAYS = [
  'Senin (Monday)',
  'Selasa (Tuesday)',
  'Rabu (Wednesday)',
  'Kamis (Thursday)',
  'Jumat (Friday)',
  'Sabtu (Saturday)',
  'Minggu (Sunday)',
];

export function DismissalPolicies() {
  const [policies, setPolicies] = useState<DismissalPolicyItem[]>([]);
  const [jenjangs, setJenjangs] = useState<string[]>(['Primary', 'Junior High', 'Senior High']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [jenjang, setJenjang] = useState('Primary');
  const [weekday, setWeekday] = useState(0); // 0=Mon
  const [dismissalTime, setDismissalTime] = useState('14:00');
  const [gracePeriod, setGracePeriod] = useState(15);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [changeReason, setChangeReason] = useState('Kebijakan Jam Pulang Sekolah');
  const [submitting, setSubmitting] = useState(false);

  // Deactivation Modal State
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('Perubahan jadwal jam pulang');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyList, jenjangList] = await Promise.all([
        getDeparturePolicies(),
        fetchJenjangs().catch(() => []),
      ]);
      setPolicies(policyList);
      if (jenjangList && jenjangList.length > 0) {
        const jNames = jenjangList.map((j: any) => j.name || j.code);
        setJenjangs(jNames);
        if (!jNames.includes(jenjang)) setJenjang(jNames[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat kebijakan jam pulang.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await createDeparturePolicy({
        jenjang,
        weekday: Number(weekday),
        dismissal_time: dismissalTime,
        grace_period_minutes: Number(gracePeriod),
        effective_from: effectiveFrom,
        effective_to: effectiveTo || undefined,
        change_reason: changeReason || undefined,
      });
      setSuccess(`Kebijakan jam pulang untuk ${jenjang} (${WEEKDAYS[weekday]}) berhasil ditambahkan.`);
      loadData();
    } catch (err: any) {
      if (err?.detail?.code === 'DISMISSAL_POLICY_OVERLAP' || err?.message?.includes('OVERLAP')) {
        setError('Konflik Kebijakan: Kebijakan aktif pada Jenjang dan Hari ini sudah ada dalam rentang tanggal tersebut.');
      } else {
        setError(err?.detail?.message || err?.message || 'Gagal menyimpan kebijakan.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: number) => {
    try {
      await deactivateDeparturePolicy(id, deactivateReason);
      setSuccess('Kebijakan jam pulang berhasil dinonaktifkan.');
      setDeactivatingId(null);
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Gagal menonaktifkan kebijakan.');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Pengaturan Jam Pulang Sekolah</h1>
            <p className="text-sm text-slate-400">Konfigurasi jadwal kepulangan resmi (dismissal policy) per Jenjang & Hari.</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3 text-rose-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3 text-emerald-400 text-sm">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Create Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-400" />
          Tambah Kebijakan Jam Pulang Baru
        </h2>
        <form onSubmit={handleCreatePolicy} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Jenjang Sekolah</label>
            <select
              value={jenjang}
              onChange={(e) => setJenjang(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {jenjangs.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Hari (Weekday)</label>
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {WEEKDAYS.map((w, idx) => (
                <option key={idx} value={idx}>{w}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Jam Pulang Resmi (HH:MM)</label>
            <input
              type="text"
              value={dismissalTime}
              onChange={(e) => setDismissalTime(e.target.value)}
              placeholder="14:00"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Grace Period (Menit Toleransi)</label>
            <input
              type="number"
              value={gracePeriod}
              onChange={(e) => setGracePeriod(Number(e.target.value))}
              min="0"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Berlaku Mulai (Effective From)</label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Berlaku Sampai (Opsional)</label>
            <input
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-400 mb-1">Alasan Perubahan / Catatan</label>
            <input
              type="text"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="Contoh: Jadwal khusus semester baru"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="md:col-span-3 lg:col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Kebijakan'}
            </button>
          </div>
        </form>
      </div>

      {/* Policy Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-400" />
          Daftar Kebijakan Jam Pulang Aktif & Riwayat
        </h2>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Memuat daftar kebijakan...</div>
        ) : policies.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Belum ada kebijakan jam pulang yang dikonfigurasi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-semibold border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Jenjang</th>
                  <th className="px-4 py-3">Hari</th>
                  <th className="px-4 py-3">Jam Pulang</th>
                  <th className="px-4 py-3">Toleransi</th>
                  <th className="px-4 py-3">Tanggal Berlaku</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {policies.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-200">{p.jenjang}</td>
                    <td className="px-4 py-3 text-slate-300">{WEEKDAYS[p.weekday] || p.weekday}</td>
                    <td className="px-4 py-3 font-mono font-bold text-indigo-400">{p.dismissal_time}</td>
                    <td className="px-4 py-3 text-slate-400">{p.grace_period_minutes} menit</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {p.effective_from} {p.effective_to ? `s/d ${p.effective_to}` : '(seterusnya)'}
                    </td>
                    <td className="px-4 py-3">
                      {p.is_active ? (
                        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          Aktif
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-700/50 text-slate-400 border border-slate-700">
                          Non-Aktif
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.is_active && (
                        <button
                          onClick={() => setDeactivatingId(p.id)}
                          className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Nonaktifkan
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deactivation Modal */}
      {deactivatingId !== null && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              Nonaktifkan Kebijakan Jam Pulang
            </h3>
            <p className="text-sm text-slate-400">
              Apakah Anda yakin ingin menonaktifkan kebijakan ini? Kebijakan terarsip tetap disimpan untuk keperluan audit histori.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Alasan Penonaktifan</label>
              <input
                type="text"
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-rose-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeactivatingId(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
              >
                Batal
              </button>
              <button
                onClick={() => handleDeactivate(deactivatingId)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold"
              >
                Ya, Nonaktifkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
