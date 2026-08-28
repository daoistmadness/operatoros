import { createHash, randomUUID } from "node:crypto";
import { t } from "elysia";
import { inTransaction } from "@operatoros/db";
import { actor } from "../domains/core";
import { calculateLateMinutes, deriveAttendanceStatus, deriveJenjangFromClassName } from "./attendance-rules";
import type { AuthContext } from "../auth/service";
import { readAttendanceWorkbook, type AttendanceSourceRow, type WorkbookRows } from "../import/excel-reader";
import { parseStoredDuration, secondsToTimeText } from "../import/normalization";

type Row = Record<string, any>;
type Context = any;

export const ATTENDANCE_IMPORT_CONFIRMATION = "COMMIT_ATTENDANCE_IMPORT";
const COMMITTABLE = new Set(["NEW", "DIFFERENCE", "UNCHANGED"]);
const DEVICE_IDENTITY_UNMATCHED = "DEVICE_IDENTITY_UNMATCHED";

class ImportError extends Error {
  constructor(readonly status: number, readonly detail: string | Record<string, unknown>) { super(typeof detail === "string" ? detail : String(detail.message ?? "Import failed")); }
}

function rows(client: AuthContext["database"]["client"], query: string, params: any[] = []): Row[] { return client.query(query).all(...params) as Row[]; }
function row(client: AuthContext["database"]["client"], query: string, params: any[] = []): Row | null { return (client.query(query).get(...params) as Row | null) ?? null; }
function json(value: unknown): string | null { return value == null ? null : JSON.stringify(value); }
function parseJson(value: unknown): any { return value == null || value === "" ? null : typeof value === "string" ? JSON.parse(value) : value; }
function shortTime(value: unknown): string | null { const text = value == null ? null : String(value); return text ? text.slice(0, 5) : null; }
function fullTime(value: string | null): string | null { return value ? `${value.slice(0, 5)}:00` : null; }
function storageTime(value: string | null): string | null { return value ? `${value.slice(0, 5)}:00.000000` : null; }
function asBoolean(value: unknown): boolean { return value === true || value === 1 || value === "1"; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function equalJson(left: unknown, right: unknown): boolean { return JSON.stringify(stable(left)) === JSON.stringify(stable(right)); }
function cutoffs(context: AuthContext): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const item of rows(context.database.client, "SELECT jenjang, cutoff_time FROM jenjang_config")) {
    result[String(item.jenjang)] = item.cutoff_time == null ? undefined : String(item.cutoff_time);
    result[String(item.jenjang).toUpperCase()] = item.cutoff_time == null ? undefined : String(item.cutoff_time);
  }
  return result;
}
function resolveStudent(context: AuthContext, identifier: string): Row | null {
  return row(context.database.client, "SELECT s.*, d.id AS device_identity_id FROM student_device_identities d JOIN students s ON s.id = d.legacy_student_id WHERE d.device_identifier = ? AND d.is_active = 1 AND d.legacy_student_id IS NOT NULL ORDER BY d.id LIMIT 1", [identifier]);
}
function attendancePayload(value: Row | null): Row | null {
  if (!value) return null;
  return {
    check_in: fullTime(shortTime(value.check_in)),
    check_out: fullTime(shortTime(value.check_out)),
    late_duration: Number(value.late_duration ?? 0),
    late_source: value.late_source || "none",
    is_absent: asBoolean(value.is_absent),
    overtime_seconds: typeof value.overtime === "number" ? value.overtime : parseStoredDuration(value.overtime),
    exception: value.exception ?? null,
    week: value.week ?? null,
    status: value.status,
  };
}
function lateInput(entry: AttendanceSourceRow): unknown {
  return entry.lateRaw instanceof Date ? `${String(entry.lateRaw.getUTCHours()).padStart(2, "0")}:${String(entry.lateRaw.getUTCMinutes()).padStart(2, "0")}` : entry.lateRaw;
}
function proposedPayload(entry: AttendanceSourceRow, student: Row, existing: Row | null, cutoffMap: Record<string, string | undefined>): Row {
  const checkIn = entry.checkIn ?? shortTime(existing?.check_in);
  const checkOut = entry.checkOut ?? shortTime(existing?.check_out);
  const jenjang = student.jenjang || deriveJenjangFromClassName(student.class_name ?? null);
  const [lateDuration, lateSource] = calculateLateMinutes(checkIn, lateInput(entry), jenjang, cutoffMap);
  const status = deriveAttendanceStatus(checkIn, checkOut, lateDuration);
  return {
    check_in: fullTime(checkIn),
    check_out: fullTime(checkOut),
    late_duration: lateDuration,
    late_source: lateSource,
    is_absent: status === "absent",
    overtime_seconds: entry.overtimeSeconds,
    exception: entry.exception,
    week: entry.week,
    status,
  };
}
function retryPayload(entry: AttendanceSourceRow): Row {
  return {
    _retry_source: {
      check_in: fullTime(entry.checkIn),
      check_out: fullTime(entry.checkOut),
      terlambat_seconds: entry.lateSeconds,
      overtime_seconds: entry.overtimeSeconds,
      exception: entry.exception,
      week: entry.week,
    },
  };
}
function sourceKey(entry: AttendanceSourceRow): string { return `${entry.studentId}\u0000${entry.date}`; }
function duplicateWarning(exact: Set<string>, entry: AttendanceSourceRow): string | null { return exact.has(sourceKey(entry)) ? "Identical duplicate source key collapsed to one logical row" : null; }
function serializedRow(value: Row): Row {
  return {
    id: value.id,
    source_row: value.source_row,
    student_identifier: value.student_identifier,
    student: value.student_name,
    date: value.attendance_date ?? null,
    existing_record: parseJson(value.existing_record),
    proposed_record: parseJson(value.proposed_change),
    classification: value.classification,
    warning: value.warning ?? null,
    validation_error: value.validation_error ?? null,
  };
}
function previewPayload(batch: Row, importRows: Row[]): Row {
  return {
    batch_id: batch.id,
    filename: batch.filename,
    checksum: batch.checksum,
    status: batch.status,
    summary: {
      total_rows: batch.total_rows,
      logical_rows: batch.logical_rows,
      new_rows: batch.new_records,
      update_rows: batch.update_records,
      unchanged_rows: batch.unchanged_records,
      conflicts: batch.conflict_records,
      invalid_rows: batch.invalid_records,
      new_students: batch.new_students,
    },
    rows: importRows.map(serializedRow),
  };
}

