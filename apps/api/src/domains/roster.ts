import ExcelJS from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";
import { inTransaction } from "@operatoros/db";
import { normalizeHeader, parseExcelDate, parseOptionalString } from "../import/normalization";

type Row = Record<string, any>;
type Context = any;
const required = ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"];
const optional = ["student_master_id", "nipd", "nisn", "nik", "birth_date", "homeroom_teacher", "admission_type", "start_date"];
const classifications = ["CREATE", "UPDATE", "MATCH_EXISTING", "CONFLICT", "INVALID"];

function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function error(set: any, status: number, detail: string): { detail: string } { set.status = status; return { detail }; }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value); }
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function classify(errors: string[], existing: Row | null, matches: boolean): string { return errors.length ? "INVALID" : existing === null ? "CREATE" : matches ? "MATCH_EXISTING" : "UPDATE"; }

const rosterRequired = new Set(required);
const rosterOptional = new Set(optional);

function rosterDate(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const candidate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (candidate.getUTCFullYear() === Number(match[1]) && candidate.getUTCMonth() === Number(match[2]) - 1 && candidate.getUTCDate() === Number(match[3])) return value.trim();
      return null;
    }
  }
  return parseExcelDate(value);
}

function rosterCell(value: unknown): unknown {
  return value && typeof value === "object" && "result" in (value as Row) ? (value as Row).result : value;
}

function rosterName(value: unknown): string { return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase(); }

function rosterRows(workbook: ExcelJS.Workbook): Row[] {
  const result: Row[] = [];
  for (const sheet of workbook.worksheets) {
    const headerValues = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => normalizeHeader(value).toLowerCase().replace(/ /g, "_"));
    const missing = [...rosterRequired].filter((name) => !headerValues.includes(name));
    if (missing.length) throw new Error(`Sheet '${sheet.name}' missing required columns: ${missing.sort().join(", ")}`);
    if (sheet.rowCount - 1 > 10000) throw new Error("Academic roster exceeds the 10,000-row limit");
    const columns = [...rosterRequired, ...rosterOptional];
    for (let number = 2; number <= sheet.rowCount; number++) {
      const values = sheet.getRow(number).values as unknown[];
      if (values.slice(1).every((value) => value == null || String(rosterCell(value)).trim() === "")) continue;
      const payload: Row = {};
      for (const name of columns) {
        const index = headerValues.indexOf(name);
        payload[name] = index < 0 ? null : parseOptionalString(rosterCell(values[index + 1]));
      }
      payload.birth_date = rosterDate(rosterCell(values[headerValues.indexOf("birth_date") + 1]));
      payload.start_date = rosterDate(rosterCell(values[headerValues.indexOf("start_date") + 1]));
      result.push({ source_sheet: sheet.name, source_row: number, payload });
    }
  }
  return result;
}

function rosterMaster(context: AuthContext, payload: Row): { master: Row | null; rule: string | null } {
  if (payload.student_master_id) return { master: row(context, "SELECT * FROM student_masters WHERE id = ?", [payload.student_master_id]), rule: row(context, "SELECT id FROM student_masters WHERE id = ?", [payload.student_master_id]) ? "student_master_id" : null };
  for (const field of ["nipd", "nisn", "nik"]) {
    if (!payload[field]) continue;
    const matches = rows(context, `SELECT * FROM student_masters WHERE ${field} = ?`, [payload[field]]);
    if (matches.length === 1) return { master: matches[0]!, rule: field };
    if (matches.length > 1) return { master: null, rule: "ambiguous_identifier" };
  }
  if (payload.student_identifier) {
    const matches = rows(context, "SELECT m.* FROM student_device_identities d JOIN student_masters m ON m.id = d.student_master_id WHERE d.device_identifier = ? AND d.is_active = 1", [payload.student_identifier]);
    if (matches.length === 1) return { master: matches[0]!, rule: "approved_device_identity" };
    if (matches.length > 1) return { master: null, rule: "ambiguous_device_identity" };
  }
  if (payload.birth_date) {
    const matches = rows(context, "SELECT * FROM student_masters WHERE normalized_name = ? AND birth_date = ?", [rosterName(payload.student_name), payload.birth_date]);
    if (matches.length === 1) return { master: matches[0]!, rule: "normalized_name_birth_date" };
    if (matches.length > 1) return { master: null, rule: "ambiguous_name_birth_date" };
  }
  return { master: null, rule: null };
}

