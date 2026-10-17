import { appendFileSync, chmodSync, mkdirSync } from "node:fs";

/**
 * Canonical recovery-history record for restore attempts.
 *
 * Every successful or failed restore appends exactly one record to
 * `<backup root>/backup_restore_audit.jsonl`; `GET /api/admin/backups/recovery-history`
 * reads this file. Records are append-only and are never rewritten or backfilled.
 */
export function appendRestoreAudit(root: string, record: {
  event: "restore_completed" | "restore_failed";
  outcome: "COMPLETED" | "FAILED";
  target_filename: string;
  authenticated_username: string | null;
  operation_id: string;
  pre_restore_snapshot_filename: string | null;
  reason: string | null;
}): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = `${root}/backup_restore_audit.jsonl`;
  appendFileSync(path, `${JSON.stringify({
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event: record.event,
    target_filename: record.target_filename,
    authenticated_username: record.authenticated_username,
    outcome: record.outcome,
    reason: record.reason,
    request_context: { operation_id: record.operation_id },
    pre_restore_snapshot_filename: record.pre_restore_snapshot_filename,
  })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
