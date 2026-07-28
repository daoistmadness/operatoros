import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  History,
  MessageSquare,
  RefreshCw,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  addFollowUpNote,
  fetchFollowUpDetail,
  fetchFollowUpHistory,
  updateFollowUpState,
  type FollowUpCase,
  type FollowUpCaseId,
  type FollowUpHistoryItem,
} from '../lib/api/followups';

const RESOLUTION_CODES = [
  { value: 'EXCUSE_DOCUMENTED', label: 'Surat / Alasan Tervalidasi' },
  { value: 'CORRECTION_SUBMITTED', label: 'Koreksi Absensi Diajukan' },
  { value: 'STUDENT_COUNSELED', label: 'Konseling Siswa Selesai' },
  { value: 'GUARDIAN_NOTIFIED', label: 'Orang Tua / Wali Terkonfirmasi' },
  { value: 'DEVICE_MAPPED', label: 'Perangkat / Kartu Teridentifikasi' },
  { value: 'ADMINISTRATIVE_CLOSE', label: 'Penutupan Administratif' },
];

type AttendanceFollowUpDetailModalProps = {
  caseId?: FollowUpCaseId | null;
  onClose: () => void;
  onRefresh?: () => void;
};

type ActionType = 'resolve' | 'dismiss' | 'reopen' | null;

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    if ('response' in error && error.response && typeof error.response === 'object' && 'data' in error.response) {
      const data = error.response.data;
      if (data && typeof data === 'object' && 'detail' in data) {
        const detail = data.detail;
        if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
          return detail.message;
        }
      }
    }
    if ('message' in error && typeof error.message === 'string') return error.message;
  }
  return fallback;
}

