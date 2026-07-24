import React, { useState, useEffect } from 'react';
import {
  Clock, Shield, AlertTriangle, CheckCircle, HelpCircle, UserCheck, FileText, XCircle, RotateCcw, Lock, Info, ExternalLink
} from 'lucide-react';
import {
  getClassDateDepartures, recordDepartureExcuse, revokeDepartureExcuse, getDepartureHistory, DepartureResolutionItem
} from '../api/earlyDeparture';
import { fetchAssignedClasses } from '../api/teacherClassAssignments';

const EXCUSE_REASON_CODES = [
  { code: 'MEDICAL', label: 'Alasan Medis / Sakit (Medical)' },
  { code: 'FAMILY_EMERGENCY', label: 'Darurat Keluarga (Family Emergency)' },
  { code: 'SCHOOL_EVENT', label: 'Kegiatan Resmi Sekolah (School Event)' },
  { code: 'SAFE_PICKUP', label: 'Penjemputan Aman Orang Tua (Safe Pickup)' },
  { code: 'ADMINISTRATIVE', label: 'Izin Administratif (Administrative)' },
];

export function ClassEarlyDeparture() {
  const [assignedClasses, setAssignedClasses] = useState<{ class_id: string; class_name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [departures, setDepartures] = useState<DepartureResolutionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Excuse Record Modal State
  const [excuseTarget, setExcuseTarget] = useState<DepartureResolutionItem | null>(null);
  const [reasonCode, setReasonCode] = useState('MEDICAL');
  const [explanation, setExplanation] = useState('');
  const [recordingExcuse, setRecordingExcuse] = useState(false);

  // Excuse Revoke Modal State
  const [revokeTarget, setRevokeTarget] = useState<DepartureResolutionItem | null>(null);
  const [revocationReason, setRevocationReason] = useState('Pembatalan izin awal');
  const [revokingExcuse, setRevokingExcuse] = useState(false);

  // History Drawer State
  const [historyTarget, setHistoryTarget] = useState<DepartureResolutionItem | null>(null);
  const [historyData, setHistoryData] = useState<any | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const classes = await fetchAssignedClasses();
        if (classes && classes.length > 0) {
          const mapped = classes.map((c: any) => ({
            class_id: String(c.id || c.class_name),
            class_name: c.class_name || String(c.id),
          }));
          setAssignedClasses(mapped);
          if (!selectedClass || !mapped.some((m: any) => m.class_id === selectedClass)) {
            setSelectedClass(mapped[0].class_id);
          }
        } else {
          setAssignedClasses([{ class_id: '7A', class_name: 'Kelas 7A' }]);
          setSelectedClass('7A');
        }
      } catch (err) {
        setAssignedClasses([{ class_id: '7A', class_name: 'Kelas 7A' }]);
        setSelectedClass('7A');
      }
    };
    fetchClasses();
  }, [selectedDate]);

  const loadDepartures = async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getClassDateDepartures(selectedClass, selectedDate);
      setDepartures(res.departures || []);
    } catch (err: any) {
      if (err?.detail?.code === 'EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN' || err?.status === 403) {
        setError('Akses Ditolak: Anda tidak memiliki penugasan aktif untuk mengelola kepulangan kelas ini.');
      } else {
        setError(err?.detail?.message || err?.message || 'Gagal memuat data kepulangan kelas.');
      }
      setDepartures([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClass && selectedDate) {
      loadDepartures();
    }
  }, [selectedClass, selectedDate]);

  const handleRecordExcuseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excuseTarget || !excuseTarget.attendance_id) return;
    setRecordingExcuse(true);
    setError(null);
    setSuccess(null);
    try {
      await recordDepartureExcuse(excuseTarget.attendance_id, {
        reason_code: reasonCode,
        explanation: explanation || undefined,
      });
      setSuccess(`Izin pulang awal berhasil dicatat untuk ${excuseTarget.student_name}.`);
      setExcuseTarget(null);
      loadDepartures();
    } catch (err: any) {
      if (err?.detail?.code === 'ATTENDANCE_PERIOD_FINALIZED') {
        setError('Periode Absensi Finalized: Perubahan pada tanggal ini telah dikunci.');
      } else if (err?.detail?.code === 'EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE') {
        setError('Izin Aktif Ada: Siswa ini sudah memiliki izin pulang awal yang aktif.');
      } else {
        setError(err?.detail?.message || err?.message || 'Gagal mencatat izin pulang awal.');
      }
    } finally {
      setRecordingExcuse(false);
    }
  };

  const handleRevokeExcuseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeTarget || !revokeTarget.attendance_id || !revokeTarget.excuse) return;
    setRevokingExcuse(true);
    setError(null);
    setSuccess(null);
    try {
      await revokeDepartureExcuse(revokeTarget.attendance_id, revokeTarget.excuse.id, {
        revocation_reason: revocationReason,
      });
      setSuccess(`Izin pulang awal untuk ${revokeTarget.student_name} telah dicabut.`);
      setRevokeTarget(null);
      loadDepartures();
    } catch (err: any) {
      if (err?.detail?.code === 'ATTENDANCE_PERIOD_FINALIZED') {
        setError('Periode Absensi Finalized: Perubahan pada tanggal ini telah dikunci.');
      } else {
        setError(err?.detail?.message || err?.message || 'Gagal mencabut izin.');
      }
    } finally {
      setRevokingExcuse(false);
    }
  };

  const handleOpenHistory = async (item: DepartureResolutionItem) => {
    if (!item.attendance_id) return;
    setHistoryTarget(item);
    setLoadingHistory(true);
    try {
      const data = await getDepartureHistory(item.attendance_id);
      setHistoryData(data);
    } catch (err) {
      setHistoryData(null);
    } finally {
      setLoadingHistory(false);
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
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Workspace Kepulangan Awal Siswa</h1>
            <p className="text-sm text-slate-400">Deteksi otomatis pulang lebih awal, pengelolaan izin (excuses), dan verifikasi jadwal.</p>
          </div>
        </div>

        {/* Filter Selection */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Kelas Assigned</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {assignedClasses.map((c) => (
                <option key={c.class_id} value={c.class_id}>{c.class_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Tanggal</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
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

      {/* Finalized Period Warning Banner */}
      {departures.length > 0 && departures[0].is_period_finalized && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-amber-400 text-sm">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            <span>Periode absensi untuk tanggal <strong>{selectedDate}</strong> telah difinalisasi (Locked). Perubahan membutuhkan pengajuan koreksi maker-checker.</span>
          </div>
          <a
            href="/attendance-corrections"
            className="flex items-center gap-1 text-xs font-bold underline hover:text-amber-300 transition-colors"
          >
            Pengajuan Koreksi <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Departures Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-400" />
            Status Kepulangan Siswa ({departures.length} Siswa)
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Menganalisis jadwal dan kepulangan siswa...</div>
        ) : departures.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Tidak ada siswa yang ditemukan di kelas ini pada tanggal terpilih.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-semibold border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Nama Siswa</th>
                  <th className="px-4 py-3">Scan Masuk / Pulang</th>
                  <th className="px-4 py-3">Jadwal Pulang Resmi</th>
                  <th className="px-4 py-3">Status Kepulangan</th>
                  <th className="px-4 py-3">Izin / Catatan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {departures.map((item, idx) => (
                  <tr key={item.student_id || idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-100">{item.student_name}</div>
                      <div className="text-xs text-slate-500">ID: {item.student_id} • {item.class_name}</div>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs">
                      <div>In: {item.effective_check_in || '-'}</div>
                      <div className="text-slate-400">Out: {item.effective_check_out || '-'}</div>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {item.scheduled_dismissal ? (
                        <span>{item.scheduled_dismissal} (Toleransi: {item.grace_period_minutes}m)</span>
                      ) : (
                        <span className="text-slate-600">Belum diatur</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {item.classification === 'EARLY_DEPARTURE' && (
                        <div className="inline-flex flex-col">
                          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> Pulang Awal ({item.minutes_early} Menit Lebih Cepat)
                          </span>
                        </div>
                      )}
                      {item.classification === 'EXCUSED_EARLY_DEPARTURE' && (
                        <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Pulang Awal Berizin ({item.minutes_early}m)
                        </span>
                      )}
                      {item.classification === 'ON_TIME_DEPARTURE' && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-slate-800 text-slate-300">
                          Pulang Tepat Waktu
                        </span>
                      )}
                      {item.classification === 'MISSING_CHECKOUT' && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                          Tanpa Scan Pulang
                        </span>
                      )}
                      {item.classification === 'UNKNOWN_POLICY' && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          Jadwal Belum Ditentukan
                        </span>
                      )}
                      {item.classification === 'NOT_APPLICABLE' && (
                        <span className="px-2 py-0.5 text-xs text-slate-500">Tidak Berlaku</span>
                      )}
                      {item.has_pending_correction && (
                        <div className="mt-1 text-[10px] font-bold text-amber-400 flex items-center gap-1">
                          <Info className="w-3 h-3" /> Ada Pengajuan Koreksi Pending
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-300">
                      {item.excuse ? (
                        <div>
                          <div className="font-semibold text-emerald-400">{item.excuse.reason_code}</div>
                          <div className="text-[11px] text-slate-400">{item.excuse.explanation || 'Tanpa keterangan'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right space-x-2">
                      {item.attendance_id && (
                        <button
                          onClick={() => handleOpenHistory(item)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
                        >
                          Histori
                        </button>
                      )}

                      {item.attendance_id && !item.excuse && item.classification === 'EARLY_DEPARTURE' && (
                        <button
                          onClick={() => setExcuseTarget(item)}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
                        >
                          Catat Izin
                        </button>
                      )}

                      {item.attendance_id && item.excuse && (
                        <button
                          onClick={() => setRevokeTarget(item)}
                          className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition-colors"
                        >
                          Cabut Izin
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

      {/* Modal Record Excuse */}
      {excuseTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              Catat Izin Pulang Awal ({excuseTarget.student_name})
            </h3>
            <form onSubmit={handleRecordExcuseSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Kategori / Kode Alasan</label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  {EXCUSE_REASON_CODES.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Penjelasan / Keterangan Penjemputan</label>
                <textarea
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="Contoh: Dijemput orang tua untuk pemeriksaan dokter"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 h-24"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setExcuseTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={recordingExcuse}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/30 disabled:opacity-50"
                >
                  {recordingExcuse ? 'Menyimpan...' : 'Simpan Izin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Revoke Excuse */}
      {revokeTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-400" />
              Cabut Izin Pulang Awal ({revokeTarget.student_name})
            </h3>
            <form onSubmit={handleRevokeExcuseSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Alasan Pencabutan Izin</label>
                <input
                  type="text"
                  value={revocationReason}
                  onChange={(e) => setRevocationReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRevokeTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={revokingExcuse}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {revokingExcuse ? 'Mencabut...' : 'Cabut Izin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Drawer */}
      {historyTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-lg h-full p-6 space-y-6 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                Histori Kepulangan: {historyTarget.student_name}
              </h3>
              <button
                onClick={() => setHistoryTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {loadingHistory ? (
              <div className="p-8 text-center text-slate-400 text-sm">Memuat histori kepulangan...</div>
            ) : !historyData ? (
              <div className="p-8 text-center text-slate-500 text-sm">Tidak ada data histori.</div>
            ) : (
              <div className="space-y-6 text-sm text-slate-300">
                {/* Excuses Section */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Riwayat Izin Pulang Awal</h4>
                  {historyData.excuses.length === 0 ? (
                    <div className="text-xs text-slate-500">Belum pernah diajukan izin.</div>
                  ) : (
                    <div className="space-y-2">
                      {historyData.excuses.map((e: any) => (
                        <div key={e.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-indigo-400">{e.reason_code}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${e.state === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {e.state}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">{e.explanation || 'Tanpa keterangan'}</div>
                          <div className="text-[10px] text-slate-500">Dicatat oleh {e.recorded_by} pada {e.recorded_at}</div>
                          {e.state === 'REVOKED' && (
                            <div className="text-[10px] text-rose-400 mt-1">Dicabut oleh {e.revoked_by}: {e.revocation_reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Overrides Section */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Override Kepulangan Manual</h4>
                  {historyData.overrides.length === 0 ? (
                    <div className="text-xs text-slate-500">Tidak ada override manual pada absensi ini.</div>
                  ) : (
                    <div className="space-y-2">
                      {historyData.overrides.map((o: any) => (
                        <div key={o.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                          <div className="text-xs font-semibold text-slate-200">Out: {o.override_check_out || '-'}</div>
                          <div className="text-[10px] text-slate-500">Oleh {o.actor} pada {o.timestamp}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
