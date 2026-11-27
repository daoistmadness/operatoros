import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { FilterBar } from '../../../components/common/filter-bar';
import { PageHeader } from '../../../components/common/page-header';
import { EmptyState, ErrorState, FilteredEmptyState, LoadingState } from '../../../components/common/state-message';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { NativeSelect } from '../../../components/ui/native-select';
import CorrectionSelfConfirmModal from '../../../components/CorrectionSelfConfirmModal';
import { useDeploymentMode } from '../../../context/DeploymentModeContext';
import { getApiErrorMessage } from '../../../lib/api/errors';
import { useUrlSearchParams } from '../../../lib/router/search';
import { cn } from '../../../lib/utils';
import type { OperatorWorkQueueItem } from '../api/operator';
import { useOperatorWorkQueueQuery } from '../queries/useOperatorQueries';

type SelectedCorrection = {
  id: number;
  version: number;
  proposed_status: string;
  explanation: string;
};

const workTypes = {
  STUDENT_VERIFICATION: 'Verifikasi Identitas',
  STUDENT_IDENTITY_CORRECTION: 'Koreksi Dokumen Siswa',
  STUDENT_DAPODIK_CORRECTION: 'Koreksi DAPODIK Siswa',
  STAFF_PTK_REVIEW: 'Aktivitas PTK',
  UPP_REPORT_PENDING: 'Laporan UPP',
  FOLLOWUP_CASE: 'Kasus Follow-Up',
  FOLLOWUP_CANDIDATE: 'Kandidat Pengecualian',
  CORRECTION_REQUEST: 'Koreksi Kehadiran',
  UNMATCHED_DEVICE: 'Perangkat RFID',
} satisfies Record<OperatorWorkQueueItem['item_type'], string>;

const dueStates = {
  OVERDUE: { label: 'Terlambat', variant: 'danger' },
  DUE_TODAY: { label: 'Jatuh Tempo Hari Ini', variant: 'warning' },
  DUE_LATER: { label: 'Mendatang', variant: 'information' },
  NO_DUE_DATE: { label: 'Tanpa Tanggal', variant: 'secondary' },
  COMPLETED: { label: 'Selesai', variant: 'success' },
} as const;

function readFilter(params: URLSearchParams, key: string, options: readonly string[]) {
  const values = params.getAll(key);
  return values.length === 1 && options.includes(values[0]) ? values[0] : 'ALL';
}

