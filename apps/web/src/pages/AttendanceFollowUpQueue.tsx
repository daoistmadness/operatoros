import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  Filter,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { createColumnHelper, columnVisibilityFeature, flexRender, tableFeatures, useTable } from '@tanstack/react-table';
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
import { DataTableColumnVisibility, DataTableToolbar } from '../components/common/data-table-toolbar';
import { VirtualizedDataTable } from '../components/common/virtualized-data-table';
import { useUrlSearchParams } from '../lib/router/search';

const tableFeaturesForQueue = tableFeatures({ columnVisibilityFeature });
const candidateColumn = createColumnHelper<typeof tableFeaturesForQueue, FollowUpCandidate>();
const caseColumn = createColumnHelper<typeof tableFeaturesForQueue, FollowUpCase>();
const tabs = ['candidates', 'cases'] as const;
const exceptionKinds = [
  'UNEXPLAINED_ABSENCE',
  'LATE_ARRIVAL',
  'MISSING_CHECKOUT',
  'UNEXPLAINED_EARLY_DEPARTURE',
  'PENDING_CORRECTION',
  'UNMATCHED_DEVICE_IDENTITY',
] as const;
const caseStatuses = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'MONITORING', 'RESOLVED', 'DISMISSED', 'REOPENED'] as const;
const priorities = ['HIGH', 'MEDIUM', 'LOW'] as const;

function singleSearchValue(params: URLSearchParams, key: string): string {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] ?? '' : '';
}

function oneOf<TOptions extends readonly string[]>(value: string, options: TOptions): TOptions[number] | '' {
  return options.find((option) => option === value) ?? '';
}

function candidateCellClassName(columnId: string): string {
  if (columnId === 'actions') return 'whitespace-nowrap p-3.5 text-right';
  if (columnId === 'evidence_summary') return 'max-w-xs truncate whitespace-nowrap p-3.5 text-slate-600';
  if (columnId === 'exception_kind') return 'whitespace-nowrap p-3.5 font-bold text-slate-800';
  if (columnId === 'student_name') return 'whitespace-nowrap p-3.5 font-medium text-slate-900';
  if (columnId === 'exception_date') return 'whitespace-nowrap p-3.5 font-mono text-slate-600';
  if (columnId === 'class_name') return 'whitespace-nowrap p-3.5 text-slate-600';
  return 'whitespace-nowrap p-3.5';
}

