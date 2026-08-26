import { createHash, randomUUID } from "node:crypto";
import { t } from "elysia";
import { inTransaction } from "../db/connection";
import { actor } from "./core";
import { createPreview, commitPreview } from "./attendance-import";
import type { AuthContext } from "../auth/service";
import type { AttendanceSourceRow, WorkbookRows } from "../import/excel-reader";

type Row = Record<string, any>;
type Context = any;

const LINK_CONFIRMATION = "LINK_UNMATCHED_DEVICE_ID";
const ROSTER_CONFIRMATION = "RESOLVE_ROSTER_CONFLICT";
const ATTENDANCE_CONFIRMATION = "COMMIT_ATTENDANCE_IMPORT";
const DEVICE_IDENTITY_UNMATCHED = "DEVICE_IDENTITY_UNMATCHED";
const COMMITTABLE = new Set(["NEW", "DIFFERENCE", "UNCHANGED"]);
const IDENTITY_FIELDS = [
  "full_name", "preferred_name", "nipd", "nisn", "nik", "birth_place", "birth_date",
  "gender", "religion", "citizenship", "blood_type", "student_status", "admission_date",
  "admission_type", "previous_school",
];

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function json(value: unknown): any { if (value == null || value === "") return null; if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } }
function fail(set: any, status: number, code: string, message: string): Row { set.status = status; return { detail: { code, message } }; }
function mask(value: unknown): string | null { if (value == null || value === "") return null; const text = String(value); return text.length <= 4 ? "*".repeat(text.length) : `${"*".repeat(text.length - 4)}${text.slice(-4)}`; }
function normalizedName(value: unknown): string { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function recordVersion(value: Row): string { return digest([value.id, value.updated_at ? String(value.updated_at).replace(" ", "T") : "", ...IDENTITY_FIELDS.map((field) => value[field] || "")].join("|")); }
function sourceDate(value: unknown): string | null { return value == null || value === "" ? null : String(value).slice(0, 10); }
function technicalCode(value: unknown): string | null { const text = String(value ?? ""); const prefix = text.split(":", 1)[0] ?? ""; return /^[A-Z0-9_]+$/.test(prefix) ? prefix : null; }
function latestAudit(context: AuthContext, reference: string): Row | null { return row(context, "SELECT * FROM operations_audit_events WHERE entity_type = 'UPLOAD_CONFLICT' AND entity_reference = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [reference]); }
function auditMetadata(value: Row | null): Row { return json(value?.metadata) ?? {}; }
function resolutionStatus(latest: Row | null, retryEligible: boolean): string {
  if (!latest) return "UNRESOLVED";
  if (latest.operation === "UPLOAD_CONFLICT_RETRY_COMMITTED") return "RETRIED_COMMITTED";
  if (latest.operation === "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED") return "RETRIED_STILL_BLOCKED";
  if (["UPLOAD_CONFLICT_DEVICE_LINKED", "UPLOAD_CONFLICT_ROSTER_RESOLVED", "UPLOAD_CONFLICT_RETRY_PREVIEW"].includes(String(latest.operation))) return retryEligible ? "RESOLVED_PENDING_RETRY" : "UNRESOLVED";
  return "UNRESOLVED";
}
function operationAudit(context: AuthContext, user: Row, reference: string, operation: string, sessionId: string | null, metadata: Row, capability: string, risk = "HIGH"): void {
  context.database.client.run("INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, import_session_id, success, changed_fields, metadata, schema_version) VALUES (?, ?, ?, ?, 'UPLOAD_CONFLICT', ?, ?, ?, 'API', ?, 1, ?, ?, '1')", [randomUUID(), user.username, user.role, capability, reference, operation, risk, sessionId, JSON.stringify([]), JSON.stringify(metadata)]);
}

function attendanceItem(context: AuthContext, value: Row, batch: Row): Row {
  const reference = `attendance:${value.id}`;
  const latest = latestAudit(context, reference);
  const proposed = json(value.proposed_change) ?? {};
  const mapping = row(context, "SELECT * FROM student_device_identities WHERE device_source = 'attendance_machine' AND device_identifier = ? AND is_active = 1 LIMIT 1", [value.student_identifier]);
  const retryEligible = Boolean(proposed._retry_source && value.classification === "CONFLICT" && technicalCode(value.validation_error) === DEVICE_IDENTITY_UNMATCHED && mapping && !Number(value.selected_for_commit));
  const student = mapping ? row(context, "SELECT * FROM student_masters WHERE id = ?", [mapping.student_master_id]) : null;
  return {
    resolution_item_id: reference, workflow_type: "ATTENDANCE", source_session_id: batch.id,
    source_filename: batch.filename, source_checksum: batch.checksum, source_checksum_prefix: String(batch.checksum).slice(0, 12),
    source_row_number: value.source_row, created_at: batch.uploaded_at, latest_classification: value.classification,
    operator_message: technicalCode(value.validation_error) === DEVICE_IDENTITY_UNMATCHED ? `Device ID ${value.student_identifier || "unknown"} is not linked to an active student.` : "This attendance row is blocked by validation.",
    technical_code: technicalCode(value.validation_error) ?? value.classification,
    recommended_action: technicalCode(value.validation_error) === DEVICE_IDENTITY_UNMATCHED ? "Link this device ID to a specific active student, then retry preview." : "Correct the source conflict and create a new preview.",
    resolution_status: Number(value.selected_for_commit) ? "RETRIED_COMMITTED" : resolutionStatus(latest, retryEligible), retry_eligible: retryEligible,
    affected_identifiers: { device_identifier: value.student_identifier, attendance_date: sourceDate(value.attendance_date) },
    student: student ? { id: student.id, full_name: student.full_name, student_status: student.student_status } : null,
    latest_retry_at: latest && String(latest.operation).includes("RETRY") ? latest.occurred_at : null,
    latest_result: latest ? auditMetadata(latest) : null,
  };
}

function rosterItem(context: AuthContext, value: Row, batch: Row): Row {
  const reference = `roster:${batch.id}:${value.preview_row_id}`;
  const latest = latestAudit(context, reference);
  const metadata = auditMetadata(latest);
  const studentId = metadata.student_master_id ?? value.matched_student_master_id;
  const student = studentId ? row(context, "SELECT * FROM student_masters WHERE id = ?", [studentId]) : null;
  const retryEligible = Boolean(latest?.operation === "UPLOAD_CONFLICT_ROSTER_RESOLVED" && student?.student_status === "active");
  const payload = value.payload ?? {};
  return {
    resolution_item_id: reference, workflow_type: "ROSTER", source_session_id: batch.session_id,
    source_filename: batch.filename, source_checksum: batch.checksum, source_checksum_prefix: String(batch.checksum).slice(0, 12),
    source_row_number: value.source_row, created_at: batch.created_at, latest_classification: value.classification,
    operator_message: (value.errors ?? []).join("; ") || "This roster row needs review.", technical_code: value.classification,
    recommended_action: ({ POSSIBLE_DUPLICATE: "Compare stable identifiers and explicitly select the existing student.", MISSING_JENJANG: "Select an active canonical Jenjang in the source roster.", MISSING_CLASS: "Select an active approved class and program in the source roster.", INVALID: "Correct the invalid or duplicate source data." } as Row)[value.classification] ?? "Review the technical details; unknown classifications stay blocked.",
    resolution_status: resolutionStatus(latest, retryEligible), retry_eligible: retryEligible,
    affected_identifiers: Object.fromEntries(["student_identifier", "student_master_id", "nipd", "nisn"].filter((key) => payload[key]).map((key) => [key, payload[key]])),
    student: student ? { id: student.id, full_name: student.full_name, student_status: student.student_status } : null,
    latest_retry_at: latest && String(latest.operation).includes("RETRY") ? latest.occurred_at : null,
    latest_result: latest ? metadata : null,
  };
}

function conflict(context: AuthContext, reference: string): Row {
  if (reference.startsWith("attendance:")) {
    const id = Number(reference.split(":")[1]); const value = row(context, "SELECT * FROM attendance_import_rows WHERE id = ?", [id]);
    const batch = value ? row(context, "SELECT * FROM attendance_import_batches WHERE id = ?", [value.batch_id]) : null;
    if (!value || !batch) throw Object.assign(new Error("not found"), { code: "RESOLUTION_ITEM_NOT_FOUND", status: 404 });
    return attendanceItem(context, value, batch);
  }
  const parts = reference.split(":");
  if (parts.length === 3 && parts[0] === "roster") {
    const batch = row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [parts[1]]); const values = json(batch?.rows) ?? [];
    const value = values.find((candidate: Row) => Number(candidate.preview_row_id) === Number(parts[2]));
    if (!batch || !value) throw Object.assign(new Error("not found"), { code: "RESOLUTION_ITEM_NOT_FOUND", status: 404 });
    return rosterItem(context, value, batch);
  }
  throw Object.assign(new Error("not found"), { code: "RESOLUTION_ITEM_NOT_FOUND", status: 404 });
}

function list(context: AuthContext, query: Row): Row {
  const values: Row[] = [];
  if (!query.workflow_type || query.workflow_type === "ATTENDANCE") {
    for (const value of rows(context, "SELECT r.*, b.filename, b.checksum, b.uploaded_at FROM attendance_import_rows r JOIN attendance_import_batches b ON b.id = r.batch_id WHERE r.classification IN ('CONFLICT', 'INVALID') OR r.validation_error IS NOT NULL")) values.push(attendanceItem(context, value, { id: value.batch_id, filename: value.filename, checksum: value.checksum, uploaded_at: value.uploaded_at }));
  }
  if (!query.workflow_type || query.workflow_type === "ROSTER") {
    for (const batch of rows(context, "SELECT * FROM academic_roster_import_batches")) {
      const committed = new Set(rows(context, "SELECT source_row_number FROM student_import_applied_actions WHERE academic_roster_import_batch_id = ?", [batch.id]).map((value) => Number(value.source_row_number)));
      for (const value of json(batch.rows) ?? []) if (!["CREATE_ENROLLMENT", "CREATE_NEW_MASTER"].includes(value.classification) && !committed.has(Number(value.source_row))) values.push(rosterItem(context, value, batch));
    }
  }
  const filtered = values.filter((value) => (!query.technical_code || value.technical_code === query.technical_code) && (!query.resolution_status || value.resolution_status === query.resolution_status) && (query.retry_eligible == null || Boolean(value.retry_eligible) === (query.retry_eligible === true || query.retry_eligible === "true")) && (!query.source_session_id || value.source_session_id === query.source_session_id) && (!query.created_from || String(value.created_at ?? "").slice(0, 10) >= query.created_from) && (!query.created_to || String(value.created_at ?? "").slice(0, 10) <= query.created_to));
  const order: Row = { UNRESOLVED: 0, RESOLVED_PENDING_RETRY: 1, RETRIED_STILL_BLOCKED: 2, RETRIED_COMMITTED: 3 };
  filtered.sort((a, b) => (order[a.resolution_status] ?? 9) - (order[b.resolution_status] ?? 9) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || Number(a.source_row_number ?? 0) - Number(b.source_row_number ?? 0));
  const page = Number(query.page ?? 1); const size = Number(query.page_size ?? 25); const total = filtered.length;
  return { items: filtered.slice((page - 1) * size, page * size), total, page, page_size: size, total_pages: total ? Math.ceil(total / size) : 0, summary: { unresolved: filtered.filter((value) => value.resolution_status === "UNRESOLVED").length, attendance: filtered.filter((value) => value.workflow_type === "ATTENDANCE").length, roster: filtered.filter((value) => value.workflow_type === "ROSTER").length, retry_ready: filtered.filter((value) => value.retry_eligible).length } };
}

function studentCandidates(context: AuthContext, reference: string, search: string, limit: number): Row[] {
  conflict(context, reference); const cleaned = search.trim(); if (cleaned.length < 2) throw Object.assign(new Error("broad"), { code: "STUDENT_SEARCH_TOO_BROAD", status: 400 });
  const pattern = `%${cleaned.toLowerCase()}%`;
  return rows(context, `SELECT * FROM student_masters WHERE id = ? OR nipd = ? OR nisn = ? OR nik = ? OR id IN (SELECT student_master_id FROM student_device_identities WHERE lower(device_identifier) LIKE ?) OR lower(normalized_name) LIKE ? ORDER BY CASE WHEN student_status = 'active' THEN 0 ELSE 1 END, full_name LIMIT ${Math.min(Math.max(limit, 1), 50)}`, [cleaned, cleaned, cleaned, cleaned, pattern, pattern]).map((value) => {
    const enrollment = row(context, "SELECT class_name, jenjang_id FROM student_enrollments WHERE student_master_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1", [value.id]);
    const device = row(context, "SELECT device_identifier FROM student_device_identities WHERE student_master_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1", [value.id]);
    return { id: value.id, record_version: recordVersion(value), full_name: value.full_name, nipd_masked: mask(value.nipd), nisn_masked: mask(value.nisn), student_status: value.student_status, current_class: enrollment?.class_name ?? null, jenjang_id: enrollment?.jenjang_id ?? null, has_active_device: Boolean(device), active_device_masked: mask(device?.device_identifier) };
  });
}

function rosterComparison(context: AuthContext, reference: string, studentMasterId?: string): Row {
  const item = conflict(context, reference); if (item.workflow_type !== "ROSTER") throw Object.assign(new Error("invalid"), { code: "ROSTER_RESOLUTION_INVALID", status: 409 });
  const parts = reference.split(":"); const batch = row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [parts[1]]) as Row; const value = (json(batch.rows) ?? []).find((candidate: Row) => Number(candidate.preview_row_id) === Number(parts[2])) as Row; const student = row(context, "SELECT * FROM student_masters WHERE id = ?", [studentMasterId ?? value.matched_student_master_id]);
  const existing: Row = { student_name: student?.full_name ?? null, nipd: student?.nipd ?? null, nisn: student?.nisn ?? null, nik: student?.nik ?? null }; const immutable = new Set(["nipd", "nisn", "nik"]); const fields = ["student_name", "nipd", "nisn", "nik", "academic_year", "jenjang", "class_name", "program"].map((field) => { const incoming = value.payload?.[field]; const current = existing[field]; let classification = "UNSUPPORTED"; let actions = ["LEAVE_UNRESOLVED"]; if (incoming === current && current != null) { classification = "SAME"; actions = ["KEEP_EXISTING"]; } else if (immutable.has(field) && current && incoming !== current) { classification = "IMMUTABLE_CONFLICT"; actions = ["KEEP_EXISTING", "LEAVE_UNRESOLVED"]; } else if (["jenjang", "class_name", "program"].includes(field) && ["MISSING_JENJANG", "MISSING_CLASS"].includes(value.classification)) { classification = "MISSING_REFERENCE"; actions = ["SELECT_REFERENCE", "LEAVE_UNRESOLVED"]; } else if (student && field === "student_name" && incoming !== current) { classification = "SENSITIVE_REVIEW"; actions = ["KEEP_EXISTING", "LEAVE_UNRESOLVED"]; } return { field, incoming_value: immutable.has(field) ? mask(incoming) : incoming, existing_value: immutable.has(field) ? mask(current) : current, classification, allowed_actions: actions, explanation: classification === "IMMUTABLE_CONFLICT" ? "Stable identifiers cannot be overwritten in conflict resolution." : "Review this field before choosing a resolution plan." }; });
  return { resolution_item_id: reference, source_filename: batch.filename, source_row: value.source_row, source_checksum_prefix: String(batch.checksum).slice(0, 12), student: student ? { id: student.id, full_name: student.full_name, record_version: recordVersion(student) } : null, fields, allowed_plans: student ? ["LINK_ROW_TO_EXISTING_STUDENT", "LEAVE_UNRESOLVED"] : ["LEAVE_UNRESOLVED"] };
}

function linkDevice(context: AuthContext, reference: string, body: Row, user: Row, set: any): Row {
  if (body.confirmation !== LINK_CONFIRMATION) return fail(set, 400, "CONFIRMATION_REQUIRED", "The device-link confirmation token is invalid.");
  if (!reference.startsWith("attendance:")) return fail(set, 409, "RESOLUTION_NOT_ELIGIBLE", "Only unmatched attendance devices can use this action.");
  const item = conflict(context, reference); const id = Number(reference.split(":")[1]); const value = row(context, "SELECT * FROM attendance_import_rows WHERE id = ?", [id]) as Row; const batch = row(context, "SELECT * FROM attendance_import_batches WHERE id = ?", [value.batch_id]) as Row;
  if (batch.checksum !== body.expected_source_checksum) return fail(set, 409, "SOURCE_CHECKSUM_MISMATCH", "The source checksum changed; refresh the conflict.");
  if (value.student_identifier !== body.expected_device_identifier || value.classification !== "CONFLICT" || technicalCode(value.validation_error) !== DEVICE_IDENTITY_UNMATCHED) return fail(set, 409, "RESOLUTION_ITEM_STALE", "The conflict changed; refresh the conflict.");
  const student = row(context, "SELECT * FROM student_masters WHERE id = ?", [body.student_master_id]); if (!student) return fail(set, 404, "TARGET_STUDENT_NOT_FOUND", "The selected student was not found.");
  if (student.student_status !== "active") return fail(set, 409, "TARGET_STUDENT_INACTIVE", "Only an active student can receive a device link.");
  if (recordVersion(student) !== body.expected_student_version) return fail(set, 409, "RESOLUTION_ITEM_STALE", "The selected student changed; search again.");
  if (normalizedName(student.full_name) !== normalizedName(value.student_name)) return fail(set, 409, "IDENTITY_CONFLICT", "The selected student's name does not match the source identity.");
  const existing = row(context, "SELECT * FROM student_device_identities WHERE device_source = 'attendance_machine' AND device_identifier = ? AND is_active = 1", [body.expected_device_identifier]);
  if (existing) return existing.student_master_id === student.id ? { outcome: "ALREADY_LINKED_TO_TARGET", resolution_item_id: reference, student_master_id: student.id } : fail(set, 409, "DEVICE_ALREADY_ASSIGNED", "This device ID is actively assigned to another student.");
  try {
    let mapping: Row | null = null;
    inTransaction(context.database.client, () => {
      const legacy = row(context, "SELECT * FROM students WHERE id = ?", [Number(body.expected_device_identifier)]);
      const legacyId = Number(body.expected_device_identifier);
      if (legacy && normalizedName(legacy.name) !== normalizedName(student.full_name)) throw new Error("legacy");
      if (!legacy) context.database.client.run("INSERT INTO students (id, name) VALUES (?, ?)", [legacyId, student.full_name]);
      const result = context.database.client.run("INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active, created_by) VALUES (?, ?, ?, 'attendance_machine', ?, 1, ?)", [student.id, legacyId, body.expected_device_identifier, sourceDate(value.attendance_date) ?? new Date().toISOString().slice(0, 10), user.username]);
      mapping = row(context, "SELECT * FROM student_device_identities WHERE id = ?", [Number(result.lastInsertRowid)]);
      context.database.client.run("INSERT INTO student_master_change_history (student_master_id, action, field_name, new_value, source, changed_by) VALUES (?, 'device_identity_added', 'device_identifier', ?, 'upload_conflict_resolution', ?)", [student.id, body.expected_device_identifier, user.username]);
      operationAudit(context, user, reference, "UPLOAD_CONFLICT_DEVICE_LINKED", batch.id, { student_master_id: student.id, source_row: value.source_row, source_checksum_prefix: String(batch.checksum).slice(0, 12), mapping_id: mapping?.id ?? Number(result.lastInsertRowid) }, "manage_device_identity");
    });
    return { outcome: "LINKED", resolution_item_id: reference, student_master_id: student.id };
  } catch (error) { return fail(set, 409, error instanceof Error && error.message === "legacy" ? "LEGACY_IDENTITY_CONFLICT" : "DEVICE_IDENTITY_CONFLICT", "The device mapping changed before resolution."); }
}

function resolveRoster(context: AuthContext, reference: string, body: Row, user: Row, set: any): Row {
  if (body.confirmation !== ROSTER_CONFIRMATION) return fail(set, 400, "CONFIRMATION_REQUIRED", "The roster-resolution confirmation token is invalid.");
  const item = conflict(context, reference); if (item.workflow_type !== "ROSTER") return fail(set, 409, "ROSTER_RESOLUTION_INVALID", "This item is not a roster conflict."); const parts = reference.split(":"); const batch = row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [parts[1]]) as Row; const value = (json(batch.rows) ?? []).find((candidate: Row) => Number(candidate.preview_row_id) === Number(parts[2])) as Row;
  if (batch.checksum !== body.expected_source_checksum) return fail(set, 409, "SOURCE_CHECKSUM_MISMATCH", "The source checksum changed; refresh the conflict.");
  const student = row(context, "SELECT * FROM student_masters WHERE id = ?", [body.student_master_id]); if (value.classification !== "POSSIBLE_DUPLICATE") return fail(set, 409, "ROSTER_RESOLUTION_INVALID", "Only ambiguous identity rows can be linked here."); if (!student) return fail(set, 404, "TARGET_STUDENT_NOT_FOUND", "The selected student was not found."); if (student.student_status !== "active") return fail(set, 409, "TARGET_STUDENT_INACTIVE", "Only an active student can be selected."); if (recordVersion(student) !== body.expected_student_version) return fail(set, 409, "RESOLUTION_ITEM_STALE", "The selected student changed; search again.");
  const comparison = rosterComparison(context, reference, student.id); if (comparison.fields.some((field: Row) => field.classification === "IMMUTABLE_CONFLICT")) return fail(set, 409, "IMMUTABLE_FIELD_CONFLICT", "Stable identifiers conflict with the selected student.");
  operationAudit(context, user, reference, "UPLOAD_CONFLICT_ROSTER_RESOLVED", batch.session_id, { student_master_id: student.id, resolution_plan: "LINK_ROW_TO_EXISTING_STUDENT", source_row: value.source_row, source_checksum_prefix: String(batch.checksum).slice(0, 12) }, "resolve_student_duplicates"); context.database.client.run("UPDATE operations_audit_events SET success = 1 WHERE entity_type = 'UPLOAD_CONFLICT' AND entity_reference = ? AND operation = 'UPLOAD_CONFLICT_ROSTER_RESOLVED' ORDER BY id DESC LIMIT 1", [reference]);
  return { outcome: "RESOLVED_PENDING_RETRY", resolution_item_id: reference, student_master_id: student.id };
}

