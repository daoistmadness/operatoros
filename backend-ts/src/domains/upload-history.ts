import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import { calculateHeb } from "./reports";
import { deriveJenjangFromClassName } from "./attendance-rules";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

const ATTENDANCE_ELIGIBLE = new Set(["NEW", "DIFFERENCE", "UNCHANGED"]);
const ATTENDANCE_KNOWN = new Set(["NEW", "DIFFERENCE", "UNCHANGED", "CONFLICT", "INVALID"]);
const ROSTER_ELIGIBLE = new Set(["CREATE_ENROLLMENT", "CREATE_NEW_MASTER"]);
const ROSTER_BLOCKED = new Set(["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS"]);
const ROSTER_KNOWN = new Set([...ROSTER_ELIGIBLE, ...ROSTER_BLOCKED, "INVALID"]);
const AUDIT_LABELS: Record<string, string> = {
  UPLOAD_CONFLICT_DEVICE_LINKED: "DEVICE_IDENTITY_LINKED",
  UPLOAD_CONFLICT_ROSTER_RESOLVED: "ROSTER_RESOLUTION_APPLIED",
  UPLOAD_CONFLICT_RETRY_PREVIEW: "RETRY_PREVIEW_CREATED",
  UPLOAD_CONFLICT_RETRY_STILL_BLOCKED: "RETRY_PREVIEW_CREATED",
  UPLOAD_CONFLICT_RETRY_COMMITTED: "RETRY_COMMIT_COMPLETED",
};

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

function row(context: AuthContext, sql: string, params: any[] = []): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function json(value: unknown): any {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function iso(value: unknown): string | null {
  return value == null || value === "" ? null : String(value).replace(" ", "T");
}

function safeFilename(value: unknown): string {
  const filename = String(value ?? "unknown").replaceAll("\\", "/").split("/").at(-1) || "unknown";
  return filename.slice(0, 255);
}

function mask(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length <= 4 ? "*".repeat(text.length) : `${"*".repeat(Math.min(text.length - 4, 8))}${text.slice(-4)}`;
}

function page(items: Row[], current: number, size: number): Row {
  const total = items.length;
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, page_size: size, total, pages: total ? Math.ceil(total / size) : 0 };
}

function auditEvents(context: AuthContext, sessionId: string): Row[] {
  return rows(context, "SELECT * FROM operations_audit_events WHERE import_session_id = ? ORDER BY occurred_at ASC, id ASC", [sessionId]);
}