function caseCellClassName(columnId: string): string {
  if (columnId === 'actions') return 'whitespace-nowrap p-3.5 text-right';
  if (columnId === 'id') return 'whitespace-nowrap p-3.5 font-mono font-bold text-slate-900';
  if (columnId === 'exception_kind') return 'whitespace-nowrap p-3.5 font-medium text-slate-800';
  if (columnId === 'student_name') return 'whitespace-nowrap p-3.5 font-medium text-slate-900';
  if (columnId === 'class_name' || columnId === 'assigned_to_user_id') return 'whitespace-nowrap p-3.5 text-slate-600';
  if (columnId === 'priority') return 'whitespace-nowrap p-3.5 font-semibold text-slate-700';
  return 'whitespace-nowrap p-3.5';
}

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
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const activeTab = oneOf(singleSearchValue(searchParams, 'tab'), tabs) || 'candidates';
  const kindFilter = oneOf(singleSearchValue(searchParams, 'exception_kind'), exceptionKinds);
  const statusFilter = oneOf(singleSearchValue(searchParams, 'status'), caseStatuses);
  const priorityFilter = oneOf(singleSearchValue(searchParams, 'priority'), priorities);
  const [candidates, setCandidates] = useState<FollowUpCandidate[]>([]);
  const [cases, setCases] = useState<FollowUpCase[]>([]);
  const [metrics, setMetrics] = useState<FollowUpMetrics>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');

  // Selected Detail Modal
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [submittingKey, setSubmittingKey] = useState('');
  const setUrlFilter = useCallback((key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, [setSearchParams]);

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

  const handleMaterializeCandidate = useCallback(async (candidate: FollowUpCandidate) => {
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
  }, [loadData]);

  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return [candidate.student_name, candidate.class_name, candidate.exception_kind]
      .some((value) => (value || '').toLowerCase().includes(term));
  }), [candidates, searchTerm]);

  const filteredCases = useMemo(() => cases.filter((item) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return [item.student_name, item.class_name, item.exception_kind]
      .some((value) => (value || '').toLowerCase().includes(term));
  }), [cases, searchTerm]);

  const candidateColumns = useMemo(() => candidateColumn.columns([
    candidateColumn.accessor('exception_kind', { header: 'Jenis Pengecualian', cell: (info) => info.getValue() }),
    candidateColumn.accessor('student_name', { header: 'Nama Siswa', cell: (info) => info.getValue() || 'N/A' }),
    candidateColumn.accessor('class_name', { header: 'Kelas', cell: (info) => info.getValue() || '-' }),
    candidateColumn.accessor('exception_date', { header: 'Tanggal', cell: (info) => info.getValue() || '-' }),
    candidateColumn.accessor('severity', {
      header: 'Tingkat Severitas',
      cell: (info) => {
        const severity = info.getValue();
        const className = severity === 'HIGH' ? 'bg-rose-100 text-rose-700' : severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700';
        return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`}>{severity || 'UNKNOWN'}</span>;
      },
    }),
    candidateColumn.accessor('evidence_summary', { header: 'Ringkasan Bukti', cell: (info) => info.getValue() || '-' }),
    candidateColumn.display({
      id: 'actions',
      header: 'Tindakan',
      enableHiding: false,
      cell: ({ row }) => {
        const candidate = row.original;
        return candidate.materialized_case ? (
          <button
            type="button"
            onClick={() => setSelectedCaseId(candidate.materialized_case?.id ?? null)}
            className="inline-flex items-center space-x-1 rounded-lg bg-slate-100 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-200"
          >
            <Eye className="size-3.5" />
            <span>Lihat Kasus #{candidate.materialized_case.id}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={submittingKey === candidate.exception_key}
            onClick={() => void handleMaterializeCandidate(candidate)}
            className="inline-flex items-center space-x-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white shadow-2xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            <span>Tangani Kasus</span>
          </button>
        );
      },
    }),
  ]), [handleMaterializeCandidate, submittingKey]);

  const caseColumns = useMemo(() => caseColumn.columns([
    caseColumn.accessor('id', { header: 'ID Kasus', cell: (info) => `#${info.getValue()}` }),
    caseColumn.accessor('exception_kind', { header: 'Jenis', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('student_name', { header: 'Nama Siswa', cell: (info) => info.getValue() || 'N/A' }),
    caseColumn.accessor('class_name', { header: 'Kelas', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('status', {
      header: 'Status',
      cell: (info) => {
        const status = info.getValue() || 'UNKNOWN';
        const className = status === 'OPEN' ? 'bg-amber-100 text-amber-800'
          : status === 'ACKNOWLEDGED' ? 'bg-blue-100 text-blue-800'
          : status === 'IN_PROGRESS' ? 'bg-indigo-100 text-indigo-800'
          : status === 'MONITORING' ? 'bg-purple-100 text-purple-800'
          : status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800'
          : status === 'DISMISSED' ? 'bg-slate-100 text-slate-700'
          : 'bg-rose-100 text-rose-800';
        return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${className}`}>{status}</span>;
      },
    }),
    caseColumn.accessor('priority', { header: 'Prioritas', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('assigned_to_user_id', { header: 'Penanggung Jawab', cell: (info) => info.getValue() ? `User #${info.getValue()}` : 'Belum Ditugaskan' }),
    caseColumn.display({
      id: 'actions',
      header: 'Aksi',
      enableHiding: false,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setSelectedCaseId(row.original.id)}
          className="inline-flex items-center space-x-1 rounded-lg bg-indigo-50 px-3 py-1.5 font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
        >
          <Eye className="size-3.5" />
          <span>Detail</span>
        </button>
      ),
    }),
  ]), []);

  const candidateTable = useTable({
    features: tableFeaturesForQueue,
    data: filteredCandidates,
    columns: candidateColumns,
    getRowId: (candidate) => candidate.exception_key,
  });
  const caseTable = useTable({
    features: tableFeaturesForQueue,
    data: filteredCases,
    columns: caseColumns,
    getRowId: (item) => String(item.id),
  });

  const candidateColumnOptions = candidateTable.getAllLeafColumns()
    .filter((column) => column.getCanHide())
    .map((column) => ({
      id: column.id,
      label: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
      visible: column.getIsVisible(),
    }));
  const caseColumnOptions = caseTable.getAllLeafColumns()
    .filter((column) => column.getCanHide())
    .map((column) => ({
      id: column.id,
      label: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
      visible: column.getIsVisible(),
    }));

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
              type="button"
              aria-pressed={activeTab === 'candidates'}
              onClick={() => setUrlFilter('tab', 'candidates')}
              className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === 'candidates'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kandidat Temuan ({candidates.length})
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'cases'}
              onClick={() => setUrlFilter('tab', 'cases')}
              className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === 'cases'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar Kasus ({cases.length})
            </button>
          </div>

          {/* Search may contain student identifiers, so it stays out of the URL and browser history. */}
          <DataTableToolbar
            searchId="follow-up-search"
            searchLabel="Search students, classes, and exception types"
            searchPlaceholder="Cari siswa, kelas, jenis..."
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
          >
            <DataTableColumnVisibility
              columns={activeTab === 'candidates' ? candidateColumnOptions : caseColumnOptions}
              onChange={(id, visible) => {
                if (activeTab === 'candidates') candidateTable.getColumn(id)?.toggleVisibility(visible);
                else caseTable.getColumn(id)?.toggleVisibility(visible);
              }}
            />
          </DataTableToolbar>
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1 text-slate-400 text-xs font-semibold uppercase mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>

          <select
            aria-label="Exception type filter"
            value={kindFilter}
            onChange={(e) => setUrlFilter('exception_kind', e.target.value)}
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
                aria-label="Case status filter"
                value={statusFilter}
                onChange={(e) => setUrlFilter('status', e.target.value)}
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
                aria-label="Case priority filter"
                value={priorityFilter}
                onChange={(e) => setUrlFilter('priority', e.target.value)}
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
          <VirtualizedDataTable
            caption="Attendance exception candidates"
            rows={candidateTable.getRowModel().rows}
            getRowId={(row) => row.id}
            columnCount={candidateTable.getVisibleLeafColumns().length}
            emptyMessage="Tidak ada kandidat pengecualian ditemukan."
            header={(
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left font-semibold uppercase text-slate-500">
                {candidateTable.getHeaderGroups().map((group) => (
                  <tr key={group.id} aria-rowindex={1}>
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" className="p-3.5">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
            )}
            renderCells={(row) => row.getVisibleCells().map((cell) => (
              <td key={cell.id} className={candidateCellClassName(cell.column.id)}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          />
        ) : (
          <VirtualizedDataTable
            caption="Attendance follow-up cases"
            rows={caseTable.getRowModel().rows}
            getRowId={(row) => row.id}
            columnCount={caseTable.getVisibleLeafColumns().length}
            emptyMessage="Tidak ada kasus follow-up ditemukan."
            header={(
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left font-semibold uppercase text-slate-500">
                {caseTable.getHeaderGroups().map((group) => (
                  <tr key={group.id} aria-rowindex={1}>
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" className="p-3.5">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
            )}
            renderCells={(row) => row.getVisibleCells().map((cell) => (
              <td key={cell.id} className={caseCellClassName(cell.column.id)}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          />
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
