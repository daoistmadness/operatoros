import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Eye,
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
import { FilterBar } from '../components/common/filter-bar';
import { PageHeader } from '../components/common/page-header';
import { LoadingState } from '../components/common/state-message';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
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
  if (columnId === 'actions') return 'whitespace-nowrap px-3 py-2';
  if (columnId === 'evidence_summary') return 'max-w-xs truncate whitespace-nowrap px-3 py-2 text-slate-600';
  if (columnId === 'exception_kind') return 'whitespace-nowrap px-3 py-2 font-bold text-slate-800';
  if (columnId === 'student_name') return 'whitespace-nowrap px-3 py-2 font-medium text-slate-900';
  if (columnId === 'exception_date') return 'whitespace-nowrap px-3 py-2 font-mono text-slate-600';
  if (columnId === 'class_name') return 'whitespace-nowrap px-3 py-2 text-slate-600';
  return 'whitespace-nowrap px-3 py-2';
}

function caseCellClassName(columnId: string): string {
  if (columnId === 'actions') return 'whitespace-nowrap px-3 py-2';
  if (columnId === 'id') return 'whitespace-nowrap px-3 py-2 font-mono font-bold text-slate-900';
  if (columnId === 'exception_kind') return 'whitespace-nowrap px-3 py-2 font-medium text-slate-800';
  if (columnId === 'student_name') return 'whitespace-nowrap px-3 py-2 font-medium text-slate-900';
  if (columnId === 'class_name' || columnId === 'assigned_to_user_id') return 'whitespace-nowrap px-3 py-2 text-slate-600';
  if (columnId === 'priority') return 'whitespace-nowrap px-3 py-2 font-semibold text-slate-700';
  return 'whitespace-nowrap px-3 py-2';
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
  const caseParam = singleSearchValue(searchParams, 'case_id');
  const linkedCaseId = /^[1-9]\d*$/.test(caseParam) && Number.isSafeInteger(Number(caseParam)) ? Number(caseParam) : null;
  const activeTab = oneOf(singleSearchValue(searchParams, 'tab'), tabs) || (linkedCaseId ? 'cases' : 'candidates');
  const kindFilter = oneOf(singleSearchValue(searchParams, 'exception_kind'), exceptionKinds);
  const statusFilter = oneOf(singleSearchValue(searchParams, 'status'), caseStatuses);
  const priorityFilter = oneOf(singleSearchValue(searchParams, 'priority'), priorities);
  const [candidates, setCandidates] = useState<FollowUpCandidate[]>([]);
  const [cases, setCases] = useState<FollowUpCase[]>([]);
  const [metrics, setMetrics] = useState<FollowUpMetrics>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; source: 'load' | 'action' } | null>(null);
  const countsAvailable = !loading && error?.source !== 'load';

  // Filters
  const [searchTerm, setSearchTerm] = useState('');

  // Selected Detail Modal
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const caseId = linkedCaseId ?? selectedCaseId;
  const caseTrigger = useRef<HTMLButtonElement>(null);
  const casesTab = useRef<HTMLButtonElement>(null);

  const closeCase = () => {
    setSelectedCaseId(null);
    if (linkedCaseId !== null) {
      setSearchParams((params) => {
        params.delete('case_id');
        if (!params.has('tab')) params.set('tab', 'cases');
        return params;
      }, { replace: true });
    }
  };
  const [submittingKey, setSubmittingKey] = useState('');
  const loadController = useRef<AbortController | null>(null);
  const setUrlFilter = useCallback((key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, [setSearchParams]);

  const loadData = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const [candRes, caseRes, metricRes] = await Promise.all([
        fetchFollowUpCandidates(kindFilter ? { exception_kind: kindFilter } : {}, controller.signal),
        fetchFollowUpCases({
          ...(kindFilter ? { exception_kind: kindFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(priorityFilter ? { priority: priorityFilter } : {}),
        }, controller.signal),
        fetchFollowUpMetrics(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setCandidates(Array.isArray(candRes) ? candRes : candRes.items);
      setCases(Array.isArray(caseRes) ? caseRes : caseRes.items);
      setMetrics(metricRes);
    } catch (err: unknown) {
      if (!controller.signal.aborted) setError({ message: getFollowUpError(err, 'Gagal memuat data antrean pengecualian.'), source: 'load' });
    } finally {
      if (loadController.current === controller) {
        loadController.current = null;
        setLoading(false);
      }
    }
  }, [kindFilter, statusFilter, priorityFilter]);

  useEffect(() => {
    void loadData();
    return () => {
      const controller = loadController.current;
      loadController.current = null;
      controller?.abort();
    };
  }, [loadData]);

  const handleMaterializeCandidate = useCallback(async (candidate: FollowUpCandidate, trigger: HTMLButtonElement) => {
    caseTrigger.current = trigger;
    setSubmittingKey(candidate.exception_key);
    setError(null);
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
      setError({ message: getFollowUpError(err, 'Gagal membuat kasus follow-up.'), source: 'action' });
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
    candidateColumn.display({
      id: 'actions',
      header: 'Tindakan',
      enableHiding: false,
      cell: ({ row }) => {
        const candidate = row.original;
        return candidate.materialized_case ? (
          <Button size="sm" variant="outline" className="min-h-9" onClick={(event) => {
            caseTrigger.current = event.currentTarget;
            setSelectedCaseId(candidate.materialized_case?.id ?? null);
          }}>
            <Eye className="size-3.5" aria-hidden="true" />
            <span>Lihat Kasus #{candidate.materialized_case.id}</span>
          </Button>
        ) : (
          <Button size="sm" className="min-h-9"
            disabled={submittingKey === candidate.exception_key}
            onClick={(event) => void handleMaterializeCandidate(candidate, event.currentTarget)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Tangani Kasus</span>
          </Button>
        );
      },
    }),
    candidateColumn.accessor('exception_kind', { header: 'Jenis Pengecualian', cell: (info) => info.getValue() }),
    candidateColumn.accessor('student_name', { header: 'Nama Siswa', cell: (info) => info.getValue() || 'N/A' }),
    candidateColumn.accessor('class_name', { header: 'Kelas', cell: (info) => info.getValue() || '-' }),
    candidateColumn.accessor('exception_date', { header: 'Tanggal', cell: (info) => info.getValue() || '-' }),
    candidateColumn.accessor('severity', {
      header: 'Tingkat Severitas',
      cell: (info) => {
        const severity = info.getValue();
        const variant = severity === 'HIGH' ? 'danger' : severity === 'MEDIUM' ? 'warning' : 'secondary';
        return <Badge variant={variant} className="rounded-sm">{severity || 'UNKNOWN'}</Badge>;
      },
    }),
    candidateColumn.accessor('evidence_summary', { header: 'Ringkasan Bukti', cell: (info) => info.getValue() || '-' }),
  ]), [handleMaterializeCandidate, submittingKey]);

  const caseColumns = useMemo(() => caseColumn.columns([
    caseColumn.display({
      id: 'actions',
      header: 'Aksi',
      enableHiding: false,
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="min-h-9" onClick={(event) => {
          caseTrigger.current = event.currentTarget;
          setSelectedCaseId(row.original.id);
        }}>
          <Eye className="size-3.5" aria-hidden="true" />
          <span>Detail</span>
        </Button>
      ),
    }),
    caseColumn.accessor('id', { header: 'ID Kasus', cell: (info) => `#${info.getValue()}` }),
    caseColumn.accessor('exception_kind', { header: 'Jenis', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('student_name', { header: 'Nama Siswa', cell: (info) => info.getValue() || 'N/A' }),
    caseColumn.accessor('class_name', { header: 'Kelas', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('status', {
      header: 'Status',
      cell: (info) => {
        const status = info.getValue() || 'UNKNOWN';
        const variant = status === 'RESOLVED' ? 'success'
          : status === 'OPEN' ? 'warning'
          : status === 'DISMISSED' ? 'secondary'
          : 'information';
        return <Badge variant={variant} className="rounded-sm">{status}</Badge>;
      },
    }),
    caseColumn.accessor('priority', { header: 'Prioritas', cell: (info) => info.getValue() || '-' }),
    caseColumn.accessor('assigned_to_user_id', { header: 'Penanggung Jawab', cell: (info) => info.getValue() ? `User #${info.getValue()}` : 'Belum Ditugaskan' }),
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
    <div className="space-y-4">
      <PageHeader
        title="Antrean Follow-Up Pengecualian Absensi"
        description="Tinjau temuan absensi dan lanjutkan kasus yang sudah dibuka."
        actions={<Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className="size-4" aria-hidden="true" /> Muat Ulang
        </Button>}
      />

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-sm border border-danger/20 bg-danger-surface p-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {error.message}
        </p>
      )}

      <FilterBar className="space-y-3 rounded-sm p-3">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          {/* Tabs */}
          <div className="grid grid-cols-2 rounded-md bg-surface-muted p-1">
            <button
              type="button"
              aria-pressed={activeTab === 'candidates'}
              onClick={() => setUrlFilter('tab', 'candidates')}
              className={`min-h-9 rounded-sm px-2 py-1 text-xs font-semibold ${
                activeTab === 'candidates'
                  ? 'bg-surface text-brand shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Kandidat Temuan ({countsAvailable ? candidates.length : '…'})
            </button>
            <button
              type="button"
              ref={casesTab}
              aria-pressed={activeTab === 'cases'}
              onClick={() => setUrlFilter('tab', 'cases')}
              className={`min-h-9 rounded-sm px-2 py-1 text-xs font-semibold ${
                activeTab === 'cases'
                  ? 'bg-surface text-brand shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Daftar Kasus ({countsAvailable ? cases.length : '…'})
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
        <div className="grid gap-2 sm:grid-cols-3">

          <NativeSelect
            aria-label="Exception type filter"
            value={kindFilter}
            onChange={(e) => setUrlFilter('exception_kind', e.target.value)}
            className="h-10 min-w-0"
          >
            <option value="">Semua Jenis Pengecualian</option>
            <option value="UNEXPLAINED_ABSENCE">Unexplained Absence (Alfa)</option>
            <option value="LATE_ARRIVAL">Late Arrival (Keterlambatan)</option>
            <option value="MISSING_CHECKOUT">Missing Checkout</option>
            <option value="UNEXPLAINED_EARLY_DEPARTURE">Unexplained Early Departure</option>
            <option value="PENDING_CORRECTION">Pending Correction Request</option>
            <option value="UNMATCHED_DEVICE_IDENTITY">Unmatched Device Identity</option>
          </NativeSelect>

          {activeTab === 'cases' && (
            <>
              <NativeSelect
                aria-label="Case status filter"
                value={statusFilter}
                onChange={(e) => setUrlFilter('status', e.target.value)}
                className="h-10 min-w-0"
              >
                <option value="">Semua Status Kasus</option>
                <option value="OPEN">OPEN</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="MONITORING">MONITORING</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="DISMISSED">DISMISSED</option>
                <option value="REOPENED">REOPENED</option>
              </NativeSelect>

              <NativeSelect
                aria-label="Case priority filter"
                value={priorityFilter}
                onChange={(e) => setUrlFilter('priority', e.target.value)}
                className="h-10 min-w-0"
              >
                <option value="">Semua Prioritas</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </NativeSelect>
            </>
          )}
        </div>
      </FilterBar>

      {countsAvailable && metrics.open_cases !== undefined && (
        <dl aria-label="Ringkasan semua kasus" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {[
            ['Kasus aktif', metrics.open_cases],
            ['Belum ditugaskan', metrics.unassigned_cases],
            ['Terlambat', metrics.overdue_cases],
            ['Selesai', metrics.resolved_count],
          ].map(([label, count]) => count === undefined ? null : (
            <div key={label} className="flex gap-1.5">
              <dt>{label}</dt><dd className="font-semibold tabular-nums text-foreground">{count}</dd>
            </div>
          ))}
        </dl>
      )}

      {error?.source !== 'load' && <div className="overflow-hidden rounded-sm border border-border bg-surface">
        {loading ? (
          <LoadingState title="Memuat data antrean" />
        ) : activeTab === 'candidates' ? (
          <VirtualizedDataTable
            caption="Attendance exception candidates"
            rows={candidateTable.getRowModel().rows}
            getRowId={(row) => row.id}
            columnCount={candidateTable.getVisibleLeafColumns().length}
            emptyMessage={searchTerm || kindFilter ? "Tidak ada kandidat yang cocok dengan pencarian atau filter." : "Tidak ada kandidat pengecualian ditemukan."}
            header={(
              <thead className="sticky top-0 z-10 border-b border-border bg-surface-muted text-left font-semibold text-muted-foreground">
                {candidateTable.getHeaderGroups().map((group) => (
                  <tr key={group.id} aria-rowindex={1}>
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" className="px-3 py-2">
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
            emptyMessage={searchTerm || kindFilter || statusFilter || priorityFilter ? "Tidak ada kasus yang cocok dengan pencarian atau filter." : "Tidak ada kasus follow-up ditemukan."}
            header={(
              <thead className="sticky top-0 z-10 border-b border-border bg-surface-muted text-left font-semibold text-muted-foreground">
                {caseTable.getHeaderGroups().map((group) => (
                  <tr key={group.id} aria-rowindex={1}>
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" className="px-3 py-2">
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
      </div>}

      {/* Case Detail Modal */}
      {caseId !== null && (
        <AttendanceFollowUpDetailModal
          key={caseId}
          caseId={caseId}
          onClose={closeCase}
          restoreFocus={() => {
            const trigger = caseTrigger.current;
            (trigger?.isConnected ? trigger : casesTab.current)?.focus();
          }}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}
