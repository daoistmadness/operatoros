import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  DatabaseBackup,
  Download,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  type BackupEntry,
  type BackupExecutionHistory,
  type BackupSchedulerConfig,
  type BackupStatus,
  type RecoveryHistoryEntry,
  type RestorePreflight,
  type RestoreRequest,
  type RestoreResult,
  downloadBackupUrl,
} from "../api/backups";
import {
  useBackupHistory,
  useBackupList,
  useBackupScheduler,
  useBackupStatus,
  useCreateBackupMutation,
  useDeleteBackupMutation,
  useRecoveryHistory,
  useRestoreBackupMutation,
  useRestorePreflightMutation,
  useUpdateBackupSchedulerMutation,
} from "../hooks/useBackupQueries";
import { Alert } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { NativeSelect } from "../components/ui/native-select";
import { FieldLabel, FormField } from "../components/ui/field";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableContainer,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "../components/common/data-table";
import { EmptyState, ErrorState, LoadingState } from "../components/common/state-message";
import { PageHeader } from "../components/common/page-header";

const card = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";
const RESTORE_PHRASE = "RESTORE_DATABASE";
export const RESTORE_WARNING =
  "Restoring replaces the complete OperatorOS database. CSV exports are data exchange files and cannot restore the complete system.";
export const RESTORE_STEPS = [
  "Select Backup",
  "Verify Backup",
  "Compare Impact",
  "Safety Acknowledgements",
  "Re-authenticate & Confirm",
  "Execute",
  "Result",
] as const;
export const EXECUTION_STAGES = [
  "AUTHORIZING",
  "REVALIDATING_SOURCE",
  "CREATING_SAFETY_BACKUP",
  "PREPARING_CANDIDATE",
  "VALIDATING_CANDIDATE",
  "LOCKING_APPLICATION",
  "PUBLISHING_DATABASE",
  "VERIFYING_RESTORE",
  "REVOKING_SESSIONS",
  "COMPLETED",
] as const;

const HEALTH_LABELS: Record<BackupStatus["health_state"], string> = {
  HEALTHY: "Healthy",
  AGING: "Backup aging",
  STALE: "Backup overdue",
  NO_BACKUP: "No verified backup",
  LAST_BACKUP_FAILED: "Last backup failed",
  DESTINATION_UNAVAILABLE: "Backup destination unavailable",
  LOW_DISK_SPACE: "Low disk space",
  BACKUP_IN_PROGRESS: "Backup in progress",
  RESTORE_IN_PROGRESS: "Restore in progress",
  UNKNOWN: "Status unavailable",
};

export const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return "Not available";
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatAge = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return "Not available";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
};

export const allAcknowledged = (value: Acknowledgements) =>
  Object.values(value).every(Boolean);

export const canExecuteRestore = ({
  filename,
  confirmationFilename,
  confirmationPhrase,
  password,
  acknowledgements,
  eligible,
  busy,
}: {
  filename: string;
  confirmationFilename: string;
  confirmationPhrase: string;
  password: string;
  acknowledgements: Acknowledgements;
  eligible: boolean;
  busy: boolean;
}) =>
  eligible &&
  !busy &&
  password.length > 0 &&
  confirmationFilename === filename &&
  confirmationPhrase === RESTORE_PHRASE &&
  allAcknowledged(acknowledgements);

type Acknowledgements = {
  replace: boolean;
  sessions: boolean;
  restart: boolean;
  safety: boolean;
};

const EMPTY_ACKNOWLEDGEMENTS: Acknowledgements = {
  replace: false,
  sessions: false,
  restart: false,
  safety: false,
};

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "The operation could not be completed.";
  const data = (error as Error & { data?: { detail?: unknown } }).data;
  const detail = data?.detail;
  if (detail && typeof detail === "object") {
    const payload = detail as { message?: string; safe_message?: string };
    return payload.safe_message || payload.message || "The operation could not be completed.";
  }
  return error.message || "The operation could not be completed.";
}

