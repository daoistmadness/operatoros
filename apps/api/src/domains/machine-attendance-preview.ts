import { createHash, randomUUID } from "node:crypto";
import { t } from "elysia";
import {
  MachineImportApplyResponseSchema,
  MachineImportPreviewResponseSchema,
  type MachineImportApplyClassification,
  type MachineImportApplyResponse,
  type MachineImportPreviewResponse,
} from "@operatoros/contracts/attendance";
import { inTransaction } from "@operatoros/db";
import {
  MachineWorkbookError,
  parseMachineAttendanceWorkbook,
  type MachineAttendanceRow,
} from "@operatoros/excel";
import type { AuthContext, CurrentUser } from "../auth/service";
import { actor } from "./core";
import { deriveAttendanceStatus, insertCanonicalAttendanceRecord } from "./attendance-rules";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";
import { schoolLocalDate } from "./attendance-submission-deadline";

type Row = Record<string, any>;
type Context = any;
type PreviewItem = MachineImportPreviewResponse["rows"][number];
type ProjectedRow = {
  source: MachineAttendanceRow;
  response: PreviewItem;
  studentId: number | null;
  enrollmentId: number | null;
  existing: Row | null;
};
type Projection = {
  items: ProjectedRow[];
  summary: MachineImportPreviewResponse["summary"];
  fileFingerprint: string;
  previewDigest: string;
};

