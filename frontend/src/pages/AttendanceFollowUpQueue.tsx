import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  createFollowUpCase,
  fetchFollowUpCandidates,
  fetchFollowUpCases,
  fetchFollowUpMetrics,
  type FollowUpCandidate,
  type FollowUpCase,
  type FollowUpMetrics,
} from '../lib/api/followups';
import AttendanceFollowUpDetailModal from '../components/AttendanceFollowUpDetailModal';

function getFollowUpError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const candidate = error as {
    message?: unknown;
    response?: {
      data?: {
        detail?: {
          message?: unknown;
        };
      };
    };
  };
  const detailMessage = candidate.response?.data?.detail?.message;
  if (typeof detailMessage === 'string' && detailMessage) return detailMessage;
  return typeof candidate.message === 'string' && candidate.message ? candidate.message : fallback;
}

export default function AttendanceFollowUpQueue() {
  const [activeTab, setActiveTab] = useState<'candidates' | 'cases'>('candidates');
  const [candidates, setCandidates] = useState<FollowUpCandidate[]>([]);
  const [cases, setCases] = useState<FollowUpCase[]>([]);
  const [metrics, setMetrics] = useState<FollowUpMetrics>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected Detail Modal
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [submittingKey, setSubmittingKey] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [candRes, caseRes, metricRes] = await Promise.all([
        fetchFollowUpCandidates(kindFilter ? { exception_kind: kindFilter } : {}),
        fetchFollowUpCases({
          ...(kindFilter ? { exception_kind: kindFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(priorityFilter ? { priority: priorityFilter } : {}),
        }),
        fetchFollowUpMetrics(),
      ]);
      setCandidates(Array.isArray(candRes) ? candRes : candRes.items);
      setCases(Array.isArray(caseRes) ? caseRes : caseRes.items);
      setMetrics(metricRes);
    } catch (err: unknown) {
      setError(getFollowUpError(err, 'Gagal memuat data antrean pengecualian.'));
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter, priorityFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleMaterializeCandidate = async (candidate: FollowUpCandidate) => {
    setSubmittingKey(candidate.exception_key);
    setError('');
    try {
      const created = await createFollowUpCase({
        exception_key: candidate.exception_key,
        exception_kind: candidate.exception_kind,
        student_master_id: candidate.student_master_id,
        academic_class_id: candidate.academic_class_id,
        exception_date: candidate.exception_date,
        priority: candidate.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
      });
      await loadData();
      setSelectedCaseId(created.id);
    } catch (err: unknown) {
      setError(getFollowUpError(err, 'Gagal membuat kasus follow-up.'));
    } finally {
      setSubmittingKey('');
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchName = (c.student_name || '').toLowerCase().includes(term);
      const matchClass = (c.class_name || '').toLowerCase().includes(term);
      const matchKind = (c.exception_kind || '').toLowerCase().includes(term);
      if (!matchName && !matchClass && !matchKind) return false;
    }
    return true;
  });

  const filteredCases = cases.filter((c) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchName = (c.student_name || '').toLowerCase().includes(term);
      const matchClass = (c.class_name || '').toLowerCase().includes(term);
      const matchKind = (c.exception_kind || '').toLowerCase().includes(term);
      if (!matchName && !matchClass && !matchKind) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Antrean Follow-Up Pengecualian Absensi
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Materialisasi kasus tindak lanjut absensi tanpa menduplikasi kalkulasi data utama.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          <span>Muat Ulang</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold uppercase text-slate-400">Kandidat Pengecualian</span>
          <p className="text-2xl font-black text-slate-800 mt-1">{candidates.length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold uppercase text-slate-400">Kasus Terbuka (Open)</span>
          <p className="text-2xl font-black text-amber-600 mt-1">{metrics.open_cases || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold uppercase text-slate-400">Dalam Penanganan</span>
          <p className="text-2xl font-black text-indigo-600 mt-1">{metrics.in_progress_count || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold uppercase text-slate-400">Selesai (Resolved)</span>
          <p className="text-2xl font-black text-emerald-600 mt-1">{metrics.resolved_count || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold uppercase text-slate-400">Kasus Aktif Total</span>
          <p className="text-2xl font-black text-purple-600 mt-1">{metrics.active_cases || 0}</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Controls & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-100 pb-4">
          {/* Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('candidates')}
              className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === 'candidates'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kandidat Temuan ({candidates.length})
            </button>
            <button
              onClick={() => setActiveTab('cases')}
              className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === 'cases'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar Kasus ({cases.length})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Cari siswa, kelas, jenis..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1 text-slate-400 text-xs font-semibold uppercase mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>

          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="text-xs p-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-700"
          >
            <option value="">Semua Jenis Pengecualian</option>
            <option value="UNEXPLAINED_ABSENCE">Unexplained Absence (Alfa)</option>
            <option value="LATE_ARRIVAL">Late Arrival (Keterlambatan)</option>
            <option value="MISSING_CHECKOUT">Missing Checkout</option>
            <option value="UNEXPLAINED_EARLY_DEPARTURE">Unexplained Early Departure</option>
            <option value="PENDING_CORRECTION">Pending Correction Request</option>
            <option value="UNMATCHED_DEVICE_IDENTITY">Unmatched Device Identity</option>
          </select>

          {activeTab === 'cases' && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs p-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-700"
              >
                <option value="">Semua Status Kasus</option>
                <option value="OPEN">OPEN</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="MONITORING">MONITORING</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="DISMISSED">DISMISSED</option>
                <option value="REOPENED">REOPENED</option>
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="text-xs p-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-700"
              >
                <option value="">Semua Prioritas</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Data Table Panel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
            <p className="text-sm font-medium">Memuat data antrean...</p>
          </div>
        ) : activeTab === 'candidates' ? (
          /* Candidates Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Jenis Pengecualian</th>
                  <th className="p-3.5">Nama Siswa</th>
                  <th className="p-3.5">Kelas</th>
                  <th className="p-3.5">Tanggal</th>
                  <th className="p-3.5">Tingkat Severitas</th>
                  <th className="p-3.5">Ringkasan Bukti</th>
                  <th className="p-3.5 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCandidates.length > 0 ? (
                  filteredCandidates.map((cand) => (
                    <tr key={cand.exception_key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-bold text-slate-800">{cand.exception_kind}</td>
                      <td className="p-3.5 font-medium text-slate-900">{cand.student_name || 'N/A'}</td>
                      <td className="p-3.5 text-slate-600">{cand.class_name || '-'}</td>
                      <td className="p-3.5 text-slate-600 font-mono">{cand.exception_date || '-'}</td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                          cand.severity === 'HIGH' ? 'bg-rose-100 text-rose-700' :
                          cand.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {cand.severity}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-600 max-w-xs truncate">{cand.evidence_summary}</td>
                      <td className="p-3.5 text-right">
                        {cand.materialized_case ? (
                          <button
                            onClick={() => setSelectedCaseId(cand.materialized_case?.id ?? null)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium inline-flex items-center space-x-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat Kasus #{cand.materialized_case.id}</span>
                          </button>
                        ) : (
                          <button
                            disabled={submittingKey === cand.exception_key}
                            onClick={() => handleMaterializeCandidate(cand)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium inline-flex items-center space-x-1 shadow-2xs transition-colors disabled:opacity-50"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Tangani Kasus</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                      Tidak ada kandidat pengecualian ditemukan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Cases Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">ID Kasus</th>
                  <th className="p-3.5">Jenis</th>
                  <th className="p-3.5">Nama Siswa</th>
                  <th className="p-3.5">Kelas</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Prioritas</th>
                  <th className="p-3.5">Penanggung Jawab</th>
                  <th className="p-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCases.length > 0 ? (
                  filteredCases.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-slate-900">#{c.id}</td>
                      <td className="p-3.5 font-medium text-slate-800">{c.exception_kind}</td>
                      <td className="p-3.5 font-medium text-slate-900">{c.student_name || 'N/A'}</td>
                      <td className="p-3.5 text-slate-600">{c.class_name || '-'}</td>
                      <td className="p-3.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'OPEN' ? 'bg-amber-100 text-amber-800' :
                          c.status === 'ACKNOWLEDGED' ? 'bg-blue-100 text-blue-800' :
                          c.status === 'IN_PROGRESS' ? 'bg-indigo-100 text-indigo-800' :
                          c.status === 'MONITORING' ? 'bg-purple-100 text-purple-800' :
                          c.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800' :
                          c.status === 'DISMISSED' ? 'bg-slate-100 text-slate-700' :
                          'bg-rose-100 text-rose-800'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-slate-700">{c.priority}</td>
                      <td className="p-3.5 text-slate-600">
                        {c.assigned_to_user_id ? `User #${c.assigned_to_user_id}` : 'Belum Ditugaskan'}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setSelectedCaseId(c.id)}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-medium inline-flex items-center space-x-1 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detail</span>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400 italic">
                      Tidak ada kasus follow-up ditemukan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Case Detail Modal */}
      {selectedCaseId && (
        <AttendanceFollowUpDetailModal
          caseId={selectedCaseId}
          onClose={() => setSelectedCaseId(null)}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}