export function createPreview(context: AuthContext, workbook: WorkbookRows, filename: string, checksum: string, username: string): Row {
  const client = context.database.client;
  const cutoffMap = cutoffs(context);
  const batchId = randomUUID();
  const counts = { NEW: 0, UNCHANGED: 0, DIFFERENCE: 0, CONFLICT: 0, INVALID: 0 };
  inTransaction(client, () => {
    client.run("INSERT INTO attendance_import_batches (id, filename, checksum, uploaded_by, total_rows, logical_rows, new_records, update_records, unchanged_records, conflict_records, invalid_records, new_students, status) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'preview')", [batchId, filename, checksum, username, workbook.totalRows, workbook.rows.length]);
    for (const entry of workbook.rows) {
      const student = resolveStudent(context, entry.studentIdentifier);
      const existing = student ? row(client, "SELECT * FROM attendance WHERE student_id = ? AND date = ?", [student.id, entry.date]) : null;
      let classification = "NEW";
      let validationError: string | null = null;
      const warning = duplicateWarning(workbook.exactDuplicates, entry);
      if (!student) {
        classification = "CONFLICT";
        validationError = `${DEVICE_IDENTITY_UNMATCHED}: no active attendance device identity is linked to ${entry.studentIdentifier}`;
      } else if (workbook.divergentDuplicates.has(sourceKey(entry))) {
        classification = "CONFLICT";
        validationError = "Divergent duplicate rows share the same student/date key";
      } else if (student.name !== entry.studentName) {
        classification = "CONFLICT";
        validationError = "Student identifier belongs to a different existing name";
      } else {
        const before = attendancePayload(existing);
        const proposed = proposedPayload(entry, student, existing, cutoffMap);
        classification = existing == null ? "NEW" : equalJson(before, proposed) ? "UNCHANGED" : "DIFFERENCE";
        const finalWarning = row(client, "SELECT id FROM attendance_overrides WHERE attendance_id = ?", [existing?.id]) ? [warning, "Administrative override exists and remains authoritative"].filter(Boolean).join("; ") : warning;
        counts[classification as keyof typeof counts]++;
        client.run("INSERT INTO attendance_import_rows (batch_id, source_row, student_identifier, student_name, attendance_date, existing_attendance_id, classification, existing_record, proposed_change, validation_error, warning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [batchId, entry.excelRow, entry.studentIdentifier, entry.studentName, entry.date, existing?.id ?? null, classification, json(before), json(proposed), null, finalWarning]);
        continue;
      }
      counts[classification as keyof typeof counts]++;
      client.run("INSERT INTO attendance_import_rows (batch_id, source_row, student_identifier, student_name, attendance_date, existing_attendance_id, classification, existing_record, proposed_change, validation_error, warning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [batchId, entry.excelRow, entry.studentIdentifier, entry.studentName, entry.date, existing?.id ?? null, classification, json(attendancePayload(existing)), json(retryPayload(entry)), validationError, warning]);
    }
    for (const invalid of workbook.invalidRows) {
      counts.INVALID++;
      client.run("INSERT INTO attendance_import_rows (batch_id, source_row, student_identifier, student_name, attendance_date, classification, validation_error) VALUES (?, ?, ?, ?, ?, 'INVALID', ?)", [batchId, invalid.excelRow, invalid.noId, invalid.name, invalid.date, invalid.reason]);
    }
    client.run("UPDATE attendance_import_batches SET new_records = ?, update_records = ?, unchanged_records = ?, conflict_records = ?, invalid_records = ? WHERE id = ?", [counts.NEW, counts.DIFFERENCE, counts.UNCHANGED, counts.CONFLICT, counts.INVALID, batchId]);
  });
  const batch = row(client, "SELECT * FROM attendance_import_batches WHERE id = ?", [batchId]) as Row;
  const importRows = rows(client, "SELECT * FROM attendance_import_rows WHERE batch_id = ? ORDER BY id", [batchId]);
  return previewPayload(batch, importRows);
}

export function commitPreview(context: AuthContext, batchId: string, selectedIds: number[], confirmation: string, checksum: string, username: string): Row {
  if (confirmation !== ATTENDANCE_IMPORT_CONFIRMATION) throw new ImportError(400, "Invalid confirmation token");
  const client = context.database.client;
  const batch = row(client, "SELECT * FROM attendance_import_batches WHERE id = ?", [batchId]);
  if (!batch) throw new ImportError(404, "Attendance import preview not found");
  if (batch.status === "committed") return parseJson(batch.commit_result) ?? { status: "committed", idempotent: true };
  if (batch.status !== "preview") throw new ImportError(409, "Attendance import preview is not committable");
  if (checksum !== batch.checksum) throw new ImportError(409, { code: "ATTENDANCE_PREVIEW_SOURCE_MISMATCH", message: "The attendance preview no longer matches the source workbook." });
  const uniqueIds = [...new Set(selectedIds)];
  if (!uniqueIds.length) throw new ImportError(400, "Selected rows are not part of this preview");
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const importRows = rows(client, `SELECT * FROM attendance_import_rows WHERE batch_id = ? AND id IN (${placeholders}) ORDER BY id`, [batchId, ...uniqueIds]);
  if (importRows.length !== uniqueIds.length) throw new ImportError(400, "Selected rows are not part of this preview");
  const blocked = importRows.filter((value) => !COMMITTABLE.has(String(value.classification))).map((value) => value.id);
  if (blocked.length) throw new ImportError(409, { code: "UNRESOLVED_IMPORT_ROWS", message: "Selected attendance import rows require identity resolution.", row_ids: blocked });
  let inserted = 0; let updated = 0; let unchanged = 0; let lateEntries = 0; let incompleteEntries = 0;
  try {
    inTransaction(client, () => {
      client.run("UPDATE attendance_import_batches SET status = 'committing' WHERE id = ?", [batchId]);
      for (const importRow of importRows) {
        const student = resolveStudent(context, String(importRow.student_identifier));
        if (!student) throw new ImportError(409, { code: DEVICE_IDENTITY_UNMATCHED, message: `Attendance device identity is unresolved at preview row ${importRow.id}` });
        if (student.name !== importRow.student_name) throw new ImportError(409, `Student changed after preview row ${importRow.id}`);
        const existing = row(client, "SELECT * FROM attendance WHERE student_id = ? AND date = ?", [student.id, importRow.attendance_date]);
        if (row(client, "SELECT id FROM attendance_periods WHERE attendance_date = ? AND status = 'FINALIZED'", [importRow.attendance_date])) throw new ImportError(409, { code: "ATTENDANCE_PERIOD_FINALIZED", message: "Attendance period is finalized and must be reopened." });
        if (!equalJson(attendancePayload(existing), parseJson(importRow.existing_record))) throw new ImportError(409, `Attendance changed after preview row ${importRow.id}`);
        const proposed = parseJson(importRow.proposed_change) as Row;
        const status = String(proposed.status);
        if (importRow.classification === "NEW") {
          client.run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, overtime, exception, week, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [student.id, importRow.attendance_date, storageTime(proposed.check_in), storageTime(proposed.check_out), proposed.late_duration, proposed.late_source, proposed.is_absent ? 1 : 0, secondsToTimeText(proposed.overtime_seconds), proposed.exception, proposed.week, status]);
          inserted++;
        } else if (importRow.classification === "DIFFERENCE") {
          client.run("UPDATE attendance SET check_in = ?, check_out = ?, late_duration = ?, late_source = ?, is_absent = ?, overtime = ?, exception = ?, week = ?, status = ? WHERE id = ?", [storageTime(proposed.check_in), storageTime(proposed.check_out), proposed.late_duration, proposed.late_source, proposed.is_absent ? 1 : 0, secondsToTimeText(proposed.overtime_seconds), proposed.exception, proposed.week, status, existing?.id]);
          updated++;
        } else unchanged++;
        client.run("UPDATE attendance_import_rows SET selected_for_commit = 1 WHERE id = ?", [importRow.id]);
        lateEntries += status === "late" ? 1 : 0;
        incompleteEntries += status === "incomplete" ? 1 : 0;
      }
      const result = { status: "committed", batch_id: batchId, rows_inserted: inserted, rows_updated: updated, rows_unchanged: unchanged, new_students: 0 };
      client.run("INSERT INTO upload_logs (filename, uploaded_by, uploaded_at, total_records, new_students, late_entries, incomplete_entries, failed_rows, skipped_empty, status) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 0, ?, ?, 0, 0, 'success')", [batch.filename, username, importRows.length, lateEntries, incompleteEntries]);
      client.run("UPDATE attendance_import_batches SET status = 'committed', committed_at = CURRENT_TIMESTAMP, commit_result = ? WHERE id = ?", [JSON.stringify(result), batchId]);
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(409, "Attendance import could not be committed. Operation rolled back.");
  }
  return parseJson(row(client, "SELECT commit_result FROM attendance_import_batches WHERE id = ?", [batchId])?.commit_result) as Row;
}

function validFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

export function attendanceImportRoutes(app: any, context: AuthContext): void {
  app.post("/api/uploads/preview", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "import_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    const file = ctx.body?.file as File | undefined;
    if (!file || !validFile(file)) { ctx.set.status = 400; return { detail: `Invalid file type '${file?.type ?? "unknown"}'. Please upload a .xlsx or .xls file.` }; }
    try {
      const buffer = await file.arrayBuffer();
      const checksum = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
      return createPreview(context, await readAttendanceWorkbook(buffer, file.name), file.name, checksum, user.username);
    } catch (error) {
      ctx.set.status = 400;
      return { detail: error instanceof Error ? error.message : "The server could not preview the workbook." };
    }
  }, { body: t.Object({ file: t.File() }) });

  app.post("/api/uploads/preview/:batch_id/commit", (ctx: Context) => {
    const user = actor(context, ctx, { capability: "import_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    try {
      return commitPreview(context, ctx.params.batch_id, ctx.body.selected_row_ids, ctx.body.confirmation, ctx.body.preview_checksum, user.username);
    } catch (error) {
      if (error instanceof ImportError) { ctx.set.status = error.status; return { detail: error.detail }; }
      ctx.set.status = 409;
      return { detail: "Attendance import could not be committed. Operation rolled back." };
    }
  }, { params: t.Object({ batch_id: t.String({ minLength: 36, maxLength: 36 }) }), body: t.Object({ selected_row_ids: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }), confirmation: t.String(), preview_checksum: t.String({ minLength: 64, maxLength: 64 }) }) });
}