function latest(values: unknown[]): string | null {
  return values.map(iso).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function retryEvidence(events: Row[]): { retried: number; selected: number; committed: number; attempts: number; resolved: Set<string> } {
  const previews = events.filter((value) => ["UPLOAD_CONFLICT_RETRY_PREVIEW", "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED"].includes(String(value.operation)));
  const committed = events.filter((value) => value.operation === "UPLOAD_CONFLICT_RETRY_COMMITTED");
  const attempts = new Set(previews.map((value) => json(value.metadata)?.retry_batch_id).filter(Boolean));
  return { retried: previews.length, selected: committed.length, committed: committed.length, attempts: attempts.size, resolved: new Set(committed.map((value) => value.entity_reference).filter(Boolean)) };
}

function reconciliation(record: Row, unknownClassification: boolean, unknownEvent: boolean): [string, string[]] {
  const messages: string[] = [];
  let inconsistent = false;
  let incomplete = false;
  const previewParts = [record.preview_eligible, record.conflict_total, record.invalid_total];
  if (unknownClassification) {
    incomplete = true;
    messages.push("An unknown preview classification prevents complete reconciliation.");
  } else if (previewParts.every((value) => value != null) && previewParts.reduce((sum, value) => sum + value, 0) !== record.preview_total) {
    inconsistent = true;
    messages.push("Preview classification totals do not reconcile with the recorded row count.");
  }
  if (["COMMITTED", "RETRIED"].includes(record.status)) {
    if (record.selected_total == null) {
      incomplete = true;
      messages.push("Selected-row evidence was not recorded.");
    } else {
      const commitParts = record.workflow_type === "ROSTER"
        ? [record.created_total, record.updated_total, record.skipped_total, record.failed_total]
        : [record.committed_total, record.skipped_total, record.protected_total, record.failed_total];
      if (commitParts.every((value) => value != null) && commitParts.reduce((sum, value) => sum + value, 0) !== record.selected_total) {
        inconsistent = true;
        messages.push("Commit totals do not reconcile with the recorded selection.");
      } else if (!commitParts.every((value) => value != null)) {
        incomplete = true;
        messages.push("Commit outcome evidence is incomplete.");
      }
    }
  } else if (record.selected_total == null) {
    incomplete = true;
    messages.push("Selection was not recorded because this upload was not committed.");
  }
  if (record.rollback_succeeded) messages.push("The commit was rolled back; no rows are counted as successfully imported.");
  if (unknownEvent) {
    incomplete = true;
    messages.push("Additional historical activity was recorded but cannot be displayed by this version.");
  }
  if (inconsistent) return ["INCONSISTENT", messages];
  if (incomplete) return ["INCOMPLETE", messages];
  if (record.unresolved_total) return ["BALANCED_WITH_UNRESOLVED", messages];
  return ["BALANCED", messages];
}

function attendanceRecord(context: AuthContext, batch: Row): Row {
  const importRows = rows(context, "SELECT * FROM attendance_import_rows WHERE batch_id = ? ORDER BY id", [batch.id]);
  const counts: Record<string, number> = {};
  for (const value of importRows) counts[String(value.classification)] = (counts[String(value.classification)] ?? 0) + 1;
  const events = auditEvents(context, String(batch.id));
  const retry = retryEvidence(events);
  const conflicts = new Set(importRows.filter((value) => value.classification === "CONFLICT").map((value) => `attendance:${value.id}`));
  const unresolved = [...conflicts].filter((value) => !retry.resolved.has(value)).length;
  const committed = batch.status === "committed";
  const result = json(batch.commit_result) ?? {};
  const inserted = committed && Number.isInteger(result.rows_inserted) ? Number(result.rows_inserted) : null;
  const updated = committed && Number.isInteger(result.rows_updated) ? Number(result.rows_updated) : null;
  const unchanged = committed && Number.isInteger(result.rows_unchanged) ? Number(result.rows_unchanged) : null;
  const selected = committed ? importRows.filter((value) => Number(value.selected_for_commit) === 1).length : null;
  const committedTotal = committed && [inserted, updated, unchanged].every((value) => value != null) ? inserted! + updated! + unchanged! : null;
  const status = retry.attempts ? "RETRIED" : batch.status === "failed" ? "FAILED" : batch.status === "preview" ? (unresolved ? "UNRESOLVED" : "PREVIEWED") : batch.status === "expired" ? "INCOMPLETE_PROVENANCE" : batch.status === "committing" ? "UNKNOWN" : "COMMITTED";
  const record: Row = {
    upload_id: `attendance:${batch.id}`, workflow_type: "ATTENDANCE", source_filename: safeFilename(batch.filename), source_checksum: batch.checksum,
    checksum_prefix: String(batch.checksum).slice(0, 12), first_activity_at: iso(batch.uploaded_at), latest_activity_at: latest([batch.committed_at, batch.uploaded_at, ...events.map((value) => value.occurred_at)]), actor: batch.uploaded_by, status,
    preview_total: importRows.length, preview_eligible: [...ATTENDANCE_ELIGIBLE].reduce((sum, name) => sum + (counts[name] ?? 0), 0), preview_blocked: counts.CONFLICT ?? 0,
    selected_total: selected, committed_total: committedTotal, created_total: inserted, updated_total: updated, unchanged_total: committed ? unchanged : counts.UNCHANGED ?? 0,
    skipped_total: committed ? 0 : null, duplicate_total: committed ? 0 : null, conflict_total: counts.CONFLICT ?? 0, invalid_total: counts.INVALID ?? 0,
    protected_total: committed ? 0 : null, failed_total: committed ? 0 : null, unresolved_total: unresolved, retried_total: retry.retried,
    retry_selected_total: retry.selected, retry_committed_total: retry.committed, rollback_attempted: false, rollback_succeeded: false,
    resolution_item_count: [...conflicts].filter((value) => retry.resolved.has(value)).length, retry_attempt_count: retry.attempts,
    operation_references: events.map((value) => value.event_id).filter(Boolean).sort(),
  };
  const [state, messages] = reconciliation(record, importRows.some((value) => !ATTENDANCE_KNOWN.has(String(value.classification))), events.some((value) => !AUDIT_LABELS[value.operation]));
  return { ...record, reconciliation_state: state, reconciliation_messages: messages };
}

function rosterRecord(context: AuthContext, batch: Row): Row {
  const session = row(context, "SELECT * FROM student_import_sessions WHERE id = ?", [batch.session_id]);
  const importRows = json(batch.rows) ?? [];
  const counts: Record<string, number> = {};
  for (const value of importRows) counts[String(value.classification)] = (counts[String(value.classification)] ?? 0) + 1;
  const events = auditEvents(context, String(batch.session_id));
  const retry = retryEvidence(events);
  const blocked = importRows.filter((value: Row) => ROSTER_BLOCKED.has(String(value.classification)));
  const conflictRefs = new Set(blocked.map((value: Row) => `roster:${batch.id}:${value.preview_row_id}`));
  const resolved = new Set(events.filter((value) => ["UPLOAD_CONFLICT_ROSTER_RESOLVED", "UPLOAD_CONFLICT_RETRY_COMMITTED"].includes(String(value.operation))).map((value) => value.entity_reference).filter(Boolean));
  const unresolved = [...conflictRefs].filter((value) => !resolved.has(value)).length;
  const committed = batch.status === "committed";
  const result = json(batch.commit_result) ?? {};
  const rolledBack = session?.rollback_state === "APPLIED";
  const created = committed ? (rolledBack ? 0 : Number(result.created ?? 0)) : null;
  const selected = committed && session ? Number(session.selected_row_count) : null;
  const status = rolledBack ? "ROLLED_BACK" : batch.status === "failed" || session?.status === "COMMIT_FAILED" ? "FAILED" : retry.attempts ? "RETRIED" : committed ? "COMMITTED" : unresolved ? "UNRESOLVED" : "PREVIEWED";
  const actions = rows(context, "SELECT operation_id FROM student_import_applied_actions WHERE session_id = ?", [batch.session_id]);
  const record: Row = {
    upload_id: `roster:${batch.id}`, workflow_type: "ROSTER", source_filename: safeFilename(batch.filename), source_checksum: batch.checksum,
    checksum_prefix: String(batch.checksum).slice(0, 12), first_activity_at: iso(batch.created_at), latest_activity_at: latest([batch.committed_at, batch.created_at, session?.updated_at, session?.rollback_completed_at, ...events.map((value) => value.occurred_at)]), actor: batch.created_by, status,
    preview_total: importRows.length, preview_eligible: [...ROSTER_ELIGIBLE].reduce((sum, name) => sum + (counts[name] ?? 0), 0), preview_blocked: [...ROSTER_BLOCKED].reduce((sum, name) => sum + (counts[name] ?? 0), 0),
    selected_total: selected, committed_total: created, created_total: created, updated_total: committed ? 0 : null, unchanged_total: committed ? 0 : null, skipped_total: committed ? 0 : null,
    duplicate_total: counts.POSSIBLE_DUPLICATE ?? 0, conflict_total: blocked.length, invalid_total: counts.INVALID ?? 0, protected_total: committed ? 0 : null, failed_total: committed ? 0 : null,
    unresolved_total: unresolved, retried_total: retry.retried, retry_selected_total: retry.selected, retry_committed_total: retry.committed,
    rollback_attempted: Boolean(session && !["NOT_AVAILABLE", "AVAILABLE"].includes(String(session.rollback_state))), rollback_succeeded: rolledBack,
    resolution_item_count: [...conflictRefs].filter((value) => resolved.has(value)).length, retry_attempt_count: retry.attempts,
    operation_references: [...events.map((value) => value.event_id), ...actions.map((value) => value.operation_id)].filter(Boolean).sort(),
  };
  const [state, messages] = reconciliation(record, importRows.some((value: Row) => !ROSTER_KNOWN.has(String(value.classification))), events.some((value) => !AUDIT_LABELS[value.operation] && !String(value.operation).includes("ROLLBACK")));
  if (session && session.provenance_status !== "COMPLETE_ACTION_PROVENANCE") {
    messages.push("Preview evidence is incomplete for this historical upload.");
    return { ...record, reconciliation_state: "INCOMPLETE", reconciliation_messages: messages };
  }
  return { ...record, reconciliation_state: state, reconciliation_messages: messages };
}

function uploadRecord(context: AuthContext, uploadId: string): Row {
  const parts = uploadId.split(":", 2);
  const workflow = parts[0] ?? "";
  const rawId = parts[1];
  if (!rawId || !["attendance", "roster"].includes(workflow)) throw Object.assign(new Error("Upload history record not found"), { status: 404 });
  const batch = workflow === "attendance"
    ? row(context, "SELECT * FROM attendance_import_batches WHERE id = ?", [rawId])
    : row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [rawId]);
  if (!batch) throw Object.assign(new Error("Upload history record not found"), { status: 404 });
  return workflow === "attendance" ? attendanceRecord(context, batch) : rosterRecord(context, batch);
}