function retryPreview(context: AuthContext, body: Row, user: Row, set: any): Row {
  const selected = [...new Set(body.resolution_item_ids as string[])]; if (!selected.length) return fail(set, 400, "RETRY_NOT_ELIGIBLE", "Select at least one unresolved row."); let batchId: string | null = null; const sourceRows: Row[] = [];
  for (const reference of selected) {
    if (!reference.startsWith("attendance:")) return fail(set, 409, "RETRY_NOT_ELIGIBLE", "Attendance and roster conflicts cannot be mixed in one retry."); const value = row(context, "SELECT * FROM attendance_import_rows WHERE id = ?", [Number(reference.split(":")[1])]); if (!value) return fail(set, 404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found."); const batch = row(context, "SELECT * FROM attendance_import_batches WHERE id = ?", [value.batch_id]) as Row; if (!batchId) batchId = batch.id; if (batch.id !== batchId || batch.id !== body.source_session_id) return fail(set, 409, "RETRY_SOURCE_STALE", "The selected rows no longer belong to this source session."); if (batch.checksum !== body.source_checksum) return fail(set, 409, "SOURCE_CHECKSUM_MISMATCH", "The retry checksum does not match the original source."); if (Number(value.selected_for_commit) || value.classification !== "CONFLICT" || !json(value.proposed_change)?._retry_source) return fail(set, 409, "RETRY_NOT_ELIGIBLE", "Only unresolved retry-safe conflict rows can be retried."); sourceRows.push(value);
  }
  const source: WorkbookRows = { totalRows: sourceRows.length, exactDuplicates: new Set(), divergentDuplicates: new Set(), invalidRows: [], rows: sourceRows.map((value) => { const retry = json(value.proposed_change)._retry_source; const secondsToClock = (seconds: number | null) => seconds == null ? null : `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}`; return { excelRow: Number(value.source_row), studentId: Number(value.student_identifier), studentIdentifier: String(value.student_identifier), studentName: String(value.student_name ?? ""), date: String(value.attendance_date), checkIn: retry.check_in ? String(retry.check_in).slice(0, 5) : null, checkOut: retry.check_out ? String(retry.check_out).slice(0, 5) : null, lateRaw: secondsToClock(retry.terlambat_seconds), lateSeconds: retry.terlambat_seconds == null ? null : Number(retry.terlambat_seconds), overtimeSeconds: retry.overtime_seconds == null ? null : Number(retry.overtime_seconds), exception: retry.exception ?? null, week: retry.week ?? null }; }) };
  const preview = createPreview(context, source, `Retry - ${row(context, "SELECT filename FROM attendance_import_batches WHERE id = ?", [batchId])?.filename ?? "attendance"}`, body.source_checksum, user.username); const previewRows = preview.rows ?? [];
  for (let index = 0; index < previewRows.length; index++) { const result = previewRows[index]; const outcome = COMMITTABLE.has(result.classification) ? "NOW_ELIGIBLE" : "STILL_UNMATCHED"; operationAudit(context, user, selected[index]!, outcome === "NOW_ELIGIBLE" ? "UPLOAD_CONFLICT_RETRY_PREVIEW" : "UPLOAD_CONFLICT_RETRY_STILL_BLOCKED", body.source_session_id, { retry_batch_id: preview.batch_id, retry_row_id: result.id, source_row: result.source_row, source_checksum_prefix: body.source_checksum.slice(0, 12), outcome }, "import_attendance"); }
  return { workflow_type: "ATTENDANCE", source_session_id: body.source_session_id, source_checksum: body.source_checksum, retry_batch_id: preview.batch_id, outcomes: previewRows.map((value: Row, index: number) => ({ resolution_item_id: selected[index], retry_row_id: value.id, source_row: value.source_row, classification: value.classification, outcome: COMMITTABLE.has(value.classification) ? "NOW_ELIGIBLE" : "STILL_UNMATCHED" })), summary: { NEW: preview.summary.new_rows, DIFFERENCE: preview.summary.update_rows, UNCHANGED: preview.summary.unchanged_rows, CONFLICT: preview.summary.conflicts, INVALID: preview.summary.invalid_rows } };
}

function retryCommit(context: AuthContext, body: Row, user: Row, set: any): Row {
  if (body.confirmation !== ATTENDANCE_CONFIRMATION) return fail(set, 400, "CONFIRMATION_REQUIRED", "The attendance commit confirmation token is invalid."); const retry = row(context, "SELECT * FROM attendance_import_batches WHERE id = ?", [body.retry_batch_id]); if (!retry || retry.checksum !== body.retry_checksum) return fail(set, 409, "RETRY_SOURCE_STALE", "The retry preview changed; run retry preview again."); const ids = [...new Set(body.selected_retry_row_ids as number[])]; const selected = ids.map((id) => row(context, "SELECT * FROM attendance_import_rows WHERE id = ? AND batch_id = ?", [id, body.retry_batch_id])).filter(Boolean) as Row[]; if (!ids.length || selected.length !== ids.length) return fail(set, 400, "RETRY_NOT_ELIGIBLE", "Select retry rows from this preview.");
  const originalBySource = new Map<number, string>(); for (const reference of [...new Set(body.resolution_item_ids as string[])]) { if (!reference.startsWith("attendance:")) return fail(set, 409, "RETRY_NOT_ELIGIBLE", "Only attendance conflicts can use attendance retry commit."); const original = row(context, "SELECT r.*, b.id AS source_batch_id, b.checksum AS source_checksum FROM attendance_import_rows r JOIN attendance_import_batches b ON b.id = r.batch_id WHERE r.id = ?", [Number(reference.split(":")[1])]); const latest = latestAudit(context, reference); if (!original || original.source_batch_id !== body.source_session_id || original.source_checksum !== body.source_checksum || latest?.operation !== "UPLOAD_CONFLICT_RETRY_PREVIEW" || auditMetadata(latest).retry_batch_id !== body.retry_batch_id) return fail(set, 409, "RESOLUTION_ITEM_STALE", "Retry preview provenance is stale."); originalBySource.set(Number(original.source_row), reference); }
  if (selected.some((value) => !originalBySource.has(Number(value.source_row)))) return fail(set, 409, "RETRY_SOURCE_STALE", "A selected retry row is not part of the original selection.");
  try { const result = commitPreview(context, body.retry_batch_id, ids, body.confirmation, body.retry_checksum, user.username); for (const value of selected) operationAudit(context, user, originalBySource.get(Number(value.source_row))!, "UPLOAD_CONFLICT_RETRY_COMMITTED", body.source_session_id, { retry_batch_id: body.retry_batch_id, retry_row_id: value.id, source_row: value.source_row, source_checksum_prefix: body.source_checksum.slice(0, 12), outcome: "COMMITTED" }, "import_attendance"); return { ...result, source_session_id: body.source_session_id, source_checksum_prefix: body.source_checksum.slice(0, 12), committed_resolution_item_ids: selected.map((value) => originalBySource.get(Number(value.source_row))) }; } catch { return fail(set, 409, "RETRY_COMMIT_FAILED", "The retry import could not be committed safely."); }
}

export function uploadConflictRoutes(app: any, context: AuthContext): any {
  app.get("/api/upload-conflicts", ({ query, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_attendance" }); if (!user) return { detail: "Insufficient permissions" }; return list(context, query); }, { query: t.Object({ workflow_type: t.Optional(t.String()), technical_code: t.Optional(t.String({ maxLength: 64 })), resolution_status: t.Optional(t.String()), source_session_id: t.Optional(t.String({ maxLength: 36 })), retry_eligible: t.Optional(t.Boolean()), created_from: t.Optional(t.String()), created_to: t.Optional(t.String()), page: t.Optional(t.String()), page_size: t.Optional(t.String()) }) });
  app.post("/api/upload-conflicts/retry-preview", ({ body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_attendance" }); if (!user) return { detail: "Insufficient permissions" }; return retryPreview(context, body, user, set); }, { body: t.Object({ source_session_id: t.String({ minLength: 1, maxLength: 36 }), source_checksum: t.String({ minLength: 64, maxLength: 64 }), resolution_item_ids: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 500 }), expected_classification: t.Literal("CONFLICT"), retry_mode: t.Literal("PREVIEW_ONLY") }) });
  app.post("/api/upload-conflicts/retry-commit", ({ body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_attendance" }); if (!user) return { detail: "Insufficient permissions" }; return retryCommit(context, body, user, set); }, { body: t.Object({ source_session_id: t.String({ minLength: 1, maxLength: 36 }), source_checksum: t.String({ minLength: 64, maxLength: 64 }), resolution_item_ids: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 500 }), retry_batch_id: t.String({ minLength: 1, maxLength: 36 }), retry_checksum: t.String({ minLength: 64, maxLength: 64 }), selected_retry_row_ids: t.Array(t.Number({ minimum: 1 }), { minItems: 1, maxItems: 500 }), confirmation: t.Literal(ATTENDANCE_CONFIRMATION) }) });
  app.get("/api/upload-conflicts/:resolution_item_id/student-candidates", ({ params, query, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "view_student" }); if (!user) return { detail: "Insufficient permissions" }; try { return { items: studentCandidates(context, params.resolution_item_id, query.query, Number(query.limit ?? 20)) }; } catch (error) { return fail(set, (error as any).status ?? 404, (error as any).code ?? "RESOLUTION_ITEM_NOT_FOUND", (error as any).message === "broad" ? "Enter at least two characters or a stable identifier." : "Resolution item was not found."); } }, { params: t.Object({ resolution_item_id: t.String({ minLength: 1 }) }), query: t.Object({ query: t.String({ minLength: 2, maxLength: 255 }), limit: t.Optional(t.String()) }) });
  app.get("/api/upload-conflicts/:resolution_item_id/roster-comparison", ({ params, query, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; try { return rosterComparison(context, params.resolution_item_id, query.student_master_id); } catch (error) { return fail(set, (error as any).status ?? 404, (error as any).code ?? "RESOLUTION_ITEM_NOT_FOUND", "The roster conflict could not be found."); } }, { params: t.Object({ resolution_item_id: t.String({ minLength: 1 }) }), query: t.Object({ student_master_id: t.Optional(t.String({ maxLength: 36 })) }) });
  app.post("/api/upload-conflicts/:resolution_item_id/link-device", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "manage_device_identity" }); if (!user) return { detail: "Insufficient permissions" }; try { return linkDevice(context, params.resolution_item_id, body, user, set); } catch { return fail(set, 404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found."); } }, { params: t.Object({ resolution_item_id: t.String({ minLength: 1 }) }), body: t.Object({ expected_source_checksum: t.String({ minLength: 64, maxLength: 64 }), expected_device_identifier: t.String({ minLength: 1, maxLength: 255 }), student_master_id: t.String({ minLength: 1, maxLength: 36 }), expected_student_version: t.String({ minLength: 64, maxLength: 64 }), confirmation: t.Literal(LINK_CONFIRMATION) }) });
  app.post("/api/upload-conflicts/:resolution_item_id/resolve-roster", ({ params, body, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "resolve_student_duplicates" }); if (!user) return { detail: "Insufficient permissions" }; try { return resolveRoster(context, params.resolution_item_id, body, user, set); } catch { return fail(set, 404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found."); } }, { params: t.Object({ resolution_item_id: t.String({ minLength: 1 }) }), body: t.Object({ expected_source_checksum: t.String({ minLength: 64, maxLength: 64 }), student_master_id: t.String({ minLength: 1, maxLength: 36 }), expected_student_version: t.String({ minLength: 64, maxLength: 64 }), resolution_plan: t.Literal("LINK_ROW_TO_EXISTING_STUDENT"), confirmation: t.Literal(ROSTER_CONFIRMATION) }) });
  app.get("/api/upload-conflicts/:resolution_item_id", ({ params, set, ...ctx }: Context) => { const user = actor(context, { set, ...ctx }, { capability: "import_attendance" }); if (!user) return { detail: "Insufficient permissions" }; try { return conflict(context, params.resolution_item_id); } catch { return fail(set, 404, "RESOLUTION_ITEM_NOT_FOUND", "Resolution item was not found."); } }, { params: t.Object({ resolution_item_id: t.String({ minLength: 1 }) }) });
  return app;
}
