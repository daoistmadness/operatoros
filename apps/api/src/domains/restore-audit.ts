import { appendFileSync, chmodSync, mkdirSync } from "node:fs";

/** Append-only lifecycle history read by `GET /api/admin/backups/recovery-history`. */
export type RestoreAuditEvent = "restore_requested" | "restore_denied" | "restore_started" | "restore_completed" | "restore_rolled_back" | "restore_failed";
export type RestoreAuditOutcome = "REQUESTED" | "DENIED" | "STARTED" | "COMPLETED" | "ROLLED_BACK" | "FAILED";

export function appendRestoreAudit(root: string, record: {
  event: RestoreAuditEvent;
  outcome: RestoreAuditOutcome;
  target_filename: string;
  authenticated_username: string | null;
  operation_id: string;
  pre_restore_snapshot_filename: string | null;
  reason: string | null;
}): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = `${root}/backup_restore_audit.jsonl`;
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event: record.event,
    target_filename: record.target_filename,
    authenticated_username: record.authenticated_username,
    outcome: record.outcome,
    reason: record.reason,
    request_context: { operation_id: record.operation_id },
    pre_restore_snapshot_filename: record.pre_restore_snapshot_filename,
  })}\n`;
  appendFileSync(path, "", { mode: 0o600 });
  chmodSync(path, 0o600);
  appendFileSync(path, line, { mode: 0o600 });
}

export function restoreAuditReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return message.match(/^[A-Z][A-Z0-9_]+/)?.[0] ??
    (message.startsWith("Legacy plaintext backups") ? "RESTORE_LEGACY_OPT_IN_REQUIRED" : error instanceof Error ? error.constructor.name : "Error");
}