function rosterPreview(context: AuthContext, file: File, owner: string, dateReceived: string, username: string): Promise<Row> {
  return file.arrayBuffer().then(async (buffer) => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    const source = rosterRows(workbook); const result: Row[] = []; const seen = new Set<string>();
    const activeJenjangs = new Map(rows(context, "SELECT * FROM jenjangs WHERE active = 1").map((value) => [value.name, value]));
    for (const sourceRow of source) {
      const payload = sourceRow.payload; const errors: string[] = []; let classification = "INVALID"; let master: Row | null = null; let matchRule: string | null = null;
      if (!payload.student_name || !payload.student_identifier) errors.push("Student identifier and name are required");
      else {
        ({ master, rule: matchRule } = rosterMaster(context, payload));
        const year = row(context, "SELECT * FROM academic_years WHERE label = ?", [payload.academic_year]); const jenjang = activeJenjangs.get(payload.jenjang);
        const program = jenjang ? row(context, "SELECT * FROM academic_programs WHERE jenjang_id = ? AND name = ? AND active = 1", [jenjang.id, payload.program]) : null;
        const academicClass = year && jenjang && program ? row(context, "SELECT c.id, c.class_name FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.academic_year_id = ? AND c.class_name = ? AND c.active = 1 AND g.jenjang_id = ? AND g.program_id = ? AND g.active = 1", [year.id, payload.class_name, jenjang.id, program.id]) : null;
        if (matchRule?.startsWith("ambiguous")) { classification = "POSSIBLE_DUPLICATE"; errors.push("Identity match is ambiguous"); }
        else if (!year) { classification = "INVALID"; errors.push("Unknown academic year"); }
        else if (!jenjang) { classification = "MISSING_JENJANG"; errors.push("Unknown canonical jenjang"); }
        else if (!program || !academicClass) { classification = "MISSING_CLASS"; errors.push("Program/class is not active approved master data"); }
        else if (String(payload.status ?? "").toLowerCase() !== "active") { classification = "INVALID"; errors.push("Only active roster rows are committable"); }
        else if (!master && !/^\d+$/.test(String(payload.student_identifier))) { classification = "INVALID"; errors.push("New students require a numeric attendance device ID"); }
        else {
          const key = `${master?.id ?? `new:${payload.student_identifier}`}\u0000${year.id}`; const existing = master ? row(context, "SELECT id FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ?", [master.id, year.id]) : null;
          if (existing || seen.has(key)) { classification = "INVALID"; errors.push("Duplicate enrollment for academic year"); }
          else { classification = master ? "CREATE_ENROLLMENT" : "CREATE_NEW_MASTER"; seen.add(key); Object.assign(payload, { academic_year_id: Number(year.id), academic_year_start: year.start_date, jenjang_id: Number(jenjang.id), academic_class_id: Number(academicClass.id), target_class: academicClass.class_name }); }
        }
      }
      result.push({ preview_row_id: result.length + 1, source_sheet: sourceRow.source_sheet, source_row: sourceRow.source_row, classification, matched_student_master_id: master?.id ?? null, match_rule: matchRule, payload, errors });
    }
    const summary: Row = { total: result.length }; for (const name of ["CREATE_ENROLLMENT", "CREATE_NEW_MASTER", "POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS", "INVALID"]) summary[name.toLowerCase()] = result.filter((value) => value.classification === name).length;
    const sessionId = randomUUID(); const batchId = randomUUID(); const checksum = createHash("sha256").update(Buffer.from(buffer)).digest("hex"); const previewChecksum = digest(result); const client = context.database.client;
    inTransaction(client, () => {
      client.run("INSERT INTO student_import_sessions (id, session_uuid, import_type, status, provenance_status, created_by, expires_at, source_filename, source_file_checksum, preview_checksum, row_count, selected_row_count, applied_action_count, rollback_state, metadata, schema_version) VALUES (?, ?, 'STUDENT_ROSTER', 'PREVIEW_READY', 'PROVENANCE_FAILED', ?, datetime('now', '+24 hours'), ?, ?, ?, ?, 0, 0, 'NOT_AVAILABLE', '{}', '1')", [sessionId, sessionId, username, file.name, checksum, previewChecksum, result.length]);
      client.run("INSERT INTO academic_roster_import_batches (id, session_id, filename, checksum, source_owner, date_received, created_by, status, rows, summary) VALUES (?, ?, ?, ?, ?, ?, ?, 'preview', ?, ?)", [batchId, sessionId, file.name, checksum, owner, dateReceived, username, JSON.stringify(result), JSON.stringify(summary)]);
    });
    return { preview_id: batchId, session_id: sessionId, checksum, status: "preview", preview_checksum: previewChecksum, summary, rows: result };
  });
}