export function BackupStatusPanel({ status }: { status: BackupStatus }) {
  const rows = [
    ["Health", HEALTH_LABELS[status.health_state]],
    ["Last successful", status.last_successful_backup_at || "Not available"],
    ["Backup age", formatAge(status.backup_age_seconds)],
    ["Last failed", status.last_failed_backup_at || "None recorded"],
    ["Failure", status.last_failure_code || status.last_failure_message || "None"],
    ["Backups retained", `${status.backup_count} of ${status.retention_limit}`],
    ["Destination", status.backup_directory_display],
    ["Destination available", status.backup_directory_available ? "Yes" : "No"],
    ["Free space", formatBytes(status.free_space_bytes)],
    ["Required space", formatBytes(status.minimum_required_space_bytes)],
    ["Checksum", status.latest_backup_checksum_status || "Not available"],
    ["Integrity", status.latest_backup_integrity_status || "Not available"],
    ["Schema", status.latest_backup_schema_version || "Not available"],
    ["Backup running", status.backup_in_progress ? "Yes" : "No"],
    ["Restore running", status.restore_in_progress ? "Yes" : "No"],
    ["Next scheduled", status.next_scheduled_backup_at || "Not scheduled"],
  ];
  return (
    <section className={card} aria-labelledby="backup-status-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="backup-status-title" className="flex items-center gap-2 text-lg font-black text-slate-800">
          <HardDrive className="h-5 w-5 text-brand" /> Backup Health
        </h2>
        <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-black text-slate-800">
          {HEALTH_LABELS[status.health_state]}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 break-all font-black text-slate-800">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BackupList({
  backups,
  onRestore,
  onDelete,
}: {
  backups: BackupEntry[];
  onRestore: (backup: BackupEntry) => void;
  onDelete: (backup: BackupEntry) => void;
}) {
  return (
    <section className={card} aria-labelledby="backup-list-title">
      <h2 id="backup-list-title" className="text-lg font-black text-slate-800">Backup Repository</h2>
      <p className="mt-1 text-sm text-slate-600">Only verified repository entries can enter the restore wizard.</p>
      {!backups.length ? (
        <EmptyState className="mt-5" title="No backups have been created yet." />
      ) : (
        <DataTableContainer className="mt-5">
          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Backup</DataTableHead>
                <DataTableHead>Type</DataTableHead>
                <DataTableHead>Created</DataTableHead>
                <DataTableHead>Age</DataTableHead>
                <DataTableHead>Size</DataTableHead>
                <DataTableHead>Schema</DataTableHead>
                <DataTableHead>Verification</DataTableHead>
                <DataTableHead>Actions</DataTableHead>
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {backups.map((backup) => (
                <DataTableRow key={backup.filename}>
                  <DataTableCell>
                    <p className="max-w-xs break-all font-mono text-xs font-bold">{backup.filename}</p>
                    {backup.trigger === "pre_restore_auto" && <p className="mt-1 text-xs font-bold text-blue-700">Automatic safety backup</p>}
                  </DataTableCell>
                  <DataTableCell>{backup.trigger}</DataTableCell>
                  <DataTableCell>{backup.created_at}</DataTableCell>
                  <DataTableCell>{formatAge(backup.age_seconds)}</DataTableCell>
                  <DataTableCell>{formatBytes(backup.size)}</DataTableCell>
                  <DataTableCell>{backup.schema_version}</DataTableCell>
                  <DataTableCell>
                    <p className="font-mono text-xs">{backup.checksum.slice(0, 12)}…</p>
                    <p className="text-xs text-slate-500">
                      Checksum {backup.checksum_status || "preflight required"} · Integrity {backup.integrity_status || "preflight required"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {backup.verification_state || "Not verified"} · {backup.restore_eligible === false ? "Restore blocked" : "Restore eligible after preflight"}
                    </p>
                    {backup.incompatibility_reasons?.length ? <p className="text-xs font-bold text-rose-700">{backup.incompatibility_reasons.join(", ")}</p> : null}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap gap-2">
                      <a href={downloadBackupUrl(backup.filename)} download className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <Download className="h-4 w-4" /> Download
                      </a>
                      <Button variant="danger" size="sm" onClick={() => onRestore(backup)} disabled={backup.restore_eligible === false}>
                        <RotateCcw className="h-4 w-4" /> Guided Restore
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => onDelete(backup)}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </DataTableContainer>
      )}
    </section>
  );
}

function Comparison({ preflight }: { preflight: RestorePreflight }) {
  const rows = [
    ["Checksum", preflight.active.active_sha256.slice(0, 12), preflight.source.sha256.slice(0, 12), "—"],
    ["Schema", preflight.active.active_schema_version, preflight.source.schema_version, "—"],
    ["Students", preflight.active.active_students, preflight.active.source_students, preflight.active.student_delta],
    ["Attendance", preflight.active.active_attendance, preflight.active.source_attendance, preflight.active.attendance_delta],
    ["Enrollments", preflight.active.active_enrollments, preflight.active.source_enrollments, preflight.active.enrollment_delta],
  ];
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 rounded-xl bg-slate-100 p-3 text-xs font-bold uppercase text-slate-600">
        <span>Measure</span><span>Current</span><span>Selected backup</span><span>Delta</span>
      </div>
      {rows.map(([label, active, source, delta]) => (
        <div key={String(label)} className="grid grid-cols-4 gap-2 border-b border-slate-200 p-3 text-sm">
          <strong>{label}</strong><span className="break-all">{active ?? "—"}</span><span className="break-all">{source ?? "—"}</span><span>{delta}</span>
        </div>
      ))}
      <Alert variant={preflight.active.possible_data_loss ? "danger" : "information"} className="mt-5">
        <strong>{preflight.impact_classification}</strong>
        <p className="mt-1">Source age: {formatAge(preflight.source.age_seconds)}. Possible data loss: {preflight.active.possible_data_loss ? "Yes" : "No"}.</p>
      </Alert>
    </div>
  );
}

function Acknowledgement({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="leading-relaxed">{children}</Label>
    </div>
  );
}

export function RestoreWizard({
  backup,
  destructiveEnabled,
  onClose,
  onCompleted,
}: {
  backup: BackupEntry;
  destructiveEnabled: boolean;
  onClose: () => void;
  onCompleted: (result: RestoreResult) => void;
}) {
  const preflightMutation = useRestorePreflightMutation();
  const restoreMutation = useRestoreBackupMutation();
  const [step, setStep] = useState(1);
  const [preflight, setPreflight] = useState<RestorePreflight | null>(null);
  const [acknowledgements, setAcknowledgements] = useState(EMPTY_ACKNOWLEDGEMENTS);
  const [password, setPassword] = useState("");
  const [confirmationFilename, setConfirmationFilename] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = restoreMutation.isPending;
  const eligible = Boolean(preflight?.source.restore_eligible && destructiveEnabled);
  const executeEnabled = canExecuteRestore({
    filename: backup.filename,
    confirmationFilename,
    confirmationPhrase,
    password,
    acknowledgements,
    eligible,
    busy,
  });

  const verify = async () => {
    setError(null);
    try {
      const next = await preflightMutation.mutateAsync(backup.filename);
      setPreflight(next);
    } catch (reason) {
      setError(safeError(reason));
    }
  };

  const execute = async () => {
    if (!preflight || !executeEnabled) return;
    setStep(6);
    setError(null);
    const body: RestoreRequest = {
      current_password: password,
      confirmation_filename: confirmationFilename,
      confirmation_phrase: confirmationPhrase,
      acknowledge_complete_replacement: acknowledgements.replace,
      acknowledge_session_revocation: acknowledgements.sessions,
      acknowledge_restart_required: acknowledgements.restart,
      acknowledge_safety_backup: acknowledgements.safety,
      expected_source_sha256: preflight.source.sha256,
      expected_active_sha256: preflight.active.active_sha256,
    };
    try {
      const next = await restoreMutation.mutateAsync({ filename: backup.filename, body });
      setResult(next);
      onCompleted(next);
      setStep(7);
    } catch (reason) {
      const data = (reason as Error & { data?: { detail?: RestoreResult } }).data?.detail;
      if (data?.status) {
        setResult(data);
        onCompleted(data);
        setStep(7);
      } else {
        setError(safeError(reason));
        setStep(5);
      }
    } finally {
      body.current_password = "";
      setPassword("");
    }
  };

  const setAck = (key: keyof Acknowledgements, value: boolean) =>
    setAcknowledgements((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showClose={!busy}
        className="max-w-4xl"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-800">
            <ShieldAlert className="h-6 w-6" /> Guided Database Restore
          </DialogTitle>
          <DialogDescription>{RESTORE_WARNING}</DialogDescription>
        </DialogHeader>
        <ol aria-label="Restore steps" className="mt-5 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {RESTORE_STEPS.map((label, index) => (
            <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={`rounded-lg border p-2 text-xs font-bold ${step === index + 1 ? "border-rose-500 bg-rose-50 text-rose-900" : "border-slate-200 text-slate-500"}`}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>
        {error && <Alert variant="danger" className="mt-5">{error}</Alert>}

        <div className="mt-6 min-h-72">
          {step === 1 && (
            <div>
              <h3 className="text-lg font-black">Selected repository backup</h3>
              <p className="mt-4 break-all rounded-xl bg-slate-100 p-4 font-mono text-sm">{backup.filename}</p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div><dt className="text-xs font-bold uppercase text-slate-500">Type</dt><dd>{backup.trigger}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Created</dt><dd>{backup.created_at}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Size</dt><dd>{formatBytes(backup.size)}</dd></div>
              </dl>
            </div>
          )}
          {step === 2 && (
            <div>
              <h3 className="text-lg font-black">Verify the selected backup</h3>
              {!preflight && <Button className="mt-5" onClick={() => void verify()} disabled={preflightMutation.isPending}>{preflightMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Run read-only preflight</Button>}
              {preflight && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Checksum", preflight.source.checksum_matches_manifest ? "Verified" : "Failed"],
                    ["Integrity", preflight.source.integrity_check],
                    ["Quick check", preflight.source.quick_check],
                    ["Foreign keys", preflight.source.foreign_key_violation_count === 0 ? "Valid" : `${preflight.source.foreign_key_violation_count} violations`],
                    ["Schema", preflight.source.schema_version || "Unknown"],
                    ["Identity", preflight.source.identity_compatible ? "Compatible" : "Incompatible"],
                    ["Eligibility", preflight.source.restore_eligible ? "Eligible" : "Blocked"],
                    ["Impact", preflight.impact_classification],
                  ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="font-black">{value}</p></div>)}
                  {(preflight.source.blocking_reasons.length > 0 || preflight.source.warning_reasons.length > 0) && <Alert variant="warning" className="sm:col-span-2 lg:col-span-4">Blocking reasons: {preflight.source.blocking_reasons.join(", ") || "none"}. Warnings: {preflight.source.warning_reasons.join(", ") || "none"}.</Alert>}
                </div>
              )}
            </div>
          )}
          {step === 3 && preflight && <Comparison preflight={preflight} />}
          {step === 4 && (
            <div className="space-y-3">
              <Acknowledgement id="ack-replace" checked={acknowledgements.replace} onChange={(value) => setAck("replace", value)}>I understand that the current application database will be replaced.</Acknowledgement>
              <Acknowledgement id="ack-sessions" checked={acknowledgements.sessions} onChange={(value) => setAck("sessions", value)}>I understand that all active sessions will be revoked.</Acknowledgement>
              <Acknowledgement id="ack-restart" checked={acknowledgements.restart} onChange={(value) => setAck("restart", value)}>I understand that OperatorOS must be restarted after restoration.</Acknowledgement>
              <Acknowledgement id="ack-safety" checked={acknowledgements.safety} onChange={(value) => setAck("safety", value)}>I understand that an automatic pre-restore safety backup will be created.</Acknowledgement>
            </div>
          )}
          {step === 5 && (
            <div className="space-y-5">
              <FormField id="restore-password">
                <FieldLabel>Current password</FieldLabel>
                <Input id="restore-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </FormField>
              <FormField id="restore-filename">
                <FieldLabel>Exact backup filename</FieldLabel>
                <Input id="restore-filename" className="font-mono" autoComplete="off" value={confirmationFilename} onChange={(event) => setConfirmationFilename(event.target.value)} placeholder={backup.filename} />
              </FormField>
              <FormField id="restore-phrase">
                <FieldLabel>Type {RESTORE_PHRASE}</FieldLabel>
                <Input id="restore-phrase" className="font-mono" autoComplete="off" value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} />
              </FormField>
            </div>
          )}
          {step === 6 && (
            <div role="status" aria-live="assertive">
              <div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-rose-700" /><h3 className="text-lg font-black">Protected restore in progress</h3></div>
              <p className="mt-3 text-slate-700">OperatorOS is performing a protected restore. This window will update when the operation finishes.</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {EXECUTION_STAGES.map((stage) => <div key={stage} className="rounded-lg border border-slate-200 p-2 font-mono text-xs text-slate-600">{stage}</div>)}
              </div>
            </div>
          )}
          {step === 7 && result && (
            <div role="status" aria-live="polite">
              <Alert variant={result.status === "COMPLETED" ? "success" : result.status === "ROLLED_BACK" ? "warning" : "danger"}>
                <strong>{result.status}</strong><p className="mt-1">{result.safe_message}</p>
              </Alert>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div><dt className="text-xs font-bold uppercase text-slate-500">Operation</dt><dd className="font-mono">{result.operation_id}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Safety backup</dt><dd className="break-all">{result.safety_backup_filename || "Not available"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Integrity</dt><dd>{result.post_restore_integrity || "Not confirmed"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Sessions revoked</dt><dd>{result.sessions_revoked ? "Yes" : "Not confirmed"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Rollback</dt><dd>{result.rollback_attempted ? result.rollback_succeeded ? "Succeeded and verified" : "Not confirmed" : "Not required"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Restart</dt><dd>{result.restart_required ? "Required" : "Not required"}</dd></div>
              </dl>
              {result.status === "FAILED" && <Alert variant="danger" className="mt-5"><strong>Active data safety is not confirmed.</strong><p>{result.safe_next_action}</p><p className="mt-2 font-mono">Support reference: {result.support_reference}</p></Alert>}
              {result.restart_required && <Alert variant="information" className="mt-5">Close and reopen OperatorOS, then sign in again. Browser refresh is not a backend restart.</Alert>}
            </div>
          )}
        </div>
        <DialogFooter>
          {step < 6 && <Button variant="secondary" onClick={onClose}>Cancel</Button>}
          {step > 1 && step < 6 && <Button variant="outline" onClick={() => setStep((value) => value - 1)}>Back</Button>}
          {step === 1 && <Button onClick={() => setStep(2)}>Continue</Button>}
          {step === 2 && preflight && <Button onClick={() => setStep(3)} disabled={!preflight.source.restore_eligible}>Compare impact</Button>}
          {step === 3 && <Button onClick={() => setStep(4)}>Review acknowledgements</Button>}
          {step === 4 && <Button onClick={() => setStep(5)} disabled={!allAcknowledged(acknowledgements)}>Continue to confirmation</Button>}
          {step === 5 && <Button variant="danger" onClick={() => void execute()} disabled={!executeEnabled}>Restore complete database</Button>}
          {step === 7 && <Button onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecoveryHistoryPanel({ rows }: { rows: RecoveryHistoryEntry[] }) {
  const sorted = [...rows].sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
  return (
    <section className={card} aria-labelledby="recovery-history-title">
      <h2 id="recovery-history-title" className="flex items-center gap-2 text-lg font-black"><History className="h-5 w-5" /> Recovery History</h2>
      {!sorted.length ? <EmptyState className="mt-5" title="No recovery events recorded." /> : (
        <DataTableContainer className="mt-5"><DataTable><DataTableHeader><DataTableRow><DataTableHead>Timestamp</DataTableHead><DataTableHead>Event</DataTableHead><DataTableHead>Backup</DataTableHead><DataTableHead>Actor</DataTableHead><DataTableHead>Result</DataTableHead><DataTableHead>Reference</DataTableHead></DataTableRow></DataTableHeader><DataTableBody>{sorted.map((row, index) => <DataTableRow key={`${row.timestamp}-${row.operation_reference_id}-${index}`}><DataTableCell>{row.timestamp || "Unknown"}</DataTableCell><DataTableCell>{row.event || "Unknown"}</DataTableCell><DataTableCell className="max-w-xs break-all font-mono text-xs">{row.filename || "—"}{row.safety_backup_filename ? <span className="block text-blue-700">Safety: {row.safety_backup_filename}</span> : null}</DataTableCell><DataTableCell>{row.actor_display}</DataTableCell><DataTableCell>{row.result || row.safe_reason_code || "Unknown"}</DataTableCell><DataTableCell className="font-mono text-xs">{row.operation_reference_id || "—"}</DataTableCell></DataTableRow>)}</DataTableBody></DataTable></DataTableContainer>
      )}
    </section>
  );
}

export function SchedulerPanel({ config, saving, onSave }: { config: BackupSchedulerConfig; saving: boolean; onSave: (value: Omit<BackupSchedulerConfig, "next_run_at" | "updated_at">) => void }) {
  const [draft, setDraft] = useState(config);
  useEffect(() => setDraft(config), [config]);
  return <section className={card}><h2 className="text-lg font-black">Scheduled Backups</h2><div className="mt-4 flex flex-wrap items-end gap-4"><FormField id="scheduler-enabled"><FieldLabel>Scheduler</FieldLabel><NativeSelect value={draft.enabled ? "enabled" : "disabled"} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === "enabled" }))}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></NativeSelect></FormField><p className="pb-2 text-sm text-slate-600">Next run: {config.next_run_at || "Not scheduled"}</p><Button disabled={saving} onClick={() => onSave({ enabled: draft.enabled, schedule_type: draft.schedule_type, interval_minutes: draft.interval_minutes, hour_utc: draft.hour_utc, minute_utc: draft.minute_utc, weekday_utc: draft.weekday_utc, keep_daily: draft.keep_daily, keep_weekly: draft.keep_weekly, keep_monthly: draft.keep_monthly })}>{saving ? "Saving…" : "Save schedule"}</Button></div></section>;
}

export function BackupHistoryPanel({ rows }: { rows: BackupExecutionHistory[] }) {
  return <section className={card}><h2 className="text-lg font-black">Backup Execution History</h2>{rows.length === 0 ? <EmptyState className="mt-5" title="No backup executions recorded." /> : <div className="mt-4 space-y-2">{rows.slice(0, 10).map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span>{row.started_at} · <strong>{row.trigger_type}</strong></span><span>{row.status} · {row.backup_filename || row.error_message || "No details"}</span></div>)}</div>}</section>;
}

export default function BackupManagement() {
  const statusQuery = useBackupStatus();
  const backupsQuery = useBackupList();
  const schedulerQuery = useBackupScheduler();
  const backupHistoryQuery = useBackupHistory();
  const recoveryHistoryQuery = useRecoveryHistory();
  const createMutation = useCreateBackupMutation();
  const deleteMutation = useDeleteBackupMutation();
  const schedulerMutation = useUpdateBackupSchedulerMutation();
  const [selected, setSelected] = useState<BackupEntry | null>(null);
  const [deleteSelected, setDeleteSelected] = useState<BackupEntry | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [createdBackup, setCreatedBackup] = useState<BackupEntry | null>(null);
  const status = statusQuery.data;
  const busy = createMutation.isPending || deleteMutation.isPending;
  const error = statusQuery.error || backupsQuery.error || schedulerQuery.error || backupHistoryQuery.error || recoveryHistoryQuery.error || createMutation.error || deleteMutation.error;
  const retry = () => void Promise.all([statusQuery.refetch(), backupsQuery.refetch(), schedulerQuery.refetch(), backupHistoryQuery.refetch(), recoveryHistoryQuery.refetch()]);

  return (
    <div className="space-y-7 pb-12">
      <PageHeader title="Backup & Recovery" description="Verified SQLite disaster recovery for this OperatorOS installation." actions={<><Link to="/settings" className={buttonVariants({ variant: "outline" })}><ArrowLeft /> Settings</Link><Button size="lg" onClick={() => void createMutation.mutateAsync().then(setCreatedBackup)} disabled={busy || status?.restore_in_progress}>{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />} {createMutation.isPending ? "Creating verified backup…" : "Create verified backup"}</Button></>} />
      <Alert variant="warning"><AlertTriangle className="mr-2 inline h-5 w-5" /><strong>Complete recovery uses SQLite backups.</strong> CSV remains a separate data-exchange workflow and cannot restore OperatorOS.</Alert>
      {error && <ErrorState title="Backup & Recovery could not be loaded" description={safeError(error)}><Button variant="outline" className="mt-4" onClick={retry}><RefreshCw className="h-4 w-4" /> Retry</Button></ErrorState>}
      {result && <Alert variant={result.status === "COMPLETED" ? "success" : result.status === "ROLLED_BACK" ? "warning" : "danger"}><CheckCircle2 className="mr-2 inline h-5 w-5" /><strong>{result.status}</strong> {result.safe_message}</Alert>}
      {createdBackup && <Alert variant="success"><CheckCircle2 className="mr-2 inline h-5 w-5" /><strong>Backup verified:</strong> {createdBackup.filename} · {createdBackup.created_at} · {formatBytes(createdBackup.size)} · checksum {createdBackup.checksum_status || "verified"} · integrity {createdBackup.integrity_status || "ok"} · schema {createdBackup.schema_version}</Alert>}
      {statusQuery.isLoading || backupsQuery.isLoading ? <LoadingState title="Loading backup and recovery status" /> : status ? <>
        <BackupStatusPanel status={status} />
        {schedulerQuery.data && <SchedulerPanel config={schedulerQuery.data} saving={schedulerMutation.isPending} onSave={(value) => void schedulerMutation.mutateAsync(value)} />}
        <BackupList backups={backupsQuery.data || []} onRestore={(backup) => { setSelected(backup); setResult(null); }} onDelete={setDeleteSelected} />
        <RecoveryHistoryPanel rows={recoveryHistoryQuery.data || []} />
        <BackupHistoryPanel rows={backupHistoryQuery.data || []} />
      </> : !error && <EmptyState title="Backup status is unavailable." />}
      {selected && status && <RestoreWizard backup={selected} destructiveEnabled={status.destructive_operations_enabled} onClose={() => setSelected(null)} onCompleted={setResult} />}
      {deleteSelected && <Dialog open onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteSelected(null)}><DialogContent><DialogHeader><DialogTitle>Delete backup</DialogTitle><DialogDescription>This removes the selected backup and manifest.</DialogDescription></DialogHeader><p className="mt-5 break-all font-mono text-sm">{deleteSelected.filename}</p><DialogFooter><Button variant="secondary" onClick={() => setDeleteSelected(null)}>Cancel</Button><Button variant="danger" disabled={deleteMutation.isPending} onClick={() => void deleteMutation.mutateAsync(deleteSelected.filename).then(() => setDeleteSelected(null))}>Delete backup</Button></DialogFooter></DialogContent></Dialog>}
    </div>
  );
}