const MAX_MACHINE_WORKBOOK_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 50;
const CONFIRMATION = "IMPORT_MACHINE_ATTENDANCE";
const CONFLICTS = new Set<MachineImportApplyClassification>(["CONFLICT_EXISTING_ATTENDANCE", "CONFLICT_EXISTING_OVERRIDE"]);

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function fail(set: any, status: number, detail: string | Record<string, unknown>): { detail: string | Record<string, unknown> } {
  set.status = status;
  return { detail };
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function unknownExpectation() {
  return { status: "UNKNOWN" as const, reason: null, source: "NONE" as const };
}

function identityMap(context: AuthContext, identifiers: string[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  const unique = [...new Set(identifiers)];
  if (!unique.length) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const values = rows(context, `SELECT d.device_identifier, d.student_master_id, d.legacy_student_id,
      s.id AS student_id, s.name AS student_name, s.class_name, s.jenjang
    FROM student_device_identities d
    LEFT JOIN students s ON s.id = d.legacy_student_id
    WHERE d.is_active = 1 AND d.device_identifier IN (${placeholders})
    ORDER BY d.device_identifier, d.id`, unique);
  for (const value of values) {
    const key = String(value.device_identifier);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function selectedScope(context: AuthContext, academicYearId: number, jenjangId: number): { year: Row; jenjang: Row } | null {
  const year = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE id = ?", [academicYearId]);
  const jenjang = row(context, "SELECT id, name FROM jenjangs WHERE id = ? AND active = 1", [jenjangId]);
  return year && jenjang ? { year, jenjang } : null;
}

function matchingState(source: MachineAttendanceRow, candidates: Row[]): PreviewItem["matchingState"] {
  if (!source.date) return "INVALID_SOURCE_ROW";
  if (!source.machineStudentIdentifier) return "INVALID_IDENTIFIER";
  if (!candidates.length) return "UNMAPPED";
  if (candidates.length !== 1) return "AMBIGUOUS";
  return candidates[0]?.student_id == null ? "INVALID_IDENTIFIER" : "MATCHED";
}

function reconciliation(state: string, evidence: string, expectation: string): PreviewItem["reconciliationState"] {
  if (state === "UNMAPPED") return "UNMAPPED";
  if (state === "AMBIGUOUS") return "AMBIGUOUS";
  if (state === "INVALID_IDENTIFIER" || state === "INVALID_SOURCE_ROW") return "INVALID_SOURCE_ROW";
  if (evidence === "INVALID_SCAN_VALUE") return "INVALID_SCAN";
  if (evidence === "UNSUPPORTED_SOURCE_STATUS") return "UNSUPPORTED_SOURCE_STATUS";
  if (expectation === "UNKNOWN") return "EXPECTATION_UNKNOWN";
  if (expectation === "NOT_EXPECTED") return evidence === "NO_SCAN" ? "NO_SCAN_NOT_EXPECTED" : "SCAN_NOT_EXPECTED";
  return evidence === "NO_SCAN" ? "NO_SCAN_EXPECTED" : "SCAN_EXPECTED";
}

function enrollmentMap(context: AuthContext, studentIds: number[], academicYearId: number): Map<number, Row[]> {
  const result = new Map<number, Row[]>();
  const unique = [...new Set(studentIds)];
  if (!unique.length) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const values = rows(context, `SELECT e.id, e.student_id, e.student_master_id, e.jenjang_id,
      e.academic_class_id, COALESCE(c.class_name, e.class_name) AS class_name,
      e.effective_from, e.effective_to, e.lifecycle_state, e.class_assigned
    FROM student_enrollments e
    LEFT JOIN academic_classes c ON c.id = e.academic_class_id
    WHERE e.academic_year_id = ? AND e.student_id IN (${placeholders})
      AND e.lifecycle_state = 'ACTIVE' AND e.class_assigned = 1
    ORDER BY e.student_id, e.id`, [academicYearId, ...unique]);
  for (const value of values) {
    const key = Number(value.student_id);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function attendanceMap(context: AuthContext, studentIds: number[], dates: string[]): Map<string, Row> {
  const result = new Map<string, Row>();
  const students = [...new Set(studentIds)];
  const uniqueDates = [...new Set(dates)];
  if (!students.length || !uniqueDates.length) return result;
  const studentPlaceholders = students.map(() => "?").join(", ");
  const datePlaceholders = uniqueDates.map(() => "?").join(", ");
  const values = rows(context, `SELECT a.id, a.student_id, a.date, a.status, a.check_in,
      a.check_out, a.late_duration, a.late_source, o.id AS override_id,
      o.override_status, o.override_check_in, o.override_check_out
    FROM attendance a
    LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
    WHERE a.student_id IN (${studentPlaceholders}) AND a.date IN (${datePlaceholders})`, [...students, ...uniqueDates]);
  for (const value of values) result.set(`${Number(value.student_id)}\u0000${String(value.date)}`, value);
  return result;
}

function finalizedDates(context: AuthContext, dates: string[]): Set<string> {
  const unique = [...new Set(dates)];
  if (!unique.length) return new Set();
  const placeholders = unique.map(() => "?").join(", ");
  return new Set(rows(context, `SELECT attendance_date FROM attendance_periods WHERE status = 'FINALIZED' AND attendance_date IN (${placeholders})`, unique).map((value) => String(value.attendance_date)));
}

function dateEnrollment(enrollments: Row[], date: string, jenjangId: number): { value: Row | null; classification: MachineImportApplyClassification | null } {
  const effective = enrollments.filter((value) => (value.effective_from == null || String(value.effective_from) <= date) && (value.effective_to == null || String(value.effective_to) >= date));
  if (effective.length > 1) return { value: null, classification: "BLOCKED_AMBIGUOUS_ENROLLMENT" };
  const value = effective[0];
  if (!value) return { value: null, classification: "BLOCKED_NO_ACTIVE_ENROLLMENT" };
  if (Number(value.jenjang_id) !== jenjangId) return { value: null, classification: "BLOCKED_OUT_OF_SCOPE" };
  return { value, classification: null };
}

function sameTime(value: unknown): string | null {
  return value == null || value === "" ? null : String(value).slice(0, 5);
}

function sameCanonical(existing: Row, source: MachineAttendanceRow, status: string): boolean {
  return String(existing.status) === status
    && sameTime(existing.check_in) === source.checkIn
    && sameTime(existing.check_out) === source.checkOut
    && Number(existing.late_duration ?? 0) === (source.lateMinutes ?? 0);
}

function classify(source: MachineAttendanceRow, state: PreviewItem["matchingState"], expectation: string, enrollment: { value: Row | null; classification: MachineImportApplyClassification | null }, existing: Row | null, finalized: boolean, today: string, canonicalStatus: string | null): MachineImportApplyClassification {
  if (state === "INVALID_SOURCE_ROW" || state === "INVALID_IDENTIFIER") return "BLOCKED_INVALID_SOURCE_ROW";
  if (state === "UNMAPPED") return "BLOCKED_UNMAPPED";
  if (state === "AMBIGUOUS") return "BLOCKED_AMBIGUOUS";
  if (!source.date || source.date > today) return "BLOCKED_FUTURE_DATE";
  if (enrollment.classification) return enrollment.classification;
  if (expectation === "UNKNOWN") return "BLOCKED_CALENDAR_UNKNOWN";
  if (expectation === "NOT_EXPECTED") return "BLOCKED_CALENDAR_NOT_EXPECTED";
  if (source.machineEvidence === "NO_SCAN") return "BLOCKED_NO_SCAN";
  if (source.machineEvidence === "MULTIPLE_SCANS") return "BLOCKED_MULTIPLE_SCANS_UNCLEAR";
  if (source.machineEvidence === "INVALID_SCAN_VALUE") return "BLOCKED_INVALID_SCAN";
  if (source.machineEvidence === "UNSUPPORTED_SOURCE_STATUS") return "BLOCKED_UNSUPPORTED_SOURCE_STATUS";
  if (!source.checkIn || !source.checkOut || !canonicalStatus || !["on-time", "late"].includes(canonicalStatus)) return "BLOCKED_INCOMPLETE_SCAN";
  if (existing?.override_id != null) return "CONFLICT_EXISTING_OVERRIDE";
  if (existing && sameCanonical(existing, source, canonicalStatus)) return "NOOP_ALREADY_CANONICAL";
  if (existing) return "CONFLICT_EXISTING_ATTENDANCE";
  if (finalized) return "BLOCKED_FINALIZED_PERIOD";
  return "ELIGIBLE_CREATE";
}

function digestFor(fileFingerprint: string, academicYearId: number, jenjangId: number, evaluatedOn: string, items: ProjectedRow[]): string {
  const payload = {
    fileFingerprint, academicYearId, jenjangId, evaluatedOn,
    rows: items.map(({ source, response, studentId, enrollmentId, existing }) => ({
      sourceRows: source.sourceRows, machineStudentIdentifier: source.machineStudentIdentifier, date: source.date,
      checkIn: source.checkIn, checkOut: source.checkOut, lateMinutes: source.lateMinutes, scanTimes: response.scanTimes,
      machineEvidence: response.machineEvidence, matchingState: response.matchingState, studentId, enrollmentId,
      expectation: response.expectation, canonicalStatus: response.canonicalStatus,
      applyClassification: response.applyClassification,
      existing: existing ? { id: Number(existing.id), status: String(existing.status), checkIn: sameTime(existing.check_in), checkOut: sameTime(existing.check_out), lateDuration: Number(existing.late_duration ?? 0), overrideId: existing.override_id == null ? null : Number(existing.override_id), overrideStatus: existing.override_status == null ? null : String(existing.override_status) } : null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildProjection(context: AuthContext, parsed: Awaited<ReturnType<typeof parseMachineAttendanceWorkbook>>, academicYearId: number, jenjangId: number, year: Row, fileFingerprint: string, evaluatedOn: string): Projection {
  const identifiers = parsed.rows.map((value) => value.machineStudentIdentifier).filter((value): value is string => value !== null);
  const identityByIdentifier = identityMap(context, identifiers);
  const dates = parsed.rows.map((value) => value.date).filter((value): value is string => value !== null);
  const expectationByDate = resolveAttendanceExpectationsForDates(context, { academicYearId, dates, startDate: String(year.start_date), endDate: String(year.end_date), jenjangIds: [jenjangId] });
  const matchedCandidates = parsed.rows.map((source) => source.machineStudentIdentifier ? identityByIdentifier.get(source.machineStudentIdentifier)?.[0]?.student_id : null).filter((value): value is number => value != null);
  const enrollmentsByStudent = enrollmentMap(context, matchedCandidates, academicYearId);
  const attendancesByKey = attendanceMap(context, matchedCandidates, dates);
  const finalized = finalizedDates(context, dates);
  const matched = new Set<string>();
  const unmapped = new Set<string>();
  const ambiguous = new Set<string>();
  const blockedByClassification: Record<string, number> = {};
  let invalidIdentifiers = 0;
  let scanFacts = 0;
  let multipleScans = 0;
  let expectedNoScan = 0;
  let notExpectedNoScan = 0;
  let expectationUnknown = 0;
  const items: ProjectedRow[] = parsed.rows.map((source) => {
    const candidates = source.machineStudentIdentifier ? identityByIdentifier.get(source.machineStudentIdentifier) ?? [] : [];
    const state = matchingState(source, candidates);
    const canonical = state === "MATCHED" ? candidates[0] : null;
    const studentId = canonical?.student_id == null ? null : Number(canonical.student_id);
    const expectation = source.date ? expectationByDate.get(source.date)?.get(jenjangId) ?? unknownExpectation() : unknownExpectation();
    const enrollment = studentId == null || !source.date ? { value: null, classification: null } : dateEnrollment(enrollmentsByStudent.get(studentId) ?? [], source.date, jenjangId);
    const existing = studentId == null || !source.date ? null : attendancesByKey.get(`${studentId}\u0000${source.date}`) ?? null;
    const canonicalStatus = source.checkIn && source.checkOut && source.machineEvidence === "SCAN_PRESENT" ? deriveAttendanceStatus(source.checkIn, source.checkOut, source.lateMinutes) : null;
    const applyClassification = classify(source, state, expectation.status, enrollment, existing, finalized.has(source.date ?? ""), evaluatedOn, canonicalStatus);
    if (state === "MATCHED" && source.machineStudentIdentifier) matched.add(source.machineStudentIdentifier);
    if (state === "UNMAPPED" && source.machineStudentIdentifier) unmapped.add(source.machineStudentIdentifier);
    if (state === "AMBIGUOUS" && source.machineStudentIdentifier) ambiguous.add(source.machineStudentIdentifier);
    if (state === "INVALID_IDENTIFIER" || state === "INVALID_SOURCE_ROW") invalidIdentifiers++;
    if (source.scanTimes.length) scanFacts++;
    if (source.machineEvidence === "MULTIPLE_SCANS") multipleScans++;
    if (state === "MATCHED" && expectation.status === "EXPECTED" && source.machineEvidence === "NO_SCAN") expectedNoScan++;
    if (state === "MATCHED" && expectation.status === "NOT_EXPECTED" && source.machineEvidence === "NO_SCAN") notExpectedNoScan++;
    if (expectation.status === "UNKNOWN") expectationUnknown++;
    if (applyClassification.startsWith("BLOCKED_")) blockedByClassification[applyClassification] = (blockedByClassification[applyClassification] ?? 0) + 1;
    const response: PreviewItem = {
      date: source.date, sourceStudentName: source.sourceStudentName, machineStudentIdentifier: source.machineStudentIdentifier,
      matchingState: state,
      student: canonical ? { id: Number(canonical.student_id), masterId: canonical.student_master_id == null ? null : String(canonical.student_master_id), name: String(canonical.student_name), className: canonical.class_name == null ? null : String(canonical.class_name), jenjang: canonical.jenjang == null ? null : String(canonical.jenjang) } : null,
      machineEvidence: source.machineEvidence, scanTimes: source.scanTimes, expectation,
      reconciliationState: reconciliation(state, source.machineEvidence, expectation.status), applyClassification, canonicalStatus,
    };
    return { source, response, studentId, enrollmentId: enrollment.value?.id == null ? null : Number(enrollment.value.id), existing };
  });
  const eligibleCreates = items.filter((value) => value.response.applyClassification === "ELIGIBLE_CREATE").length;
  const alreadyCanonical = items.filter((value) => value.response.applyClassification === "NOOP_ALREADY_CANONICAL").length;
  const conflicts = items.filter((value) => CONFLICTS.has(value.response.applyClassification)).length;
  const blocked = items.filter((value) => value.response.applyClassification.startsWith("BLOCKED_")).length;
  const summary = { matchedStudents: matched.size, unmappedStudents: unmapped.size, ambiguousStudents: ambiguous.size, invalidIdentifiers, scanFacts, multipleScans, expectedNoScan, notExpectedNoScan, expectationUnknown, eligibleCreates, alreadyCanonical, conflicts, blocked, blockedByClassification };
  return { items, summary, fileFingerprint, previewDigest: digestFor(fileFingerprint, academicYearId, jenjangId, evaluatedOn, items) };
}

function toBuffer(value: ArrayBuffer | Uint8Array): Buffer {
  return value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function fingerprint(value: ArrayBuffer | Uint8Array): string {
  return createHash("sha256").update(toBuffer(value)).digest("hex");
}

function validXlsxName(file: File): boolean { return file.name.toLowerCase().endsWith(".xlsx"); }

function uploadScope(context: AuthContext, body: Row): { academicYearId: number; jenjangId: number; year: Row; file: File } | { error: string } {
  const file = body.file as File | undefined;
  if (!file || !validXlsxName(file)) return { error: "Upload an .xlsx attendance-machine workbook." };
  if (file.size > MAX_MACHINE_WORKBOOK_BYTES) return { error: "The attendance-machine workbook is too large." };
  const academicYearId = positive(body.academic_year_id);
  const jenjangId = positive(body.jenjang_id);
  if (!academicYearId || !jenjangId) return { error: "Academic year and jenjang are required." };
  const scope = selectedScope(context, academicYearId, jenjangId);
  if (!scope) return { error: "The academic year or jenjang scope is invalid." };
  return { academicYearId, jenjangId, year: scope.year, file };
}

function auditEvent(client: any, user: CurrentUser, input: { entityType: string; entityReference: string; operation: string; importSessionId: string; metadata: Record<string, unknown>; changedFields?: string[] }): void {
  client.run(`INSERT INTO operations_audit_events
    (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation,
     risk_level, source, import_session_id, success, failure_code, changed_fields, metadata, schema_version)
    VALUES (?, ?, ?, 'import_attendance', ?, ?, ?, 'LOW', 'MACHINE_XLSX', ?, 1, NULL, ?, ?, '1')`, [
    randomUUID(), String(user.id), user.role, input.entityType, input.entityReference, input.operation,
    input.importSessionId, input.changedFields ? JSON.stringify(input.changedFields) : null, JSON.stringify(input.metadata),
  ]);
}

function stale(set: any): { detail: Record<string, string> } {
  set.status = 409;
  return { detail: { code: "PREVIEW_STALE", message: "Attendance data changed after this preview. Review the updated preview before importing." } };
}

export function machineAttendancePreviewRoutes(app: any, context: AuthContext): void {
  app.post("/api/attendance/machine-import/preview", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "import_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    const scope = uploadScope(context, ctx.body ?? {});
    if ("error" in scope) return fail(ctx.set, scope.error.includes("large") ? 413 : 400, scope.error);
    try {
      const buffer = await scope.file.arrayBuffer();
      if (buffer.byteLength > MAX_MACHINE_WORKBOOK_BYTES) return fail(ctx.set, 413, "The attendance-machine workbook is too large.");
      const parsed = await parseMachineAttendanceWorkbook(buffer);
      const evaluatedOn = schoolLocalDate(context.now?.() ?? new Date());
      const projection = buildProjection(context, parsed, scope.academicYearId, scope.jenjangId, scope.year, fingerprint(buffer), evaluatedOn);
      const page = Math.max(1, positive(ctx.body?.page) ?? 1);
      const pageSize = Math.min(100, positive(ctx.body?.page_size) ?? PAGE_SIZE);
      const response: MachineImportPreviewResponse = {
        previewOnly: true, fileFingerprint: projection.fileFingerprint, previewDigest: projection.previewDigest,
        workbook: { detectedProfile: parsed.detectedProfile, sheet: parsed.sheet, dimensions: parsed.dimensions, sourceRows: parsed.sourceRows, dateCoverage: parsed.dateCoverage, warnings: parsed.warnings },
        summary: projection.summary, rows: projection.items.slice((page - 1) * pageSize, page * pageSize).map((value) => value.response),
        pagination: { page, pageSize, total: projection.items.length },
      };
      return response;
    } catch (error) {
      ctx.set.status = 400;
      if (error instanceof MachineWorkbookError) return { detail: error.message };
      return { detail: "The attendance-machine workbook could not be previewed safely." };
    }
  }, {
    body: t.Object({ file: t.File(), academic_year_id: t.String({ pattern: "^[1-9]\\d*$" }), jenjang_id: t.String({ pattern: "^[1-9]\\d*$" }), page: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })), page_size: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })) }),
    response: MachineImportPreviewResponseSchema,
  });

  app.post("/api/attendance/machine-import/apply", async (ctx: Context) => {
    const user = actor(context, ctx, { capability: "import_attendance" });
    if (!user) return { detail: "Insufficient permissions" };
    if (ctx.body?.confirmation !== CONFIRMATION) return fail(ctx.set, 400, "Exact import confirmation is required.");
    const scope = uploadScope(context, ctx.body ?? {});
    if ("error" in scope) return fail(ctx.set, scope.error.includes("large") ? 413 : 400, scope.error);
    const expectedDigest = String(ctx.body?.expected_preview_digest ?? "");
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) return fail(ctx.set, 400, "A valid preview digest is required.");
    try {
      const buffer = await scope.file.arrayBuffer();
      if (buffer.byteLength > MAX_MACHINE_WORKBOOK_BYTES) return fail(ctx.set, 413, "The attendance-machine workbook is too large.");
      const fileFingerprint = fingerprint(buffer);
      const evaluatedOn = schoolLocalDate(context.now?.() ?? new Date());
      const previewParsed = await parseMachineAttendanceWorkbook(buffer);
      const previewProjection = buildProjection(context, previewParsed, scope.academicYearId, scope.jenjangId, scope.year, fileFingerprint, evaluatedOn);
      if (previewProjection.previewDigest !== expectedDigest) return stale(ctx.set);
      const applyParsed = await parseMachineAttendanceWorkbook(buffer);
      const appliedAt = (context.now?.() ?? new Date()).toISOString();
      const result = inTransaction(context.database.client, () => {
        const projection = buildProjection(context, applyParsed, scope.academicYearId, scope.jenjangId, scope.year, fileFingerprint, evaluatedOn);
        if (projection.previewDigest !== expectedDigest) throw new Error("PREVIEW_STALE");
        const batchId = randomUUID();
        auditEvent(context.database.client, user, { entityType: "MACHINE_IMPORT", entityReference: batchId, operation: "MACHINE_IMPORT_APPLY", importSessionId: batchId, metadata: { file_sha256: fileFingerprint, academic_year_id: scope.academicYearId, jenjang_id: scope.jenjangId, rows_inspected: projection.items.length, eligible: projection.summary.eligibleCreates } });
        let created = 0;
        for (const value of projection.items) {
          if (value.response.applyClassification !== "ELIGIBLE_CREATE" || value.studentId == null || value.source.date == null || value.response.canonicalStatus == null) continue;
          const attendanceId = insertCanonicalAttendanceRecord(context.database.client, { studentId: value.studentId, date: value.source.date, checkIn: value.source.checkIn, checkOut: value.source.checkOut, lateDuration: value.source.lateMinutes ?? 0, lateSource: value.response.canonicalStatus === "late" ? "excel" : "none", status: value.response.canonicalStatus });
          auditEvent(context.database.client, user, { entityType: "ATTENDANCE", entityReference: `ATTENDANCE/${attendanceId}`, operation: "MACHINE_IMPORT_CREATE", importSessionId: batchId, changedFields: ["student_id", "date", "check_in", "check_out", "late_duration", "late_source", "status"], metadata: { attendance_id: attendanceId, date: value.source.date, status: value.response.canonicalStatus } });
          created++;
        }
        return { batchId, created, rowsInspected: projection.items.length, summary: projection.summary };
      });
      const response: MachineImportApplyResponse = { status: "APPLIED", batchId: result.batchId, fileFingerprint, appliedAt, summary: { rowsInspected: result.rowsInspected, created: result.created, alreadyCanonical: result.summary.alreadyCanonical, conflicts: result.summary.conflicts, blocked: result.summary.blocked, blockedByClassification: result.summary.blockedByClassification } };
      return response;
    } catch (error) {
      if (error instanceof Error && error.message === "PREVIEW_STALE") return stale(ctx.set);
      ctx.set.status = 409;
      return { detail: "The machine attendance import could not be applied. No attendance records were changed." };
    }
  }, {
    body: t.Object({ file: t.File(), academic_year_id: t.String({ pattern: "^[1-9]\\d*$" }), jenjang_id: t.String({ pattern: "^[1-9]\\d*$" }), expected_preview_digest: t.String({ pattern: "^[a-f0-9]{64}$" }), confirmation: t.Literal(CONFIRMATION) }),
    response: MachineImportApplyResponseSchema,
  });
}