function appendRosterAction(context: AuthContext, session: Row, batchId: string, sourceRow: number, sequence: number, type: string, entityType: string, entityId: string, before: Row | null, after: Row, compensation: string, user: string): number {
  const beforeJson = before ? JSON.stringify(before) : null; const afterJson = JSON.stringify(after); const operationId = digest(`${session.session_uuid}:${sourceRow}:${sequence}:${type}:${session.preview_checksum}`); const result = context.database.client.run("INSERT INTO student_import_applied_actions (session_id, academic_roster_import_batch_id, source_row_number, action_sequence, action_type, entity_type, entity_id, entity_reference, operation_id, applied_by, before_state, after_state, before_state_checksum, after_state_checksum, dependency_checkpoint, compensation_type, rollback_eligibility, rollback_state, metadata, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ELIGIBLE', 'NOT_REQUESTED', '{}', '1')", [session.id, batchId, sourceRow, sequence, type, entityType, entityId, digest(`${entityType}:${entityId}`).slice(0, 32), operationId, user, beforeJson, afterJson, before ? digest(before) : null, digest(after), afterJson, compensation]); return Number(result.lastInsertRowid);
}

function rosterCommit(context: AuthContext, body: Row, username: string): Row {
  if (body.confirmation !== "COMMIT_ACADEMIC_ROSTER") throw Object.assign(new Error("Invalid confirmation token"), { status: 400 });
  const batch = row(context, "SELECT * FROM academic_roster_import_batches WHERE id = ?", [body.preview_id]); if (!batch) throw Object.assign(new Error("Roster preview not found"), { status: 404 });
  if (batch.status === "committed") return JSON.parse(String(batch.commit_result));
  if (batch.created_at) { const createdAt = Date.parse(`${String(batch.created_at).replace(" ", "T")}Z`); if (Number.isFinite(createdAt) && Date.now() - createdAt > 24 * 60 * 60 * 1000) throw Object.assign(new Error("Roster preview expired; upload the workbook again"), { status: 410 }); }
  const session = row(context, "SELECT * FROM student_import_sessions WHERE id = ?", [batch.session_id]); if (!session || session.import_type !== "STUDENT_ROSTER" || session.created_by !== username) throw Object.assign(new Error("Import session ownership is invalid"), { status: 409 });
  const batchRows = JSON.parse(String(batch.rows)) as Row[]; const checksum = digest(batchRows); if (checksum !== String(session.preview_checksum ?? "") || body.preview_checksum && body.preview_checksum !== checksum) throw Object.assign(new Error("Roster preview checksum changed"), { status: 409 });
  const selectedIds = [...new Set((body.selected_row_ids ?? []).map(Number))]; const selected = batchRows.filter((value) => selectedIds.includes(Number(value.preview_row_id))); if (!selected.length || selected.length !== selectedIds.length) throw Object.assign(new Error("Selected rows are not part of the preview"), { status: 400 });
  const blocked = selected.filter((value) => !["CREATE_ENROLLMENT", "CREATE_NEW_MASTER"].includes(value.classification)).map((value) => value.preview_row_id); if (blocked.length) throw Object.assign(new Error(`Selected rows are not committable: ${blocked.join(", ")}`), { status: 409 });
  let created = 0; let studentsCreated = 0; let sequence = 0;
  inTransaction(context.database.client, () => {
    for (const item of selected) {
      const payload = item.payload; let master = item.matched_student_master_id ? row(context, "SELECT * FROM student_masters WHERE id = ?", [item.matched_student_master_id]) : null; if (!master && item.classification === "CREATE_NEW_MASTER") {
        for (const field of ["nipd", "nisn", "nik"]) if (payload[field] && row(context, `SELECT id FROM student_masters WHERE ${field} = ?`, [payload[field]])) throw Object.assign(new Error(`DUPLICATE_${field.toUpperCase()}`), { status: 409 });
        const masterId = randomUUID(); context.database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, nipd, nisn, nik, birth_date, admission_type, student_status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)", [masterId, payload.student_name, rosterName(payload.student_name), payload.nipd, payload.nisn, payload.nik, payload.birth_date, payload.admission_type, username, username]); master = row(context, "SELECT * FROM student_masters WHERE id = ?", [masterId]); const legacyId = Number(payload.student_identifier); const oldLegacy = row(context, "SELECT id, name FROM students WHERE id = ?", [legacyId]); if (oldLegacy && rosterName(oldLegacy.name) !== rosterName(payload.student_name)) throw Object.assign(new Error("LEGACY_IDENTITY_CONFLICT"), { status: 409 }); if (!oldLegacy) context.database.client.run("INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, NULL, NULL)", [legacyId, payload.student_name]); context.database.client.run("INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active, created_by) VALUES (?, ?, ?, 'attendance_machine', ?, 1, ?)", [masterId, legacyId, payload.student_identifier, payload.start_date ?? payload.academic_year_start, username]); sequence++; appendRosterAction(context, session, batch.id, item.source_row, sequence, "CREATE_STUDENT_MASTER", "STUDENT_MASTER", masterId, null, { student_master_id: masterId, status: "active" }, "DEACTIVATE_CREATED_MASTER", username); sequence++; appendRosterAction(context, session, batch.id, item.source_row, sequence, "ADD_DEVICE_IDENTITY", "DEVICE_IDENTITY", String(row(context, "SELECT id FROM student_device_identities WHERE student_master_id = ? ORDER BY id DESC LIMIT 1", [masterId])?.id), null, { student_master_id: masterId, device_identifier: payload.student_identifier }, "RETIRE_DEVICE_MAPPING", username); studentsCreated++;
      }
      if (!master) throw new Error("Student master not found"); const existing = row(context, "SELECT id FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ?", [master.id, payload.academic_year_id]); if (existing) throw Object.assign(new Error(`Enrollment changed after preview row ${item.source_row}`), { status: 409 }); const enrollmentId = Number(context.database.client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state, lifecycle_effective_date, lifecycle_reason_code) VALUES ((SELECT legacy_student_id FROM student_device_identities WHERE student_master_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1), ?, ?, ?, ?, ?, 1, ?, 'ACTIVE', ?, 'ENROLLMENT_CREATED')", [master.id, master.id, payload.academic_year_id, payload.jenjang_id, payload.academic_class_id, payload.target_class, payload.start_date ?? payload.academic_year_start, payload.start_date ?? payload.academic_year_start]).lastInsertRowid); context.database.client.run("INSERT INTO student_enrollment_class_history (enrollment_id, class_name, effective_from, changed_by, source) VALUES (?, ?, ?, ?, 'academic_roster_import')", [enrollmentId, payload.target_class, payload.start_date ?? payload.academic_year_start, username]); sequence++; appendRosterAction(context, session, batch.id, item.source_row, sequence, "CREATE_ENROLLMENT", "STUDENT_ENROLLMENT", String(enrollmentId), null, { enrollment_id: enrollmentId, academic_class_id: payload.academic_class_id }, "END_ENROLLMENT", username); created++;
    }
    const result = { status: "committed", preview_id: batch.id, created, students_created: studentsCreated }; context.database.client.run("UPDATE academic_roster_import_batches SET status = 'committed', committed_by = ?, committed_at = CURRENT_TIMESTAMP, commit_result = ? WHERE id = ?", [username, JSON.stringify(result), batch.id]); context.database.client.run("UPDATE student_import_sessions SET status = 'COMMITTED', provenance_status = 'COMPLETE_ACTION_PROVENANCE', rollback_state = 'AVAILABLE', committed_at = CURRENT_TIMESTAMP, committed_by = ?, selected_row_count = ?, applied_action_count = ?, commit_checksum = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [username, selected.length, sequence, digest({ preview: session.preview_checksum, selected: selected.length, actions: sequence }), session.id]);
  });
  return JSON.parse(String(row(context, "SELECT commit_result FROM academic_roster_import_batches WHERE id = ?", [batch.id])?.commit_result));
}