function listHistory(context: AuthContext, query: Row): Row {
  let values = [
    ...rows(context, "SELECT * FROM attendance_import_batches").map((value) => attendanceRecord(context, value)),
    ...rows(context, "SELECT * FROM academic_roster_import_batches").map((value) => rosterRecord(context, value)),
  ].sort((a, b) => String(b.latest_activity_at ?? "").localeCompare(String(a.latest_activity_at ?? "")) || String(b.upload_id).localeCompare(String(a.upload_id)));
  if (query.workflow_type) values = values.filter((value) => value.workflow_type === String(query.workflow_type).toUpperCase());
  if (query.status) values = values.filter((value) => value.status === String(query.status).toUpperCase());
  if (query.reconciliation_state) values = values.filter((value) => value.reconciliation_state === String(query.reconciliation_state).toUpperCase());
  if (query.actor) values = values.filter((value) => String(value.actor ?? "").toLowerCase().includes(String(query.actor).toLowerCase()));
  if (query.filename) values = values.filter((value) => String(value.source_filename).toLowerCase().includes(String(query.filename).toLowerCase()));
  if (query.checksum_prefix) values = values.filter((value) => String(value.source_checksum).toLowerCase().startsWith(String(query.checksum_prefix).toLowerCase()));
  if (query.unresolved_only === "true") values = values.filter((value) => Number(value.unresolved_total ?? 0) > 0);
  if (query.retry_activity === "true") values = values.filter((value) => Number(value.retry_attempt_count ?? 0) > 0);
  if (query.date_from) values = values.filter((value) => String(value.latest_activity_at ?? "").slice(0, 10) >= String(query.date_from));
  if (query.date_to) values = values.filter((value) => String(value.latest_activity_at ?? "").slice(0, 10) <= String(query.date_to));
  return page(values, Number(query.page ?? 1), Number(query.page_size ?? 20));
}

