import { useEffect, useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { AlertTriangle, ArrowLeft, CheckCircle2, DatabaseBackup, HardDrive, Loader2, RefreshCw, RotateCcw, ShieldAlert, Trash2, Download } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { BackupEntry, BackupStatus, RestoreResult, type BackupExecutionHistory, type BackupSchedulerConfig, downloadBackupUrl } from "../api/backups";
import { AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { useBackupHistory, useBackupList, useBackupScheduler, useBackupStatus, useCreateBackupMutation, useRestoreBackupMutation, useUpdateBackupSchedulerMutation, useDeleteBackupMutation } from "../hooks/useBackupQueries";
import { Alert } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { FieldLabel, FormField } from "../components/ui/field";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { PageHeader } from "../components/common/page-header";

const card = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";
export const canRestore = (filename: string, confirmation: string, destructiveEnabled: boolean, busy: boolean) => destructiveEnabled && confirmation === filename && !busy;
export const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const handleRestoreReauthentication = (result: RestoreResult, navigate: (path: string, options: { replace: boolean; state: { message: string } }) => void) => {
  if (!result.reauthentication_required) return false;
  window.sessionStorage.setItem("astryx:login-notice", result.message);
  navigate("/login", { replace: true, state: { message: result.message } });
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  return true;
};

export function BackupStatusPanel({ status }: { status: BackupStatus }) {
  const rows = [
    ["Database", status.database_basename], ["Journal Mode", status.sqlite_journal_mode.toUpperCase()],
    ["Last Backup", status.latest_backup_timestamp || "Not Available"],
    ["Retention", `${status.backup_count} of ${status.retention_limit}`],
    ["Free Space", formatBytes(status.free_disk_space_bytes)],
    ["Restore", status.destructive_operations_enabled ? "Enabled" : "Disabled"],
  ];
  return <section className={card} aria-labelledby="backup-status-title"><h2 id="backup-status-title" className="flex items-center gap-2 text-lg font-black text-slate-800"><HardDrive className="h-5 w-5 text-brand" />Backup Status</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map(([label,value])=><div key={label} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">{label}</p><p className="mt-1 break-all font-black text-slate-800">{value}</p></div>)}</div><p className="mt-4 text-xs font-semibold text-slate-500">Restore support: single-process local deployment only.</p></section>;
}

export function BackupList({ backups, onRestore, onDelete }: { backups: BackupEntry[]; onRestore: (backup: BackupEntry) => void; onDelete: (backup: BackupEntry) => void; }) {
  const [filter, setFilter] = useState("");
  const helper = createColumnHelper<BackupEntry>();
  const columns = useMemo(() => [
    helper.accessor("filename", { header: "Filename", cell: info => <span className="font-bold text-slate-700">{info.getValue()}</span> }),
    helper.accessor("created_at", { header: "Created" }), helper.accessor("trigger", { header: "Trigger" }),
    helper.accessor("size", { header: "Size", cell: info => formatBytes(info.getValue()) }),
    helper.accessor("schema_version", { header: "Schema" }),
    helper.accessor("checksum", { header: "Checksum", cell: info => <span className="font-mono text-xs">{info.getValue().slice(0,12)}…</span> }),
    helper.display({ id: "action", header: "Action", enableSorting: false, cell: info => (
      <div className="flex gap-2">
        <a href={downloadBackupUrl(info.row.original.filename)} download className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" /> Download</a>
        <Button variant="outline" size="sm" onClick={()=>onRestore(info.row.original)} className="border-rose-200 text-rose-700"><RotateCcw className="h-4 w-4" /> Restore</Button>
        <Button variant="outline" size="sm" onClick={()=>onDelete(info.row.original)} className="border-rose-200 text-rose-700"><Trash2 className="h-4 w-4" /> Delete</Button>
      </div>
    )}),
  ], [onRestore, onDelete]);
  const table = useReactTable({ data: backups, columns, state: { globalFilter: filter }, onGlobalFilterChange: setFilter, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel() });
  return <section className={card} aria-labelledby="backup-list-title"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 id="backup-list-title" className="text-lg font-black text-slate-800">Available Backups</h2>{backups.length>0&&<Input aria-label="Filter backups" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Filter backups" className="sm:max-w-xs"/>}</div>{!backups.length?<EmptyState className="mt-5" title="No backups have been created yet."/>:<DataTableContainer className="mt-5"><DataTable><DataTableHeader>{table.getHeaderGroups().map(group=><DataTableRow key={group.id}>{group.headers.map(header=><DataTableHead key={header.id}><Button variant="ghost" size="sm" type="button" disabled={!header.column.getCanSort()} onClick={header.column.getToggleSortingHandler()} className="h-auto px-0 font-bold uppercase">{flexRender(header.column.columnDef.header,header.getContext())}{header.column.getIsSorted()==="asc"?" ↑":header.column.getIsSorted()==="desc"?" ↓":""}</Button></DataTableHead>)}</DataTableRow>)}</DataTableHeader><DataTableBody>{table.getRowModel().rows.map(row=><DataTableRow key={row.id}>{row.getVisibleCells().map(cell=><DataTableCell key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</DataTableCell>)}</DataTableRow>)}</DataTableBody></DataTable>{table.getRowModel().rows.length===0&&<EmptyState className="m-4" title="No backups match the filter."/>}</DataTableContainer>}</section>;
}

export function RestoreDialog({ backup, confirmation, setConfirmation, destructiveEnabled, busy, onCancel, onRestore }: { backup: BackupEntry; confirmation: string; setConfirmation:(value:string)=>void; destructiveEnabled:boolean; busy:boolean; onCancel:()=>void; onRestore:()=>void }) {
  return <Dialog open onOpenChange={(open)=>!open&&!busy&&onCancel()}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-rose-800"><ShieldAlert className="h-6 w-6"/>Restore Database</DialogTitle><DialogDescription>{RESTORE_WARNING}</DialogDescription></DialogHeader><RestoreDialogBody backup={backup} confirmation={confirmation} setConfirmation={setConfirmation} destructiveEnabled={destructiveEnabled} busy={busy} onCancel={onCancel} onRestore={onRestore}/></DialogContent></Dialog>;
}

export const RESTORE_WARNING = "Restoring replaces the current SQLite database. A pre-restore safety snapshot will be created automatically.";
export function RestoreDialogBody({ backup, confirmation, setConfirmation, destructiveEnabled, busy, onCancel, onRestore }: { backup: BackupEntry; confirmation: string; setConfirmation:(value:string)=>void; destructiveEnabled:boolean; busy:boolean; onCancel:()=>void; onRestore:()=>void }) {
  const enabled=canRestore(backup.filename,confirmation,destructiveEnabled,busy);
  return <>{!destructiveEnabled&&<Alert className="mt-5">Restore is disabled by local system settings.</Alert>}<div className="mt-6 space-y-2"><Label htmlFor="restore-confirmation" className="uppercase tracking-wide">Type the exact filename</Label><Input id="restore-confirmation" aria-label="Restore confirmation filename" value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="font-mono" placeholder={backup.filename}/><p className="break-all text-xs font-bold text-rose-700">{backup.filename}</p></div><DialogFooter><Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="danger" onClick={onRestore} disabled={!enabled}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<RotateCcw className="h-4 w-4"/>}Restore Database</Button></DialogFooter></>;
}

export function SchedulerPanel({ config, saving, onSave }: { config: BackupSchedulerConfig; saving: boolean; onSave: (value: Omit<BackupSchedulerConfig,"next_run_at"|"updated_at">)=>void }) {
  const [draft,setDraft]=useState(config);
  useEffect(()=>setDraft(config),[config]);
  const number=(key:keyof BackupSchedulerConfig,value:string)=>setDraft(current=>({...current,[key]:Number(value)}));
  return <section className={card} aria-labelledby="scheduler-title"><h2 id="scheduler-title" className="text-lg font-black text-slate-800">Scheduled Backups</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><FormField id="scheduler-enabled"><FieldLabel>Scheduler</FieldLabel><NativeSelect value={draft.enabled?"enabled":"disabled"} onChange={event=>setDraft(current=>({...current,enabled:event.target.value==="enabled"}))}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></NativeSelect></FormField><FormField id="backup-schedule"><FieldLabel>Schedule</FieldLabel><NativeSelect value={draft.schedule_type} onChange={event=>setDraft(current=>({...current,schedule_type:event.target.value as BackupSchedulerConfig["schedule_type"]}))}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="interval">Custom interval</option></NativeSelect></FormField>{draft.schedule_type==="interval"?<FormField id="interval-minutes"><FieldLabel>Interval minutes</FieldLabel><Input type="number" min="1" value={draft.interval_minutes} onChange={event=>number("interval_minutes",event.target.value)}/></FormField>:<><FormField id="schedule-hour"><FieldLabel>Hour (UTC)</FieldLabel><Input type="number" min="0" max="23" value={draft.hour_utc} onChange={event=>number("hour_utc",event.target.value)}/></FormField><FormField id="schedule-minute"><FieldLabel>Minute (UTC)</FieldLabel><Input type="number" min="0" max="59" value={draft.minute_utc} onChange={event=>number("minute_utc",event.target.value)}/></FormField></>}<FormField id="keep-daily"><FieldLabel>Keep daily</FieldLabel><Input type="number" min="0" value={draft.keep_daily} onChange={event=>number("keep_daily",event.target.value)}/></FormField><FormField id="keep-weekly"><FieldLabel>Keep weekly</FieldLabel><Input type="number" min="0" value={draft.keep_weekly} onChange={event=>number("keep_weekly",event.target.value)}/></FormField><FormField id="keep-monthly"><FieldLabel>Keep monthly</FieldLabel><Input type="number" min="0" value={draft.keep_monthly} onChange={event=>number("keep_monthly",event.target.value)}/></FormField></div><div className="mt-5 flex items-center justify-between gap-4"><p className="text-xs font-semibold text-slate-500">Next run: {config.next_run_at||"Not scheduled"}</p><Button disabled={saving} onClick={()=>onSave({enabled:draft.enabled,schedule_type:draft.schedule_type,interval_minutes:draft.interval_minutes,hour_utc:draft.hour_utc,minute_utc:draft.minute_utc,weekday_utc:draft.weekday_utc,keep_daily:draft.keep_daily,keep_weekly:draft.keep_weekly,keep_monthly:draft.keep_monthly})}>{saving?"Saving...":"Save Schedule"}</Button></div></section>;
}

export function DeleteDialog({ backup, busy, onCancel, onDelete }: { backup: BackupEntry; busy: boolean; onCancel: () => void; onDelete: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-800">
            <Trash2 className="h-6 w-6" /> Delete Backup
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this backup? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6 space-y-2">
          <p className="break-all text-sm font-bold text-slate-700">{backup.filename}</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete Backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BackupHistoryPanel({ rows }: { rows: BackupExecutionHistory[] }) {
  return <section className={card} aria-labelledby="history-title"><h2 id="history-title" className="text-lg font-black text-slate-800">Execution History</h2>{rows.length===0?<EmptyState className="mt-5" title="No backup executions recorded."/>:<DataTableContainer className="mt-5"><DataTable><DataTableHeader><DataTableRow><DataTableHead>Started</DataTableHead><DataTableHead>Trigger</DataTableHead><DataTableHead>Status</DataTableHead><DataTableHead>Duration</DataTableHead><DataTableHead>Backup</DataTableHead><DataTableHead>Details</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{rows.map(row=><DataTableRow key={row.id}><DataTableCell>{row.started_at}</DataTableCell><DataTableCell className="font-bold">{row.trigger_type}</DataTableCell><DataTableCell className={`font-black ${row.status==="SUCCESS"?"text-emerald-600":row.status==="FAILED"?"text-rose-600":"text-amber-600"}`}>{row.status}</DataTableCell><DataTableCell>{row.duration_seconds===null?"—":`${row.duration_seconds.toFixed(2)}s`}</DataTableCell><DataTableCell className="font-mono text-xs">{row.backup_filename||"—"}</DataTableCell><DataTableCell className="max-w-xs text-xs text-slate-500">{row.error_message||`${row.integrity_verified?"Verified":"Not verified"}${row.removed_backups.length?`; removed ${row.removed_backups.length}`:""}`}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>}</section>;
}

export default function BackupManagement() {
  const navigate=useNavigate();
  const statusQuery=useBackupStatus(); const backupsQuery=useBackupList(); const createMutation=useCreateBackupMutation(); const restoreMutation=useRestoreBackupMutation();
  const schedulerQuery=useBackupScheduler(); const historyQuery=useBackupHistory(); const schedulerMutation=useUpdateBackupSchedulerMutation(); const deleteMutation=useDeleteBackupMutation();
  const status=statusQuery.data??null; const backups=backupsQuery.data??[]; const loading=statusQuery.isLoading||backupsQuery.isLoading; const busy=createMutation.isPending||restoreMutation.isPending||deleteMutation.isPending;
  const queryError=statusQuery.error||backupsQuery.error||schedulerQuery.error||historyQuery.error; const mutationError=createMutation.error||restoreMutation.error||schedulerMutation.error||deleteMutation.error; const error=queryError||mutationError;
  const [selected,setSelected]=useState<BackupEntry|null>(null); const [deleteSelected,setDeleteSelected]=useState<BackupEntry|null>(null); const [confirmation,setConfirmation]=useState(""); const [result,setResult]=useState<RestoreResult|null>(null);
  const handleCreate=async()=>{if(busy)return;setResult(null);await createMutation.mutateAsync();};
  const handleRestore=async()=>{if(!selected||!status||!canRestore(selected.filename,confirmation,status.destructive_operations_enabled,busy))return;const next=await restoreMutation.mutateAsync({filename:selected.filename,confirmation});setResult(next);setSelected(null);setConfirmation("");handleRestoreReauthentication(next,navigate);};
  const handleDelete=async()=>{if(!deleteSelected)return;await deleteMutation.mutateAsync(deleteSelected.filename);setDeleteSelected(null);};
  const retry=()=>{void Promise.all([statusQuery.refetch(),backupsQuery.refetch(),schedulerQuery.refetch(),historyQuery.refetch()]);};
  return <div className="space-y-7 pb-12"><PageHeader title="Backup Management" description="Local SQLite snapshots and guarded recovery." actions={<><Link aria-label="Back to Settings" to="/settings" className={buttonVariants({variant:"outline"})}><ArrowLeft/>Settings</Link><Button size="lg" onClick={()=>void handleCreate()} disabled={busy||loading}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<DatabaseBackup className="h-4 w-4"/>}Create Backup</Button></>}/><Alert variant="warning" className="font-semibold"><AlertTriangle className="mr-2 inline h-5 w-5"/>Backup management is restricted to authenticated administrators. Restore also requires destructive operations to be enabled locally.</Alert>{error&&<ErrorState title="Backup management could not be loaded" description={error instanceof Error?error.message:"Please retry the request."}><Button variant="outline" size="sm" onClick={retry} className="mt-4"><RefreshCw className="size-4"/>Retry</Button></ErrorState>}{result&&<Alert variant="success"><CheckCircle2 className="mr-2 inline h-5 w-5"/><strong>Restore verified.</strong> Restored {result.restored_filename}; safety snapshot {result.pre_restore_snapshot_filename}.</Alert>}{loading?<LoadingState title="Loading backup management"/>:status?<><BackupStatusPanel status={status}/>{schedulerQuery.data&&<SchedulerPanel config={schedulerQuery.data} saving={schedulerMutation.isPending} onSave={value=>void schedulerMutation.mutateAsync(value)}/>}<BackupList backups={backups} onRestore={item=>{setSelected(item);setConfirmation("");setResult(null);}} onDelete={item=>{setDeleteSelected(item);setResult(null);}}/><BackupHistoryPanel rows={historyQuery.data??[]}/></>:!error&&<EmptyState title="Backup status is unavailable."/>}{selected&&status&&<RestoreDialog backup={selected} confirmation={confirmation} setConfirmation={setConfirmation} destructiveEnabled={status.destructive_operations_enabled} busy={busy} onCancel={()=>{setSelected(null);setConfirmation("");}} onRestore={()=>void handleRestore()}/>}{deleteSelected&&<DeleteDialog backup={deleteSelected} busy={busy} onCancel={()=>setDeleteSelected(null)} onDelete={()=>void handleDelete()}/>}</div>;
}