function academicMasterPreview(context: AuthContext, body: Row, username: string): Row {
  const result: Row[] = [];
  const proposedYears = new Map((body.academic_years ?? []).map((value: Row) => [value.name, value]));
  for (let index = 0; index < (body.academic_years ?? []).length; index++) {
    const value = body.academic_years[index]; const errors: string[] = []; if (!value.start_date || !value.end_date) errors.push("start_date and end_date are required"); else if (value.end_date < value.start_date) errors.push("end_date must be on or after start_date");
    const existing = row(context, "SELECT * FROM academic_years WHERE label = ?", [value.name]); const matches = Boolean(existing && existing.start_date === value.start_date && existing.end_date === value.end_date && existing.status === (value.is_active ? "active" : "upcoming") && Boolean(existing.is_default) === Boolean(value.is_default));
    result.push({ type: "academic_year", row: index + 1, classification: classify(errors, existing, matches), payload: value, errors });
  }
  const existingJenjangs = rows(context, "SELECT * FROM jenjangs"); const byCode = new Map(existingJenjangs.filter((value) => value.code).map((value) => [value.code, value])); const byName = new Map<string, Row[]>(); for (const value of existingJenjangs) byName.set(value.name, [...(byName.get(value.name) ?? []), value]); const proposedCodes = new Set<string>();
  for (let index = 0; index < (body.jenjangs ?? []).length; index++) {
    const value = body.jenjangs[index]; const errors: string[] = []; if (proposedCodes.has(value.code)) errors.push("duplicate proposed jenjang code"); proposedCodes.add(value.code); let existing = byCode.get(value.code) ?? null; const named = byName.get(value.name) ?? []; if (!existing && named.length === 1) existing = named[0] ?? null; if (named.length > 1) errors.push("ambiguous existing jenjang name");
    const matches = Boolean(existing && existing.code === value.code && existing.name === value.name && existing.level === value.level && Boolean(existing.active) === Boolean(value.active)); result.push({ type: "jenjang", row: index + 1, classification: classify(errors, existing, matches), payload: value, existing_id: existing?.id ?? null, errors });
  }
  const knownCodes = new Set([...byCode.keys(), ...(body.jenjangs ?? []).map((value: Row) => value.code)]); const proposedPrograms = new Set<string>();
  for (let index = 0; index < (body.programs ?? []).length; index++) {
    const value = body.programs[index]; const key = `${value.jenjang_code}\u0000${value.name}`; const errors: string[] = []; if (!knownCodes.has(value.jenjang_code)) errors.push("unknown jenjang_code"); if (proposedPrograms.has(key)) errors.push("duplicate proposed program"); proposedPrograms.add(key); const jenjang = byCode.get(value.jenjang_code); const existing = (jenjang ? row(context, "SELECT * FROM academic_programs WHERE jenjang_id = ? AND name = ?", [jenjang.id, value.name]) : null) ?? null; result.push({ type: "program", row: index + 1, classification: classify(errors, existing, Boolean(existing && Boolean(existing.active) === Boolean(value.active))), payload: value, errors });
  }
  const proposedGrades = new Set<string>();
  for (let index = 0; index < (body.grades ?? []).length; index++) {
    const value = body.grades[index]; const key = `${value.jenjang_code}\u0000${value.program}\u0000${value.name}`; const errors: string[] = []; if (!proposedPrograms.has(`${value.jenjang_code}\u0000${value.program}`)) errors.push("program is not defined in this preview"); if (proposedGrades.has(key)) errors.push("duplicate proposed grade"); proposedGrades.add(key); result.push({ type: "grade", row: index + 1, classification: errors.length ? "INVALID" : "CREATE", payload: value, errors });
  }
  const classKeys = new Set<string>();
  for (let index = 0; index < (body.classes ?? []).length; index++) {
    const value = body.classes[index]; const errors: string[] = []; const gradeKey = `${value.jenjang_code}\u0000${value.program}\u0000${value.grade}`; if (!proposedYears.has(value.academic_year) && !row(context, "SELECT id FROM academic_years WHERE label = ?", [value.academic_year])) errors.push("unknown academic year"); if (!proposedGrades.has(gradeKey)) errors.push("grade is not defined in this preview"); const key = `${value.academic_year}\u0000${value.grade}\u0000${value.class_name}`; if (classKeys.has(key)) errors.push("duplicate class within academic year and grade"); classKeys.add(key); result.push({ type: "class", row: index + 1, classification: errors.length ? "INVALID" : "CREATE", payload: value, errors });
  }
  const summary: Row = { total: result.length }; for (const value of classifications) summary[value.toLowerCase()] = result.filter((item) => item.classification === value).length;
  return { preview_id: digest(body), status: "review_required", source_owner: String(body.source_owner).trim(), created_by: username, summary, rows: result };
}