export default function AttendanceFollowUpDetailModal({
  caseId,
  onClose,
  onRefresh,
}: AttendanceFollowUpDetailModalProps) {
  const [caseData, setCaseData] = useState<FollowUpCase | null>(null);
  const [history, setHistory] = useState<FollowUpHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Form states
  const [noteBody, setNoteBody] = useState('');
  const [noteType, setNoteType] = useState('INTERNAL_NOTE');
  const [resolutionCode, setResolutionCode] = useState('EXCUSE_DOCUMENTED');
  const [actionNote, setActionNote] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('MEDIUM');
  const [actionType, setActionType] = useState<ActionType>(null);

  const loadData = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError('');
    try {
      const [detail, hist] = await Promise.all([
        fetchFollowUpDetail(caseId),
        fetchFollowUpHistory(caseId),
      ]);
      setCaseData(detail);
      setHistory(hist);
      setSelectedPriority(detail.priority || 'MEDIUM');
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat detail kasus follow-up.'));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleStatusChange = async (
    targetStatus: string,
    extraData: Record<string, unknown> = {},
  ) => {
    if (!caseData || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await updateFollowUpState(caseData.id, {
        target_status: targetStatus,
        version: caseData.version,
        ...extraData,
      });
      setActionType(null);
      setActionNote('');
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(errorMessage(err, 'Gagal memperbarui status kasus.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNote = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!caseData || !noteBody.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await addFollowUpNote(caseData.id, {
        body: noteBody,
        note_type: noteType,
      });
      setNoteBody('');
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(errorMessage(err, 'Gagal menambahkan catatan.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!caseId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Kasus Follow-Up #{caseId}
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Key: {caseData?.exception_key || '...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
            <p className="text-sm font-medium">Memuat detail kasus...</p>
          </div>
        ) : !caseData ? (
          <div className="p-6 text-center">
            <div className="p-4 bg-rose-50 text-rose-700 rounded-lg text-sm mb-4">
              {error || 'Detail kasus follow-up tidak tersedia.'}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 text-slate-700 font-medium rounded-lg text-sm hover:bg-slate-300"
            >
              Tutup
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm flex items-start space-x-2">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Status & Overview Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
              <div>
                <span className="text-xs text-slate-400 uppercase font-semibold">Jenis Pengecualian</span>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{caseData.exception_kind}</p>
              </div>
              <div>
                <span className="text-xs text-slate-400 uppercase font-semibold">Status Alur Kerja</span>
                <div className="mt-0.5">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    caseData.status === 'OPEN' ? 'bg-amber-100 text-amber-800' :
                    caseData.status === 'ACKNOWLEDGED' ? 'bg-blue-100 text-blue-800' :
                    caseData.status === 'IN_PROGRESS' ? 'bg-indigo-100 text-indigo-800' :
                    caseData.status === 'MONITORING' ? 'bg-purple-100 text-purple-800' :
                    caseData.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800' :
                    caseData.status === 'DISMISSED' ? 'bg-slate-100 text-slate-700' :
                    'bg-rose-100 text-rose-800'
                  }`}>
                    {caseData.status}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs text-slate-400 uppercase font-semibold">Tingkat Prioritas</span>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{caseData.priority}</p>
              </div>
            </div>

            {/* Case Details Box */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Informasi Objek & Bukti</h3>
              <div className="bg-white p-4 border border-slate-200 rounded-xl space-y-2 text-sm">
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Siswa:</span>
                  <span className="font-semibold text-slate-800">{caseData.student_name || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Kelas:</span>
                  <span className="font-semibold text-slate-800">{caseData.class_name || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Tanggal Kejadian:</span>
                  <span className="font-semibold text-slate-800">{caseData.exception_date || 'N/A'}</span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 block mb-1">Ringkasan Bukti:</span>
                  <p className="text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 font-mono text-xs">
                    {caseData.evidence_summary || 'Tidak ada ringkasan bukti.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Workflow Action Bar */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tindakan Alur Kerja</h3>
              <div className="flex flex-wrap gap-2">
                {caseData.status === 'OPEN' && (
                  <button
                    disabled={submitting}
                    onClick={() => handleStatusChange('ACKNOWLEDGED')}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>Konfirmasi (Acknowledge)</span>
                  </button>
                )}

                {(caseData.status === 'OPEN' || caseData.status === 'ACKNOWLEDGED' || caseData.status === 'MONITORING' || caseData.status === 'REOPENED') && (
                  <button
                    disabled={submitting}
                    onClick={() => handleStatusChange('IN_PROGRESS')}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <Clock className="w-4 h-4" />
                    <span>Mulai Penanganan (In Progress)</span>
                  </button>
                )}

                {caseData.status === 'IN_PROGRESS' && (
                  <button
                    disabled={submitting}
                    onClick={() => handleStatusChange('MONITORING')}
                    className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <Clock className="w-4 h-4" />
                    <span>Pantau Perkembangan (Monitoring)</span>
                  </button>
                )}

                {(caseData.status === 'IN_PROGRESS' || caseData.status === 'MONITORING') && (
                  <button
                    disabled={submitting}
                    onClick={() => setActionType('resolve')}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Selesaikan Kasus (Resolve)</span>
                  </button>
                )}

                {caseData.status !== 'RESOLVED' && caseData.status !== 'DISMISSED' && (
                  <button
                    disabled={submitting}
                    onClick={() => setActionType('dismiss')}
                    className="px-3.5 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Abaikan / Dismiss</span>
                  </button>
                )}

                {(caseData.status === 'RESOLVED' || caseData.status === 'DISMISSED') && (
                  <button
                    disabled={submitting}
                    onClick={() => setActionType('reopen')}
                    className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Buka Kembali Kasus (Reopen)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Action Dialog Sub-Form */}
            {actionType === 'resolve' && (
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-emerald-800 uppercase">Penyelesaian Kasus</h4>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kode Resolusi</label>
                  <select
                    value={resolutionCode}
                    onChange={(e) => setResolutionCode(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    {RESOLUTION_CODES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Resolusi (Opsional)</label>
                  <textarea
                    rows={2}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Jelaskan tindakan yang telah diambil..."
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setActionType(null)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg"
                  >
                    Batal
                  </button>
                  <button
                    disabled={submitting}
                    onClick={() => handleStatusChange('RESOLVED', { resolution_code: resolutionCode, resolution_note: actionNote })}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700"
                  >
                    Konfirmasi Selesai
                  </button>
                </div>
              </div>
            )}

            {actionType === 'dismiss' && (
              <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase">Abaikan Kasus Follow-Up</h4>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Pengabaian</label>
                  <textarea
                    rows={2}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Berikan alasan mengapa kasus ini diabaikan..."
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setActionType(null)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg"
                  >
                    Batal
                  </button>
                  <button
                    disabled={submitting || !actionNote.trim()}
                    onClick={() => handleStatusChange('DISMISSED', { resolution_note: actionNote })}
                    className="px-3 py-1.5 bg-slate-700 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
                  >
                    Konfirmasi Abaikan
                  </button>
                </div>
              </div>
            )}

            {actionType === 'reopen' && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-rose-800 uppercase">Buka Kembali Kasus</h4>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Pembukaan Kembali</label>
                  <textarea
                    rows={2}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Jelaskan alasan mengapa kasus perlu dibuka kembali..."
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setActionType(null)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs font-medium rounded-lg"
                  >
                    Batal
                  </button>
                  <button
                    disabled={submitting || !actionNote.trim()}
                    onClick={() => handleStatusChange('REOPENED', { resolution_note: actionNote })}
                    className="px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50"
                  >
                    Konfirmasi Buka Kembali
                  </button>
                </div>
              </div>
            )}

            {/* Tabs for Notes & History */}
            <div className="border-b border-slate-200 flex space-x-4">
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-2 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Catatan Internal ({caseData.notes?.length || 0})</span>
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`pb-2 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-colors ${
                  activeTab === 'history'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <History className="w-4 h-4" />
                <span>Riwayat & Audit ({history.length})</span>
              </button>
            </div>

            {/* Notes Section */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <form onSubmit={handleAddNote} className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="flex space-x-2">
                    <select
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value)}
                      className="text-xs p-1.5 border border-slate-300 rounded-lg bg-white font-medium text-slate-700"
                    >
                      <option value="INTERNAL_NOTE">Catatan Internal</option>
                      <option value="GUARDIAN_CONTACT">Kontak Orang Tua</option>
                      <option value="COUNSELING">Konseling Siswa</option>
                      <option value="ADMINISTRATIVE">Administrasi</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Tulis catatan penanganan kasus..."
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting || !noteBody.trim()}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      Tambah Catatan
                    </button>
                  </div>
                </form>

                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {caseData.notes && caseData.notes.length > 0 ? (
                    caseData.notes.map((n) => (
                      <div key={n.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-1 text-xs">
                        <div className="flex justify-between items-center text-slate-500">
                          <span className="font-semibold text-slate-700">{n.created_by_user_id ? `User #${n.created_by_user_id}` : 'Sistem'}</span>
                          <span>{new Date(n.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-800">{n.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 italic text-center py-4">Belum ada catatan internal.</p>
                  )}
                </div>
              </div>
            )}

            {/* Audit History Section */}
            {activeTab === 'history' && (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {history.length > 0 ? (
                  history.map((h) => (
                    <div key={h.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                      <div className="flex justify-between text-slate-500">
                        <span className="font-bold text-slate-700">{h.action}</span>
                        <span>{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-600 font-mono text-[11px]">Aktor: {h.actor}</p>
                      {h.metadata_payload && (
                        <pre className="p-2 bg-slate-100 rounded text-[10px] text-slate-700 overflow-x-auto">
                          {JSON.stringify(h.metadata_payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic text-center py-4">Belum ada catatan audit.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