function timeline(context: AuthContext, uploadId: string): Row[] {
  const record = uploadRecord(context, uploadId);
  const rawId = uploadId.split(":", 2)[1]!;
  const sessionId = record.workflow_type === "ROSTER" ? String(row(context, "SELECT session_id FROM academic_roster_import_batches WHERE id = ?", [rawId])?.session_id) : rawId;
  const events = auditEvents(context, sessionId);
  const values: Row[] = [
    { timestamp: record.first_activity_at, event: "FILE_RECEIVED", actor: record.actor, reference_id: uploadId, counts: { preview_total: record.preview_total }, reason_code: null, message: "The source file was received and retained as a checksum-backed preview." },
    { timestamp: record.first_activity_at, event: "PREVIEW_CREATED", actor: record.actor, reference_id: uploadId, counts: { eligible: record.preview_eligible, blocked: record.preview_blocked, invalid: record.invalid_total }, reason_code: null, message: "Preview validation completed without changing live records." },
  ];
  if (record.selected_total != null) values.push({ timestamp: record.latest_activity_at, event: "ROWS_SELECTED", actor: record.actor, reference_id: uploadId, counts: { selected: record.selected_total }, reason_code: null, message: "Stable preview row references were selected for commit." });
  if (["COMMITTED", "RETRIED", "ROLLED_BACK"].includes(record.status)) values.push({ timestamp: record.latest_activity_at, event: record.rollback_succeeded ? "COMMIT_ROLLED_BACK" : "COMMIT_COMPLETED", actor: record.actor, reference_id: uploadId, counts: { committed: record.committed_total }, reason_code: null, message: record.rollback_succeeded ? "The recorded commit was later rolled back; successful totals are not claimed." : "The selected rows completed the canonical commit workflow." });
  for (const event of events) {
    const label = AUDIT_LABELS[event.operation];
    const metadata = json(event.metadata) ?? {};
    const safeCounts = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => ["source_row", "outcome"].includes(key) && ["string", "number", "boolean"].includes(typeof value)));
    values.push({ timestamp: iso(event.occurred_at), event: label ?? "ADDITIONAL_HISTORICAL_ACTIVITY", actor: event.actor_id, reference_id: event.event_id, counts: safeCounts, reason_code: event.failure_code ?? null, message: label ? `${label.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())}.` : "Additional historical activity was recorded but cannot be displayed by this version." });
  }
  return values.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")) || String(a.reference_id).localeCompare(String(b.reference_id)));
}