export function rosterRoutes(app: any, context: AuthContext): any {
  const year = t.Object({ name: t.String({ minLength: 1, maxLength: 32 }), start_date: t.Optional(t.Nullable(t.String())), end_date: t.Optional(t.Nullable(t.String())), is_active: t.Optional(t.Boolean()), is_default: t.Optional(t.Boolean()) });
  const jenjang = t.Object({ code: t.String({ minLength: 1, maxLength: 32 }), name: t.String({ minLength: 1, maxLength: 255 }), level: t.String({ minLength: 1, maxLength: 64 }), active: t.Optional(t.Boolean()) });
  const program = t.Object({ jenjang_code: t.String({ minLength: 1, maxLength: 32 }), name: t.String({ minLength: 1, maxLength: 255 }), active: t.Optional(t.Boolean()) });
  const grade = t.Object({ jenjang_code: t.String({ minLength: 1, maxLength: 32 }), program: t.String({ minLength: 1, maxLength: 255 }), name: t.String({ minLength: 1, maxLength: 255 }), sequence_number: t.Number({ minimum: 1 }), active: t.Optional(t.Boolean()) });
  const academicClass = t.Object({ academic_year: t.String({ minLength: 1, maxLength: 32 }), jenjang_code: t.String({ minLength: 1, maxLength: 32 }), program: t.String({ minLength: 1, maxLength: 255 }), grade: t.String({ minLength: 1, maxLength: 255 }), class_name: t.String({ minLength: 1, maxLength: 255 }), section_code: t.Optional(t.String()), active: t.Optional(t.Boolean()) });
  app.post("/api/student-enrollments/academic-master-preview", (ctx: Context) => { const user = actor(context, ctx, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; return academicMasterPreview(context, ctx.body, user.username); }, { body: t.Object({ source_owner: t.String({ minLength: 2, maxLength: 255 }), academic_years: t.Optional(t.Array(year)), jenjangs: t.Optional(t.Array(jenjang)), programs: t.Optional(t.Array(program)), grades: t.Optional(t.Array(grade)), classes: t.Optional(t.Array(academicClass)) }) });
  app.post("/api/student-enrollments/roster-preview", async (ctx: Context) => { const user = actor(context, ctx, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; const file = ctx.body?.file as File | undefined; const dateReceived = String(ctx.body?.date_received ?? ""); if (!file || !file.name.toLowerCase().endsWith(".xlsx")) return error(ctx.set, 400, "Academic roster must be an .xlsx workbook"); if (!rosterDate(dateReceived)) return error(ctx.set, 422, "Input should be a valid date"); try { return await rosterPreview(context, file, String(ctx.body.source_owner).trim(), dateReceived, user.username); } catch (cause) { ctx.set.status = 400; return { detail: cause instanceof Error ? cause.message : "The roster workbook could not be previewed." }; } }, { body: t.Object({ file: t.File(), source_owner: t.String({ minLength: 2, maxLength: 255 }), date_received: t.String() }) });
  app.post("/api/student-enrollments/roster-commit", (ctx: Context) => { const user = actor(context, ctx, { capability: "commit_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; try { return rosterCommit(context, ctx.body, user.username); } catch (cause) { ctx.set.status = Number((cause as any)?.status ?? 409); return { detail: cause instanceof Error ? cause.message : "The roster could not be committed." }; } }, { body: t.Object({ preview_id: t.String({ minLength: 1 }), selected_row_ids: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }), confirmation: t.String(), preview_checksum: t.Optional(t.String()) }) });
  app.get("/api/student-enrollments/roster-template", async (ctx: Context) => { const user = actor(context, ctx, { capability: "import_student_roster" }); if (!user) return { detail: "Insufficient permissions" }; const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Roster"); const headers = [...required, ...optional].sort((a, b) => (a === "student_identifier" ? -1 : b === "student_identifier" ? 1 : a === "student_name" ? -1 : b === "student_name" ? 1 : a.localeCompare(b))); sheet.addRow(headers); sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + headers.length)}1` }; sheet.getRow(1).font = { bold: true }; const instructions = workbook.addWorksheet("Instructions"); instructions.addRow(["OperatorOS Student Roster"]); instructions.addRow(["Required columns", [...required].sort().join(", ")]); instructions.addRow(["Workflow", "Upload creates a non-mutating preview. Select valid rows and confirm before commit."]); const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="operatoros-student-roster.xlsx"' } }); });
  return app;
}