export default function OperatorWorkQueue() {
  const { isSingleUserMode } = useDeploymentMode();
  const queue = useOperatorWorkQueueQuery();
  const items = queue.data ?? [];
  const isLoading = queue.isLoading;
  const errorMessage = queue.error
    ? getApiErrorMessage(queue.error, 'Gagal memuat antrean kerja operator. Silakan coba lagi.')
    : null;

  const [params, setParams] = useUrlSearchParams();
  // Free-text search can contain student identifiers and stays off the URL.
  const [searchQuery, setSearchQuery] = useState('');
  const itemTypeFilter = readFilter(params, 'item_type', Object.keys(workTypes));
  const dueStateFilter = readFilter(params, 'due_state', Object.keys(dueStates));

  const updateFilter = (key: 'item_type' | 'due_state', value: string) => {
    setParams((current) => {
      if (value === 'ALL') current.delete(key);
      else current.set(key, value);
      return current;
    });
  };

  // Selected correction for self-confirm modal
  const [selectedCorrection, setSelectedCorrection] = useState<SelectedCorrection | null>(null);

  const loadQueue = () => void queue.refetch();

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (itemTypeFilter !== 'ALL' && item.item_type !== itemTypeFilter) return false;
      if (dueStateFilter !== 'ALL' && item.derived_due_state !== dueStateFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
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
    const status = Object.entries(dueStates).find(([key]) => key === dueState)?.[1] ?? dueStates.NO_DUE_DATE;
    return <Badge variant={status.variant} className="rounded-sm">{status.label}</Badge>;
  };

  const renderItemCard = (item: OperatorWorkQueueItem) => (
    <div
      key={`${item.item_type}:${item.source_id}`}
      className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-3"
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              {workTypes[item.item_type] ?? item.item_type.replaceAll("_", " ")}
            </span>
            <h3 className="break-words font-semibold text-foreground">{item.title}</h3>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">
              {item.student_display_label} {item.class_reference ? `(${item.class_reference})` : ''}
            </p>
          </div>
          {renderDueStateBadge(item.derived_due_state)}
        </div>

        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.evidence_summary}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">
          {item.event_date ? `Tanggal: ${item.event_date}` : 'Aktivitas Terbaru'}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <a href={item.source_route} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-9')}
            aria-label={`Buka ${item.title} · ${item.student_display_label}`}>Buka</a>
          {item.item_type === 'CORRECTION_REQUEST' && isSingleUserMode && item.workflow_status !== 'APPROVED' && (
            <Button
              variant="success"
              size="sm"
              onClick={() =>
                setSelectedCorrection({
                  id: item.metadata.id,
                  version: item.metadata.version,
                  proposed_status: item.title.replace('Koreksi: Status ', ''),
                  explanation: item.evidence_summary,
                })
              }
              className="min-h-9"
            >
              <ShieldCheck className="size-4" aria-hidden="true" /> Konfirmasi Mandiri
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Antrean Kerja Operator"
        description="Buka item untuk melanjutkan pekerjaan pada halaman terkait."
        actions={<Button variant="outline" onClick={loadQueue} disabled={queue.isFetching}>
          <RefreshCw className="size-4" aria-hidden="true" /> Segarkan
        </Button>}
      />
      {isSingleUserMode && <Badge variant="success" className="rounded-sm">Single-Operator Offline</Badge>}

      <FilterBar className="grid min-w-0 gap-3 rounded-sm p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Cari pekerjaan"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Cari berdasarkan nama siswa/staf, judul, atau ringkasan..."
            className="h-10 pl-9"
          />
        </div>
        <NativeSelect aria-label="Tipe pekerjaan" className="h-10 min-w-0" value={itemTypeFilter} onChange={(event) => updateFilter('item_type', event.target.value)}>
          <option value="ALL">Semua Tipe Pekerjaan</option>
          {Object.entries(workTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Status tenggat" className="h-10 min-w-0" value={dueStateFilter} onChange={(event) => updateFilter('due_state', event.target.value)}>
          <option value="ALL">Semua Status Tenggat</option>
          {Object.entries(dueStates).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
      </FilterBar>

      {isLoading ? (
        <LoadingState title="Memuat antrean kerja" />
      ) : errorMessage ? (
        <ErrorState title="Antrean kerja tidak dapat dimuat" description={errorMessage} />
      ) : items.length === 0 ? (
        <EmptyState title="Belum ada pekerjaan dalam antrean" />
      ) : filteredItems.length === 0 ? (
        <FilteredEmptyState title="Tidak ada pekerjaan yang cocok" description="Ubah pencarian atau filter untuk melihat hasil lain." />
      ) : (
        <div className="space-y-5">
          {/* Overdue Section */}
          {sections.overdue.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <h2 className="font-bold text-rose-900 dark:text-rose-400">
                  Memerlukan Perhatian Segera (Terlambat - {sections.overdue.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.overdue.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Due Today Section */}
          {sections.dueToday.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <h2 className="font-bold text-amber-900 dark:text-amber-400">
                  Jatuh Tempo Hari Ini ({sections.dueToday.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.dueToday.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Due Later & No Due Date */}
          {(sections.dueLater.length > 0 || sections.noDueDate.length > 0) && (
            <div>
              <h2 className="mb-3 font-bold text-slate-900 dark:text-white">
                Antrean Pekerjaan Aktif ({sections.dueLater.length + sections.noDueDate.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.dueLater.map(renderItemCard)}
                {sections.noDueDate.map(renderItemCard)}
              </div>
            </div>
          )}

          {/* Completed Section */}
          {sections.completed.length > 0 && (
            <div>
              <h2 className="mb-3 font-bold text-slate-500">Baru Saja Selesai ({sections.completed.length})</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
