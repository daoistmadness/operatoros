import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Inbox,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import CorrectionSelfConfirmModal from '../components/CorrectionSelfConfirmModal';
import { useDeploymentMode } from '../context/DeploymentModeContext';
import { fetchOperatorWorkQueue, type OperatorWorkQueueItem } from '../lib/api/operator';

type SelectedCorrection = {
  id: number;
  version: number;
  proposed_status: string;
  explanation: string;
};

export default function OperatorWorkQueue() {
  const { isSingleUserMode } = useDeploymentMode();
  const [items, setItems] = useState<OperatorWorkQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState('ALL');
  const [dueStateFilter, setDueStateFilter] = useState('ALL');

  // Selected correction for self-confirm modal
  const [selectedCorrection, setSelectedCorrection] = useState<SelectedCorrection | null>(null);

  const loadQueue = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchOperatorWorkQueue();
      setItems(data);
    } catch (_error: unknown) {
      setErrorMessage('Gagal memuat antrean kerja operator. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (itemTypeFilter !== 'ALL' && item.item_type !== itemTypeFilter) return false;
      if (dueStateFilter !== 'ALL' && item.derived_due_state !== dueStateFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchStudent = item.student_display_label?.toLowerCase().includes(q);
        const matchEvidence = item.evidence_summary?.toLowerCase().includes(q);
        if (!matchTitle && !matchStudent && !matchEvidence) return false;
      }
      return true;
    });
  }, [items, itemTypeFilter, dueStateFilter, searchQuery]);

  // Section grouping
  const sections = useMemo(() => {
    const overdue = filteredItems.filter((i) => i.derived_due_state === 'OVERDUE');
    const dueToday = filteredItems.filter((i) => i.derived_due_state === 'DUE_TODAY');
    const dueLater = filteredItems.filter((i) => i.derived_due_state === 'DUE_LATER');
    const noDueDate = filteredItems.filter((i) => i.derived_due_state === 'NO_DUE_DATE');
    const completed = filteredItems.filter((i) => i.derived_due_state === 'COMPLETED');

    return { overdue, dueToday, dueLater, noDueDate, completed };
  }, [filteredItems]);

  const renderDueStateBadge = (dueState: string) => {
    switch (dueState) {
      case 'OVERDUE':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" /> Terlambat
          </span>
        );
      case 'DUE_TODAY':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <Clock className="h-3 w-3" /> Jatuh Tempo Hari Ini
          </span>
        );
      case 'DUE_LATER':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
            Mendatang
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Selesai
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Tanpa Tanggal
          </span>
        );
    }
  };

  const renderItemCard = (item: OperatorWorkQueueItem) => (
    <div
      key={item.source_id}
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              {item.item_type.replace('_', ' ')}
            </span>
            <h4 className="font-semibold text-slate-900 dark:text-white">{item.title}</h4>
            <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
              {item.student_display_label} {item.class_reference ? `(${item.class_reference})` : ''}
            </p>
          </div>
          {renderDueStateBadge(item.derived_due_state)}
        </div>

        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{item.evidence_summary}</p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
        <span className="text-[11px] text-slate-400">
          {item.event_date ? `Tanggal: ${item.event_date}` : 'Aktivitas Terbaru'}
        </span>

        <div className="flex items-center gap-2">
          {item.item_type === 'CORRECTION_REQUEST' && isSingleUserMode && item.workflow_status !== 'APPROVED' && (
            <button
              onClick={() =>
                setSelectedCorrection({
                  id: item.metadata.id,
                  version: item.metadata.version,
                  proposed_status: item.title.replace('Koreksi: Status ', ''),
                  explanation: item.evidence_summary,
                })
              }
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Konfirmasi Mandiri
            </button>
          )}

          <a
            href={item.source_route}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Buka <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Antrean Kerja Operator
            </h1>
            {isSingleUserMode && (
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Single-Operator Offline
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Pusat konsolidasi pengecualian kehadiran, koreksi mandiri, dan tindak lanjut harian.
          </p>
        </div>

        <button
          onClick={loadQueue}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari berdasarkan nama siswa, judul, atau ringkasan..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <Filter className="h-3.5 w-3.5" /> Tipe:
          </div>
          <select
            value={itemTypeFilter}
            onChange={(e) => setItemTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="ALL">Semua Tipe Pekerjaan</option>
            <option value="FOLLOWUP_CASE">Kasus Follow-Up</option>
            <option value="FOLLOWUP_CANDIDATE">Kandidat Pengecualian</option>
            <option value="CORRECTION_REQUEST">Permintaan Koreksi</option>
            <option value="UNMATCHED_DEVICE">Perangkat Belum Terhubung</option>
          </select>

          <select
            value={dueStateFilter}
            onChange={(e) => setDueStateFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="ALL">Semua Tanggal Tempo</option>
            <option value="OVERDUE">Terlambat</option>
            <option value="DUE_TODAY">Jatuh Tempo Hari Ini</option>
            <option value="DUE_LATER">Mendatang</option>
            <option value="NO_DUE_DATE">Tanpa Tanggal</option>
            <option value="COMPLETED">Selesai</option>
          </select>
        </div>
      </div>

      {/* Main Content Sections */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : errorMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-950 dark:bg-rose-900/30 dark:text-rose-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <Inbox className="h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 font-semibold text-slate-700 dark:text-slate-300">Semua Pekerjaan Selesai</h3>
          <p className="mt-1 text-xs text-slate-500">Tidak ada antrean pekerjaan aktif saat ini.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Overdue Section */}
          {sections.overdue.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <h3 className="font-bold text-rose-900 dark:text-rose-400">
                  Memerlukan Perhatian Segera (Terlambat - {sections.overdue.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sections.overdue.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Due Today Section */}
          {sections.dueToday.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <h3 className="font-bold text-amber-900 dark:text-amber-400">
                  Jatuh Tempo Hari Ini ({sections.dueToday.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sections.dueToday.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Due Later & No Due Date */}
          {(sections.dueLater.length > 0 || sections.noDueDate.length > 0) && (
            <div>
              <h3 className="mb-3 font-bold text-slate-900 dark:text-white">
                Antrean Pekerjaan Aktif ({sections.dueLater.length + sections.noDueDate.length})
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sections.dueLater.map(renderItemCard)}
                {sections.noDueDate.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Completed Section */}
          {sections.completed.length > 0 && (
            <div>
              <h3 className="mb-3 font-bold text-slate-500">Baru Saja Selesai ({sections.completed.length})</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-75">
                {sections.completed.map(renderItemCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Self Confirmation Modal */}
      {selectedCorrection && (
        <CorrectionSelfConfirmModal
          correction={selectedCorrection}
          onClose={() => setSelectedCorrection(null)}
          onSuccess={() => {
            setSelectedCorrection(null);
            loadQueue();
          }}
        />
      )}
    </div>
  );
}