function historyRows(context: AuthContext, uploadId: string, outcome: string | undefined): Row[] {
  const record = uploadRecord(context, uploadId);
  const rawId = uploadId.split(":", 2)[1]!;
  const roster = record.workflow_type === "ROSTER" ? row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [rawId]) : null;
  const sessionId = roster?.session_id ?? rawId;
  const events = auditEvents(context, String(sessionId));
  const latestByReference = new Map(events.filter((value) => value.entity_type === "UPLOAD_CONFLICT").map((value) => [value.entity_reference, value]));
  const values: Row[] = [];
  if (record.workflow_type === "ATTENDANCE") {
    for (const value of rows(context, "SELECT * FROM attendance_import_rows WHERE batch_id = ? ORDER BY id", [rawId])) {
      const reference = `attendance:${value.id}`;
      const event = latestByReference.get(reference);
      const retried = Boolean(event && String(event.operation).includes("RETRY"));
      const committed = Number(value.selected_for_commit) === 1;
      const unresolved = value.classification === "CONFLICT" && event?.operation !== "UPLOAD_CONFLICT_RETRY_COMMITTED";
      const filter = committed ? "committed" : retried ? "retried" : unresolved ? "unresolved" : String(value.classification).toLowerCase();
      values.push({ source_row_number: value.source_row, stable_row_reference: reference, preview_classification: value.classification, selection_state: committed ? "SELECTED" : record.selected_total != null ? "NOT_SELECTED" : "UNKNOWN", commit_outcome: committed ? "COMMITTED" : record.selected_total != null ? "NOT_COMMITTED" : "UNKNOWN", retry_outcome: event?.operation === "UPLOAD_CONFLICT_RETRY_COMMITTED" ? "COMMITTED" : retried ? "ATTEMPTED" : "NOT_RETRIED", technical_code: String(value.validation_error || value.classification).split(":", 1)[0], explanation: value.validation_error || value.warning || `Preview classified this row as ${value.classification}.`, recommended_action: unresolved ? "Open Needs Attention to resolve and revalidate this row." : "No historical action is required.", masked_identifier: mask(value.student_identifier), resolution_status: unresolved ? "UNRESOLVED" : retried ? "RESOLVED" : "NOT_APPLICABLE", _filter: filter });
    }
  } else {
    if (!roster) return [];
    const session = row(context, "SELECT * FROM student_import_sessions WHERE id = ?", [roster.session_id]);
    const selectedSources = new Set(rows(context, "SELECT source_row_number FROM student_import_applied_actions WHERE session_id = ?", [roster.session_id]).map((value) => Number(value.source_row_number)));
    for (const value of json(roster.rows) ?? []) {
      const reference = `roster:${roster.id}:${value.preview_row_id}`;
      const event = latestByReference.get(reference);
      const selected = selectedSources.has(Number(value.source_row));
      const blocked = ROSTER_BLOCKED.has(String(value.classification));
      const resolved = Boolean(event && ["UPLOAD_CONFLICT_ROSTER_RESOLVED", "UPLOAD_CONFLICT_RETRY_COMMITTED"].includes(String(event.operation)));
      const filter = selected ? "committed" : event && String(event.operation).includes("RETRY") ? "retried" : blocked && !resolved ? "unresolved" : String(value.classification ?? "unknown").toLowerCase();
      const payload = value.payload && typeof value.payload === "object" ? value.payload : {};
      values.push({ source_row_number: value.source_row, stable_row_reference: reference, preview_classification: value.classification ?? "UNKNOWN", selection_state: selected ? "SELECTED" : session?.status === "COMMITTED" ? "NOT_SELECTED" : "UNKNOWN", commit_outcome: selected && !record.rollback_succeeded ? "COMMITTED" : selected ? "ROLLED_BACK" : "UNKNOWN", retry_outcome: event && String(event.operation).includes("RETRY") ? "ATTEMPTED" : "NOT_RETRIED", technical_code: value.classification ?? "UNKNOWN", explanation: (value.errors ?? []).join("; ") || "Roster preview classification retained.", recommended_action: blocked && !resolved ? "Open Needs Attention to resolve this row." : "No historical action is required.", masked_identifier: mask(payload.student_identifier), resolution_status: resolved ? "RESOLVED" : blocked ? "UNRESOLVED" : "NOT_APPLICABLE", _filter: filter });
    }
  }
  return values.filter((value) => !outcome || value._filter === outcome.toLowerCase()).map(({ _filter, ...value }) => value);
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function evidence(context: AuthContext, uploadId: string): Row {
  const summary = uploadRecord(context, uploadId);
  const payload: Row = { format_version: "1.0", generated_at: new Date().toISOString(), application: "OperatorOS", upload_id: uploadId, workflow_type: summary.workflow_type, source_checksum: summary.source_checksum, sanitization_statement: "Local paths, raw rows, secrets, private audit metadata, and unmasked identifiers are excluded.", reconciliation: summary, timeline: timeline(context, uploadId), row_outcomes: historyRows(context, uploadId, undefined) };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  payload.manifest = { included_sections: ["reconciliation", "timeline", "row_outcomes"], content_sha256: createHash("sha256").update(canonical).digest("hex") };
  return payload;
}

function csvEvidence(context: AuthContext, uploadId: string): Uint8Array {
  const value = evidence(context, uploadId);
  const headers = ["section", "key", "value", "timestamp", "event", "actor", "reference_id", "source_row", "classification", "selection", "commit_outcome", "retry_outcome", "masked_identifier", "message"];
  const lines = [headers.map(csvCell).join(",")];
  for (const key of Object.keys(value.reconciliation).sort()) lines.push(["reconciliation", key, value.reconciliation[key]].map(csvCell).join(","));
  for (const item of value.timeline) lines.push(["timeline", "", "", item.timestamp, item.event, item.actor, item.reference_id, "", "", "", "", "", "", item.message].map(csvCell).join(","));
  for (const item of value.row_outcomes) lines.push(["row_outcome", "", "", "", "", "", item.stable_row_reference, item.source_row_number, item.preview_classification, item.selection_state, item.commit_outcome, item.retry_outcome, item.masked_identifier, item.explanation].map(csvCell).join(","));
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

function fail(set: any, status: number, detail: unknown): Row {
  set.status = status;
  return { detail };
}

export function uploadHistoryRoutes(app: any, context: AuthContext): any {
  const query = t.Object({ page: t.Optional(t.String()), page_size: t.Optional(t.String()), workflow_type: t.Optional(t.String()), status: t.Optional(t.String()), reconciliation_state: t.Optional(t.String()), actor: t.Optional(t.String()), filename: t.Optional(t.String()), checksum_prefix: t.Optional(t.String()), unresolved_only: t.Optional(t.String()), retry_activity: t.Optional(t.String()), date_from: t.Optional(t.String()), date_to: t.Optional(t.String()) });
  app.get("/api/uploads/history", ({ query: values, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; return listHistory(context, values); }, { query });
  app.get("/api/uploads/history/:upload_id/export.csv", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; try { return new Response(csvEvidence(context, params.upload_id), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=operatoros-upload-evidence-${safeFilename(params.upload_id).replaceAll(":", "-")}.csv` } }); } catch (error) { return fail(set, (error as any).status ?? 404, (error as Error).message); } }, { params: t.Object({ upload_id: t.String({ minLength: 3 }) }), response: t.Any() });
  app.get("/api/uploads/history/:upload_id/export.json", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; try { return new Response(`${JSON.stringify(evidence(context, params.upload_id), null, 2)}\n`, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename=operatoros-upload-evidence-${safeFilename(params.upload_id).replaceAll(":", "-")}.json` } }); } catch (error) { return fail(set, (error as any).status ?? 404, (error as Error).message); } }, { params: t.Object({ upload_id: t.String({ minLength: 3 }) }), response: t.Any() });
  app.get("/api/uploads/history/:upload_id/timeline", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; try { return { items: timeline(context, params.upload_id) }; } catch (error) { return fail(set, (error as any).status ?? 404, (error as Error).message); } }, { params: t.Object({ upload_id: t.String({ minLength: 3 }) }) });
  app.get("/api/uploads/history/:upload_id/rows", ({ params, query: values, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; try { return page(historyRows(context, params.upload_id, values.outcome), Number(values.page ?? 1), Number(values.page_size ?? 25)); } catch (error) { return fail(set, (error as any).status ?? 404, (error as Error).message); } }, { params: t.Object({ upload_id: t.String({ minLength: 3 }) }), query: t.Object({ page: t.Optional(t.String()), page_size: t.Optional(t.String()), outcome: t.Optional(t.String()) }) });
  app.get("/api/uploads/history/:upload_id", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student_audit" }); if (!user) return { detail: "Insufficient permissions" }; try { return uploadRecord(context, params.upload_id); } catch (error) { return fail(set, (error as any).status ?? 404, (error as Error).message); } }, { params: t.Object({ upload_id: t.String({ minLength: 3 }) }) });
  app.get("/api/uploads/missing-records", ({ query: values, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_attendance" }); if (!user) return { detail: "Insufficient permissions" }; const month = Number(values.month); const year = Number(values.year); if (!Number.isInteger(month) || month < 1 || month > 12) return fail(set, 400, "month must be between 1 and 12"); const students = rows(context, values.class_name && String(values.class_name).trim().toLowerCase() !== "all" ? String(values.class_name).trim().toLowerCase() === "unassigned" ? "SELECT * FROM students WHERE class_name IS NULL ORDER BY name" : "SELECT * FROM students WHERE class_name = ? ORDER BY name" : "SELECT * FROM students ORDER BY name", values.class_name && String(values.class_name).trim().toLowerCase() !== "all" && String(values.class_name).trim().toLowerCase() !== "unassigned" ? [values.class_name] : []); const ids = students.map((value) => value.id); const counts = new Map<number, number>(); if (ids.length) for (const value of rows(context, `SELECT student_id, COUNT(*) AS attendance_count FROM attendance WHERE student_id IN (${ids.map(() => "?").join(",")}) AND status != 'skipped' AND strftime('%m', date) = ? AND strftime('%Y', date) = ? GROUP BY student_id`, [...ids, String(month).padStart(2, "0"), String(year)])) counts.set(Number(value.student_id), Number(value.attendance_count)); const hebByJenjang: Record<string, number> = {}; const underRecorded: Row[] = []; for (const student of students) { const jenjang = student.jenjang || deriveJenjangFromClassName(student.class_name ?? null); if (!(jenjang in hebByJenjang)) hebByJenjang[jenjang] = Number(calculateHeb(context, jenjang, month, year).heb); const heb = hebByJenjang[jenjang] ?? 0; const count = counts.get(Number(student.id)) ?? 0; if (count < heb) underRecorded.push({ no_id: String(student.id), nama: student.name, class_name: student.class_name, jenjang, heb, attendance_count: count, missing_days: heb - count }); } return { month: `${year}-${String(month).padStart(2, "0")}`, heb_by_jenjang: hebByJenjang, under_recorded: underRecorded, total_students: students.length, under_recorded_count: underRecorded.length }; }, { query: t.Object({ month: t.String(), year: t.String(), class_name: t.Optional(t.String()) }) });
  app.get("/api/uploads/sample-template", async ({ set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_attendance" }); if (!user) return { detail: "Insufficient permissions" }; const now = new Date(); const date = (offset: number) => { const value = new Date(now.getTime() + offset * 86400000); return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`; }; const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Attendance"); sheet.addRow(["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Absent", "Lembur", "Pengecualian", "week"]); sheet.addRows([[20000001, "Budi Santoso", date(0), "07:00", "14:30", "", "", "", "", now.toLocaleDateString("en-US", { weekday: "short" })], [20000002, "Siti Rahayu", date(0), "07:45", "14:30", "0:45:00", "", "", "", now.toLocaleDateString("en-US", { weekday: "short" })], [20000003, "Ahmad Fauzi", date(0), "", "", "", "True", "", "Sakit", now.toLocaleDateString("en-US", { weekday: "short" })], [20000004, "Dewi Kurniawati", date(1), "06:55", "15:00", "", "", "0:30:00", "", new Date(now.getTime() + 86400000).toLocaleDateString("en-US", { weekday: "short" })], [20000005, "Rizky Pratama", date(1), "08:10", "14:30", "1:10:00", "", "", "", new Date(now.getTime() + 86400000).toLocaleDateString("en-US", { weekday: "short" })]]); const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=attendance_template.xlsx" } }); });
  return app;
}
