import { createHash, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  AttendanceReviewEventMetadataSchema,
  AttendanceReviewMutationSchema,
  AttendanceReviewReopenSchema,
  AttendanceReconciliationQuerySchema,
  AttendanceReconciliationResponseSchema,
  type AttendanceReviewEventMetadata,
  type AttendanceReviewMutation,
  type AttendanceReviewReopen,
  type AttendanceReconciliationQuery,
  type AttendanceReconciliationResponse,
} from "@operatoros/contracts/analytics";
import { inTransaction } from "@operatoros/db";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { resolveAttendanceBasis } from "./attendance-basis";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";
import { getMonthlyClassAbsenceStudentTotals } from "./manual-absence";
import { reportScopeIncludesLevel } from "./reports";
import type { AttendanceDayDetail } from "./term-attendance";

type Row = Record<string, any>;
type StatusCounts = { sakit: number; izin: number; alfa: number };
type MachineRecord = { date: string; status: string; scan_in: string | null; scan_out: string | null; source_state: "APPLIED" | "UNCHANGED" | "CONFLICT" };
type StudentTotals = {
  enrollment_id: number;
  student_name: string;
  expected_student_days: number;
  effective: { present: number; sakit: number; izin: number; alfa: number; unresolved: number };
  machine_records: MachineRecord[];
  daily_evidence: Array<{ date: string; raw_status: string | null; override_status: string | null; effective_status: string | null; machine_recorded: boolean }>;
  unresolved_dates: string[];
  unknown_calendar_dates: string[];
  contradictory_dates: string[];
  book_totals: StatusCounts | null;
};
type ReviewReferences = AttendanceReviewEventMetadata["evidence_references"];
type ReviewEvent = { revision: number; previous_revision: number; action: "REVIEWED" | "REVIEWED_WITH_ISSUES" | "REOPENED"; actor: string; timestamp: string; evidence_version: string; note: string | null; evidence_references: ReviewReferences };

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function one(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function problem(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`); date <= last; date.setUTCDate(date.getUTCDate() + 1))
    dates.push(date.toISOString().slice(0, 10));
  return dates;
}

function machineEvidence(context: AuthContext, start: string, end: string): Map<string, MachineRecord> {
  const values = rows(context, `SELECT r.attendance_date, r.classification, r.proposed_change
    FROM attendance_import_rows r JOIN attendance_import_batches b ON b.id = r.batch_id
    WHERE b.status = 'committed'
      AND ((r.selected_for_commit = 1 AND r.classification IN ('NEW', 'UNCHANGED')) OR r.classification = 'CONFLICT')
      AND r.attendance_date BETWEEN ? AND ?
      AND EXISTS (SELECT 1 FROM operations_audit_events e
        WHERE e.entity_type = 'MACHINE_IMPORT' AND e.entity_reference = b.id
          AND e.operation = 'MACHINE_IMPORT_APPLY' AND e.success = 1)
    ORDER BY b.uploaded_at DESC, r.id DESC`, [start, end]);
  const result = new Map<string, MachineRecord>();
  for (const value of values) {
    if (typeof value.proposed_change !== "string") continue;
    let proposal: Row;
    try { proposal = JSON.parse(value.proposed_change) as Row; } catch { continue; }
    const source = proposal as Row;
    if (!Number.isInteger(Number(source.student_id)) || !["CREATE", "NOOP_ALREADY_CANONICAL", "NO_WRITE"].includes(String(source.action))) continue;
    const sourceState = value.classification === "NEW" ? "APPLIED"
      : value.classification === "UNCHANGED" ? "UNCHANGED"
        : value.classification === "CONFLICT" ? "CONFLICT" : null;
    if (!sourceState || (sourceState === "CONFLICT" && source.action !== "NO_WRITE")) continue;
    const date = String(value.attendance_date ?? source.attendance_date ?? "");
    if (!date || !["on-time", "late"].includes(String(source.status)) || source.check_in == null) continue;
    const key = `${Number(source.student_id)}\u0000${date}`;
    if (result.has(key)) continue;
    result.set(key, {
      date, status: String(source.status ?? "unknown"),
      scan_in: source.check_in == null ? null : String(source.check_in),
      scan_out: source.check_out == null ? null : String(source.check_out),
      source_state: sourceState,
    });
  }
  return result;
}

function idRows(context: AuthContext, table: string, column: string, ids: number[], suffix = "", suffixParams: unknown[] = []): Row[] {
  if (!ids.length) return [];
  return rows(context, `SELECT * FROM ${table} WHERE ${column} IN (${ids.map(() => "?").join(",")}) ${suffix}`, [...ids, ...suffixParams]);
}

function parsed(value: unknown): Row | null {
  if (value == null) return null;
  try { const result = typeof value === "string" ? JSON.parse(value) : value; return result && typeof result === "object" && !Array.isArray(result) ? result as Row : null; }
  catch { return null; }
}

function orderedIds(values: number[]): number[] { return [...new Set(values)].sort((left, right) => left - right); }

function evidenceReference(context: AuthContext, input: {
  academicYearId: number; classId: number; month: string; start: string; end: string; jenjangId: number;
  className: string; gradeId: number; programId: number; dayDetails: AttendanceDayDetail[];
  unknownClassEvidence: Array<{ date: string; enrollment_id: number; class_id: null }>;
  calendarByDate: Map<string, Map<number, { status: string } | undefined>>; students: StudentTotals[];
}): { version: string; references: ReviewReferences } {
  const details = input.dayDetails.filter((day) => day.class_id === input.classId);
  const enrollmentIds = orderedIds([...details.map((day) => day.enrollment_id), ...input.unknownClassEvidence.map((day) => day.enrollment_id)]);
  const unresolvedStudentDays = input.unknownClassEvidence.flatMap((day) => {
    const value = one(context, "SELECT student_id FROM student_enrollments WHERE id = ?", [day.enrollment_id]);
    return value?.student_id == null ? [] : [{ student_id: Number(value.student_id), date: day.date }];
  });
  const studentIds = orderedIds([...details.flatMap((day) => day.student_id === null ? [] : [day.student_id]), ...unresolvedStudentDays.map((day) => day.student_id)]);
  const evidenceStudentDates = new Set([
    ...details.flatMap((day) => day.student_id === null ? [] : [`${day.student_id}\u0000${day.date}`]),
    ...unresolvedStudentDays.map((day) => `${day.student_id}\u0000${day.date}`),
  ]);
  const attendanceIds = orderedIds(details.flatMap((day) => day.attendance_id === null ? [] : [day.attendance_id]));
  const unresolvedEvidence = input.unknownClassEvidence.map((item) => ({ date: item.date, enrollment_id: item.enrollment_id }));
  const unresolvedRows = input.unknownClassEvidence.flatMap((item) => {
    const value = one(context, `SELECT a.id FROM attendance a JOIN student_enrollments e ON e.student_id = a.student_id
      WHERE e.id = ? AND a.date = ?`, [item.enrollment_id, item.date]);
    return value ? [Number(value.id)] : [];
  });
  const allAttendanceIds = orderedIds([...attendanceIds, ...unresolvedRows]);
  const attendance = idRows(context, "attendance", "id", allAttendanceIds).map((value) => ({
    id: Number(value.id), student_id: Number(value.student_id), date: String(value.date), status: String(value.status),
    check_in: value.check_in == null ? null : String(value.check_in), check_out: value.check_out == null ? null : String(value.check_out),
    late_duration: Number(value.late_duration), late_source: String(value.late_source), is_absent: Number(value.is_absent),
    overtime: value.overtime == null ? null : String(value.overtime), exception: value.exception == null ? null : String(value.exception), week: value.week == null ? null : String(value.week),
  }));
  const overrides = idRows(context, "attendance_overrides", "attendance_id", allAttendanceIds).map((value) => ({
    id: Number(value.id), attendance_id: Number(value.attendance_id), original_status: String(value.original_status),
    override_status: String(value.override_status), override_check_in: value.override_check_in == null ? null : String(value.override_check_in),
    override_check_out: value.override_check_out == null ? null : String(value.override_check_out), note: String(value.note),
    reviewed_by: String(value.reviewed_by), reviewed_at: String(value.reviewed_at),
  })).sort((left, right) => left.id - right.id);
  const overrideHistory = idRows(context, "attendance_override_history", "attendance_id", allAttendanceIds).map((value) => ({
    id: Number(value.id), override_id: Number(value.override_id), attendance_id: Number(value.attendance_id),
    previous_status: value.previous_status == null ? null : String(value.previous_status), new_status: String(value.new_status),
    previous_values: parsed(value.previous_values), new_values: parsed(value.new_values), note: String(value.note),
    previous_values_json: value.previous_values == null ? null : String(value.previous_values),
    new_values_json: value.new_values == null ? null : String(value.new_values),
    reviewed_by: String(value.reviewed_by), timestamp: String(value.timestamp),
  })).sort((left, right) => left.id - right.id);
  const sourceRows = rows(context, `SELECT r.id, r.batch_id, r.source_row, r.attendance_date, r.existing_attendance_id,
      r.classification, r.selected_for_commit, r.existing_record, r.proposed_change, b.checksum, b.committed_at,
      a.student_id AS attendance_student_id, d.legacy_student_id AS device_student_id
    FROM attendance_import_rows r JOIN attendance_import_batches b ON b.id = r.batch_id
    LEFT JOIN attendance a ON a.id = r.existing_attendance_id
    LEFT JOIN student_device_identities d ON d.device_identifier = r.student_identifier
    WHERE b.status = 'committed' AND r.attendance_date BETWEEN ? AND ? ORDER BY r.id`, [input.start, input.end]).flatMap((value) => {
    const proposal = parsed(value.proposed_change);
    const sourceStudentId = proposal?.student_id == null ? null : Number(proposal.student_id);
    const linkedStudentId = sourceStudentId ?? (value.attendance_student_id == null ? null : Number(value.attendance_student_id))
      ?? (value.device_student_id == null ? null : Number(value.device_student_id));
    if (linkedStudentId === null || !evidenceStudentDates.has(`${linkedStudentId}\u0000${String(value.attendance_date)}`)) return [];
    return [{
      id: Number(value.id), batch_id: String(value.batch_id), source_row: value.source_row == null ? null : Number(value.source_row),
      date: String(value.attendance_date), existing_attendance_id: value.existing_attendance_id == null ? null : Number(value.existing_attendance_id),
      classification: String(value.classification), selected: Number(value.selected_for_commit), checksum: String(value.checksum),
      committed_at: value.committed_at == null ? null : String(value.committed_at), existing_record: parsed(value.existing_record), proposal,
      existing_record_json: value.existing_record == null ? null : String(value.existing_record),
      proposed_change_json: value.proposed_change == null ? null : String(value.proposed_change),
    }];
  });
  const enrollments = idRows(context, "student_enrollments", "id", enrollmentIds).map((value) => ({
    id: Number(value.id), student_id: value.student_id == null ? null : Number(value.student_id), academic_year_id: Number(value.academic_year_id),
    jenjang_id: Number(value.jenjang_id),
  })).sort((left, right) => left.id - right.id);
  const enrollmentHistory = idRows(context, "student_enrollment_class_history", "enrollment_id", enrollmentIds,
    "AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY id", [input.end, input.start]).map((value) => ({
    id: Number(value.id), enrollment_id: Number(value.enrollment_id), class_name: value.class_name == null ? null : String(value.class_name),
    effective_from: String(value.effective_from), effective_to: value.effective_to == null ? null : String(value.effective_to),
    changed_at: String(value.changed_at), source: String(value.source),
  }));
  const lifecycleAudit = idRows(context, "student_enrollment_lifecycle_audit", "enrollment_id", enrollmentIds,
    "AND effective_date BETWEEN ? AND ? ORDER BY id", [input.start, input.end]).map((value) => ({
    id: Number(value.id), enrollment_id: Number(value.enrollment_id), prior_state: String(value.prior_state), new_state: String(value.new_state),
    effective_date: String(value.effective_date), reason_code: String(value.reason_code), source_workflow: String(value.source_workflow),
  }));
  const relevantWeekdays = orderedIds([...new Set([...input.calendarByDate.keys()].map((date) => new Date(`${date}T00:00:00Z`).getUTCDay()))]);
  const calendarRules = relevantWeekdays.length ? rows(context, `SELECT id, weekday, expectation, updated_at FROM attendance_calendar_weekday_rules
    WHERE academic_year_id = ? AND jenjang_id = ? AND weekday IN (${relevantWeekdays.map(() => "?").join(",")}) ORDER BY weekday`, [input.academicYearId, input.jenjangId, ...relevantWeekdays]) : [];
  const calendarExceptions = rows(context, `SELECT id, date, expectation, reason, updated_at FROM attendance_calendar_exceptions
    WHERE academic_year_id = ? AND jenjang_id = ? AND date BETWEEN ? AND ? ORDER BY date`, [input.academicYearId, input.jenjangId, input.start, input.end]);
  const ledger = one(context, `SELECT cm.id AS class_month_id, r.* FROM attendance_ledger_class_months cm
    LEFT JOIN attendance_ledger_revisions r ON r.class_month_id = cm.id
    WHERE cm.academic_year_id = ? AND cm.class_id = ? AND cm.month = ? ORDER BY r.revision_no DESC LIMIT 1`, [input.academicYearId, input.classId, input.month]);
  const ledgerTotals = ledger?.id == null ? [] : rows(context, `SELECT enrollment_id, sakit, izin, alfa FROM attendance_ledger_student_totals
    WHERE revision_id = ? ORDER BY enrollment_id`, [ledger.id]).map((value) => ({
    enrollment_id: Number(value.enrollment_id), sakit: Number(value.sakit), izin: Number(value.izin), alfa: Number(value.alfa),
  }));
  const references: ReviewReferences = {
    attendance_ids: allAttendanceIds,
    override_history_ids: overrideHistory.map((value) => value.id),
    attendance_import_row_ids: sourceRows.map((value) => value.id),
    enrollment_ids: enrollmentIds,
    enrollment_class_history_ids: enrollmentHistory.map((value) => value.id),
    enrollment_lifecycle_audit_ids: lifecycleAudit.map((value) => value.id),
    calendar_rule_ids: calendarRules.map((value) => Number(value.id)),
    calendar_exception_ids: calendarExceptions.map((value) => Number(value.id)),
    ledger_revision_id: ledger?.id == null ? null : Number(ledger.id),
  };
  const snapshot = {
    scope: [input.academicYearId, input.classId, input.month, input.start, input.end, input.jenjangId, input.gradeId, input.programId, input.className],
    days: details.map((day) => [day.date, day.enrollment_id, day.student_id, day.class_id, day.expectation, day.attendance_id, day.raw_status, day.override_status, day.effective_status])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])) || Number(left[1]) - Number(right[1])),
    unresolved_class_evidence: unresolvedEvidence.sort((left, right) => left.date.localeCompare(right.date) || left.enrollment_id - right.enrollment_id),
    calendar: [...input.calendarByDate].map(([date, values]) => [date, values.get(input.jenjangId)?.status ?? "UNKNOWN"]),
    calendar_rules: calendarRules,
    calendar_exceptions: calendarExceptions,
    attendance, overrides, overrideHistory, sourceRows, enrollments, enrollmentHistory, lifecycleAudit,
    machine: input.students.flatMap((student) => student.machine_records.map((record) => [student.enrollment_id, record.date, record.status, record.scan_in, record.scan_out, record.source_state])),
    ledger: ledger ? { ...ledger, student_totals: ledgerTotals } : null,
  };
  return { version: `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`, references };
}

function reviewEntityReference(academicYearId: number, classId: number, month: string): string {
  return `${academicYearId}/${classId}/${month}`;
}

function reviewHistory(context: AuthContext, academicYearId: number, classId: number, month: string): ReviewEvent[] {
  const values = rows(context, `SELECT id, occurred_at, actor_id, operation, reason, metadata FROM operations_audit_events
    WHERE entity_type = 'ATTENDANCE_MONTH_REVIEW' AND entity_reference = ? AND success = 1 ORDER BY id`,
  [reviewEntityReference(academicYearId, classId, month)]);
  return values.map((value, index) => {
    const metadata = parsed(value.metadata);
    if (!metadata || !Value.Check(AttendanceReviewEventMetadataSchema, metadata)
      || metadata.academic_year_id !== academicYearId || metadata.class_id !== classId || metadata.month !== month
      || metadata.revision !== index + 1 || metadata.previous_revision !== index
      || (metadata.action === "REOPEN") !== (value.operation === "ATTENDANCE_REVIEW_REOPENED")
      || (metadata.action === "DECISION") !== (value.operation === "ATTENDANCE_REVIEW_DECIDED")
      || (metadata.action === "REOPEN" && metadata.decision !== null)
      || (metadata.action === "DECISION" && metadata.decision === null))
      problem(500, "ATTENDANCE_REVIEW_HISTORY_INVALID", "Attendance review history is incomplete or invalid.");
    return {
      revision: metadata.revision, previous_revision: metadata.previous_revision,
      action: metadata.action === "REOPEN" ? "REOPENED" : metadata.decision!,
      actor: String(value.actor_id), timestamp: String(value.occurred_at), evidence_version: metadata.evidence_version,
      note: value.reason == null ? null : String(value.reason), evidence_references: metadata.evidence_references,
    };
  });
}

function projectedReview(context: AuthContext, input: { academicYearId: number; classId: number; month: string; evidenceVersion: string; evidenceReferences: ReviewReferences }) {
  const history = reviewHistory(context, input.academicYearId, input.classId, input.month);
  const latest = history.at(-1);
  const currentDecision = latest && (latest.action === "REVIEWED" || latest.action === "REVIEWED_WITH_ISSUES") ? latest.action : null;
  return {
    status: currentDecision === null ? "NOT_REVIEWED" as const
      : latest!.evidence_version !== input.evidenceVersion ? "REVIEW_OUTDATED" as const : currentDecision,
    revision: latest?.revision ?? 0, evidence_version: input.evidenceVersion,
    decision: currentDecision,
    reviewed_by: currentDecision !== null ? latest!.actor : null,
    reviewed_at: currentDecision !== null ? latest!.timestamp : null,
    note: currentDecision !== null ? latest!.note : null,
    evidence_references: input.evidenceReferences,
    history,
  };
}

function compare(
  effective: StatusCounts,
  reported: StatusCounts | null,
  complete: boolean,
  notReported: boolean,
  noExpectedDays = false,
  otherReason: AttendanceReconciliationResponse["ledger"]["comparison"]["reason_code"] = null,
): AttendanceReconciliationResponse["ledger"]["comparison"] {
  const differences = reported ? {
    sakit: effective.sakit - reported.sakit,
    izin: effective.izin - reported.izin,
    alfa: effective.alfa - reported.alfa,
  } : { sakit: null, izin: null, alfa: null };
  if (notReported) return { status: "NOT_REPORTED", reason_code: "LEDGER_NOT_SUBMITTED", differences };
  if (otherReason) return { status: "NOT_COMPARABLE", reason_code: otherReason, differences };
  if (noExpectedDays) return { status: "NOT_COMPARABLE", reason_code: "NO_EXPECTED_STUDENT_DAYS", differences };
  if (reported && Object.values(differences).some((value) => value !== null && value > 0))
    return { status: "MISMATCH", reason_code: "SIA_REASON_MISMATCH", differences };
  if (!complete) return { status: "NOT_COMPARABLE", reason_code: "CANONICAL_COVERAGE_INCOMPLETE", differences };
  const match = Boolean(reported && differences.sakit === 0 && differences.izin === 0 && differences.alfa === 0);
  return { status: match ? "MATCH" : "MISMATCH", reason_code: match ? null : "SIA_REASON_MISMATCH", differences };
}

function reportedTotals(value: Row, submitted: boolean): StatusCounts | null {
  return submitted ? { sakit: Number(value.sakit), izin: Number(value.izin), alfa: Number(value.alfa) } : null;
}

function basisReason(reason: string | null): AttendanceReconciliationResponse["ledger"]["comparison"]["reason_code"] {
  switch (reason) {
    case "LEDGER_NOT_SUBMITTED": case "NO_CANONICAL_EVIDENCE": case "NO_EXPECTED_STUDENT_DAYS":
    case "CANONICAL_COVERAGE_INCOMPLETE": case "CANONICAL_STATUS_UNRESOLVED":
      return reason;
    default:
      return null;
  }
}

function studentComparison(student: StudentTotals, ledgerState: string, entryMode: string | null): AttendanceReconciliationResponse["students"][number]["comparison"] {
  if (ledgerState !== "SUBMITTED") return { status: "NOT_REPORTED", reason_code: "LEDGER_NOT_SUBMITTED" };
  if (entryMode !== "PER_STUDENT") return { status: "NOT_COMPARABLE", reason_code: "CLASS_TOTALS_ONLY" };
  const complete = student.effective.unresolved === 0 && student.unknown_calendar_dates.length === 0;
  const comparison = compare(student.effective, student.book_totals, complete, false,
    student.expected_student_days === 0, student.unknown_calendar_dates.length ? "CALENDAR_UNKNOWN" : null);
  return comparison;
}

export function resolveAttendanceReconciliation(context: AuthContext, query: AttendanceReconciliationQuery): AttendanceReconciliationResponse {
  const academicYearId = Number(query.academic_year_id);
  const classId = Number(query.class_id);
  const classRow = one(context, `SELECT c.id, c.class_name, y.start_date AS academic_year_start, y.end_date AS academic_year_end,
      g.id AS grade_id, g.name AS grade,
      p.id AS program_id, p.name AS program,
      j.id AS jenjang_id, j.name AS jenjang, j.level AS jenjang_level
    FROM academic_classes c JOIN academic_years y ON y.id = c.academic_year_id
    JOIN academic_grades g ON g.id = c.grade_id
    JOIN academic_programs p ON p.id = g.program_id JOIN jenjangs j ON j.id = g.jenjang_id
    WHERE c.id = ? AND c.academic_year_id = ?`, [classId, academicYearId]);
  if (!classRow) problem(404, "CLASS_NOT_FOUND", "Class not found in the selected academic year.");
  if (!reportScopeIncludesLevel(String(classRow.jenjang_level ?? classRow.jenjang), query.scope))
    problem(404, "CLASS_NOT_FOUND", "Class is outside the selected school or program scope.");

  const scope = {
    academic_year_id: String(academicYearId), term_number: "1",
    jenjang_id: String(classRow.jenjang_id), program_id: String(classRow.program_id),
    grade_id: String(classRow.grade_id), class_id: String(classId),
  };
  const dayDetails: AttendanceDayDetail[] = [];
  let unresolvedClassEvidence = 0;
  const unknownClassDates = new Set<string>();
  const unresolvedClassEvidenceDetails: Array<{ date: string; enrollment_id: number; class_id: null }> = [];
  const basis = resolveAttendanceBasis(context, {
    academic_year_id: academicYearId, month: query.month,
    jenjang_id: String(classRow.jenjang_id), program_id: String(classRow.program_id),
    grade_id: String(classRow.grade_id), class_id: String(classId),
  }, {
    observeAttendanceDay: (value) => dayDetails.push(value),
    observeAttendanceEvidence: (date, enrollmentId, resolvedClassId) => {
      if (resolvedClassId === null) {
        unresolvedClassEvidence++; unknownClassDates.add(date);
        unresolvedClassEvidenceDetails.push({ date, enrollment_id: enrollmentId, class_id: null });
      }
    },
    allowUnresolvedClassEvidence: true,
    allowDeclaredExcess: true,
  });
  const basisClass = basis.classes.find((value) => value.class_id === classId);
  if (!basisClass) problem(404, "CLASS_NOT_FOUND", "Class has no monthly ledger scope in the selected academic year.");
  const counts = basisClass.canonical;
  const evidenceRecords = basisClass.canonical_evidence_records;
  const monthDates = datesBetween(basis.start_date, basis.end_date);
  const calendarByDate = resolveAttendanceExpectationsForDates(context, {
    academicYearId, dates: monthDates, startDate: String(classRow.academic_year_start), endDate: String(classRow.academic_year_end),
    jenjangIds: [Number(classRow.jenjang_id)],
  });
  const unknownCalendarDates: string[] = [];
  let expectedSchoolDays = 0;
  let nonSchoolDays = 0;
  for (const date of monthDates) {
    const expectation = calendarByDate.get(date)?.get(Number(classRow.jenjang_id))?.status ?? "UNKNOWN";
    if (expectation === "EXPECTED") expectedSchoolDays++;
    else if (expectation === "NOT_EXPECTED") nonSchoolDays++;
    else unknownCalendarDates.push(date);
  }

  const scanByStudentDate = machineEvidence(context, basis.start_date, basis.end_date);
  const studentByEnrollment = new Map<number, StudentTotals>();
  for (const day of dayDetails) {
    if (day.class_id === null) {
      if (day.attendance_id !== null) unknownClassDates.add(day.date);
      continue;
    }
    if (day.class_id !== classId) continue;
    let student = studentByEnrollment.get(day.enrollment_id);
    if (!student) {
      student = {
        enrollment_id: day.enrollment_id, student_name: day.student_name, expected_student_days: 0,
        effective: { present: 0, sakit: 0, izin: 0, alfa: 0, unresolved: 0 }, machine_records: [], daily_evidence: [],
        unresolved_dates: [], unknown_calendar_dates: [], contradictory_dates: [], book_totals: null,
      };
      studentByEnrollment.set(day.enrollment_id, student);
    }
    if (student.student_name === "Unknown student" && day.student_name !== "Unknown student") student.student_name = day.student_name;
    const effectiveStatus = day.effective_status;
    const machine = day.student_id === null ? undefined : scanByStudentDate.get(`${day.student_id}\u0000${day.date}`);
    if (machine) {
      student.machine_records.push(machine);
      const machinePresent = machine.status === "on-time" || machine.status === "late";
      const effectivePresent = effectiveStatus === "on-time" || effectiveStatus === "late";
      if (machinePresent && !effectivePresent) student.contradictory_dates.push(day.date);
    }
    if (day.expectation === "UNKNOWN") { student.unknown_calendar_dates.push(day.date); continue; }
    if (day.expectation !== "EXPECTED") continue;
    student.expected_student_days++;
    student.daily_evidence.push({ date: day.date, raw_status: day.raw_status, override_status: day.override_status,
      effective_status: day.effective_status, machine_recorded: machine !== undefined });
    if (effectiveStatus === "on-time" || effectiveStatus === "late") student.effective.present++;
    else if (effectiveStatus === "sakit") student.effective.sakit++;
    else if (effectiveStatus === "izin") student.effective.izin++;
    else if (effectiveStatus === "alfa") student.effective.alfa++;
    else { student.effective.unresolved++; student.unresolved_dates.push(day.date); }
  }
  const applicableUnknownCalendarDates = [...new Set([...studentByEnrollment.values()].flatMap((student) => student.unknown_calendar_dates))].sort();

  const ledgerValue = {
    state: basisClass.ledger.state, entry_mode: basisClass.ledger.entry_mode,
    sakit: basisClass.declared.sakit_student_days ?? 0,
    izin: basisClass.declared.izin_student_days ?? 0,
    alfa: basisClass.declared.alfa_student_days ?? 0,
  };
  const submitted = ledgerValue.state === "SUBMITTED";
  const reported = reportedTotals(ledgerValue, submitted);
  const ledgerByEnrollment = new Map<number, StatusCounts>();
  if (submitted && ledgerValue.entry_mode === "PER_STUDENT") {
    const studentLedger = getMonthlyClassAbsenceStudentTotals(context, academicYearId, query.month, classId);
    for (const value of studentLedger.students) ledgerByEnrollment.set(value.enrollment_id, {
      sakit: value.sakit, izin: value.izin, alfa: value.alfa,
    });
  }
  for (const [enrollmentId, student] of studentByEnrollment) student.book_totals = ledgerByEnrollment.get(enrollmentId) ?? null;

  const classNotComparableReason = applicableUnknownCalendarDates.length ? "CALENDAR_UNKNOWN"
    : unresolvedClassEvidence > 0 ? "CANONICAL_CLASS_UNRESOLVED"
      : basisClass.reconciliation.status === "NOT_AVAILABLE" || basisClass.reconciliation.status === "NOT_COMPARABLE"
        ? basisReason(basisClass.reconciliation.reason_code) : null;
  const classComparison = compare(
    { sakit: counts.sakit_count, izin: counts.izin_count, alfa: counts.alfa_count },
    reported,
    classNotComparableReason === null,
    !submitted,
    counts.expected_student_days === 0,
    classNotComparableReason,
  );
  const students: AttendanceReconciliationResponse["students"] = [...studentByEnrollment.values()].map((student) => {
    student.book_totals = submitted && ledgerValue.entry_mode === "PER_STUDENT" ? student.book_totals : null;
    const comparison = studentComparison(student, ledgerValue.state, ledgerValue.entry_mode);
    const differences = student.book_totals ? {
      sakit: student.effective.sakit - student.book_totals.sakit,
      izin: student.effective.izin - student.book_totals.izin,
      alfa: student.effective.alfa - student.book_totals.alfa,
    } : { sakit: null, izin: null, alfa: null };
    const reviewDates = [...new Set([
      ...student.unresolved_dates, ...student.unknown_calendar_dates, ...student.contradictory_dates,
    ])].sort();
    const firstReviewDate = reviewDates[0] ?? null;
    return {
      enrollment_id: student.enrollment_id, student_name: student.student_name,
      expected_student_days: student.expected_student_days,
      machine_records: student.machine_records.sort((left, right) => left.date.localeCompare(right.date)),
      daily_evidence: student.daily_evidence.sort((left, right) => left.date.localeCompare(right.date)),
      effective: student.effective,
      book_totals: student.book_totals ?? { sakit: null, izin: null, alfa: null }, differences, comparison,
      unresolved_dates: student.unresolved_dates.sort(), unknown_calendar_dates: student.unknown_calendar_dates.sort(),
      contradictory_dates: student.contradictory_dates.sort(), first_review_date: firstReviewDate,
    };
  }).sort((left, right) => {
    const priority = (value: typeof left) => value.contradictory_dates.length > 0 ? 0
      : value.unresolved_dates.length > 0 || value.unknown_calendar_dates.length > 0 ? 1
        : value.comparison.status === "MISMATCH" ? 2 : 3;
    return priority(left) - priority(right) || left.student_name.localeCompare(right.student_name) || left.enrollment_id - right.enrollment_id;
  });

  const machineRecordedStudentDays = students.reduce((sum, student) => sum + student.machine_records.length, 0);
  const unresolvedStudentDays = students.reduce((sum, student) => sum + student.effective.unresolved, 0);
  const contradictoryStudentDays = students.reduce((sum, student) => sum + student.contradictory_dates.length, 0);
  const matchingStudents = students.filter((value) => value.comparison.status === "MATCH").length;
  const mismatchedStudents = students.filter((value) => value.comparison.status === "MISMATCH").length;
  const studentsNeedingReview = students.filter((value) => value.unresolved_dates.length > 0
    || value.unknown_calendar_dates.length > 0 || value.contradictory_dates.length > 0
    || value.comparison.status === "MISMATCH").length;
  const evidenceStatus = contradictoryStudentDays > 0 || mismatchedStudents > 0 || classComparison.status === "MISMATCH" ? "CONTRADICTORY"
    : unresolvedStudentDays > 0 || applicableUnknownCalendarDates.length > 0 || unresolvedClassEvidence > 0 || classComparison.status !== "MATCH" ? "INCOMPLETE"
      : "CLEAR";

  const result: Omit<AttendanceReconciliationResponse, "review"> = {
    academic_year: { id: basis.academic_year_id, label: basis.academic_year_label, start_date: String(classRow.academic_year_start), end_date: String(classRow.academic_year_end) },
    class: { id: classId, name: String(classRow.class_name), grade: String(classRow.grade), program: String(classRow.program), jenjang: String(classRow.jenjang) },
    month: query.month, scope: query.scope,
    period: { start_date: basis.start_date, end_date: basis.end_date },
    calendar: { expected_school_days: expectedSchoolDays, non_school_days: nonSchoolDays, unknown_dates: unknownCalendarDates },
    canonical: counts,
    machine_evidence: { coverage_status: "NOT_TRACKED", recorded_student_days: machineRecordedStudentDays },
    ledger: {
      state: ledgerValue.state, entry_mode: ledgerValue.entry_mode,
      reported: reported ? { sakit: reported.sakit, izin: reported.izin, alfa: reported.alfa } : { sakit: null, izin: null, alfa: null },
      comparison: classComparison,
    },
    evidence: {
      status: evidenceStatus, unresolved_student_days: unresolvedStudentDays,
      contradictory_student_days: contradictoryStudentDays, unresolved_class_evidence: unresolvedClassEvidence,
      unknown_calendar_dates: applicableUnknownCalendarDates.length ? applicableUnknownCalendarDates : [...unknownClassDates].sort(),
    },
    summary: {
      applicable_students: students.length, students_needing_review: studentsNeedingReview,
      matching_students: matchingStudents, mismatched_students: mismatchedStudents,
      unresolved_student_days: unresolvedStudentDays, missing_book_reports: submitted ? 0 : 1,
      machine_recorded_student_days: machineRecordedStudentDays, contradictory_student_days: contradictoryStudentDays,
    },
    students,
  };
  const fingerprint = evidenceReference(context, {
    academicYearId, classId, month: query.month, start: basis.start_date, end: basis.end_date,
    jenjangId: Number(classRow.jenjang_id), className: String(classRow.class_name),
    gradeId: Number(classRow.grade_id), programId: Number(classRow.program_id), dayDetails,
    unknownClassEvidence: unresolvedClassEvidenceDetails, calendarByDate, students: [...studentByEnrollment.values()],
  });
  return { ...result, review: projectedReview(context, {
    academicYearId, classId, month: query.month, evidenceVersion: fingerprint.version, evidenceReferences: fingerprint.references,
  }) };
}

function reviewMutation(context: AuthContext, user: { username: string; role: string }, input: AttendanceReviewMutation | AttendanceReviewReopen, action: "DECISION" | "REOPEN"): AttendanceReconciliationResponse {
  const academicYearId = Number(input.academic_year_id);
  const classId = Number(input.class_id);
  const query: AttendanceReconciliationQuery = {
    academic_year_id: input.academic_year_id, class_id: input.class_id, month: input.month, scope: input.scope,
  };
  const note = action === "REOPEN" ? (input as AttendanceReviewReopen).reason.trim()
    : (input as AttendanceReviewMutation).note?.trim() || null;
  if ((action === "REOPEN" || (input as AttendanceReviewMutation).decision === "REVIEWED_WITH_ISSUES") && (!note || note.length < 5))
    problem(422, "ATTENDANCE_REVIEW_NOTE_REQUIRED", "Enter a review note of at least five characters.");

  inTransaction(context.database.client, () => {
    const current = resolveAttendanceReconciliation(context, query);
    if (input.evidence_version !== current.review.evidence_version)
      problem(409, "ATTENDANCE_REVIEW_STALE_EVIDENCE", "Attendance evidence changed. Refresh the reconciliation before recording this review.");
    const latest = current.review.history.at(-1);
    const requestedAction = action === "REOPEN" ? "REOPENED" : (input as AttendanceReviewMutation).decision;
    const previousRevision = input.expected_revision;
    if (current.review.revision !== previousRevision) {
      if (latest && latest.previous_revision === previousRevision && latest.action === requestedAction
        && latest.actor === user.username && latest.note === note && latest.evidence_version === input.evidence_version) return;
      problem(409, "ATTENDANCE_REVIEW_STALE_REVISION", "Another review decision was recorded. Refresh the review history and try again.");
    }
    if (action === "REOPEN" && (!latest || latest.action === "REOPENED"))
      problem(409, "ATTENDANCE_REVIEW_NOT_OPEN", "There is no completed review to reopen.");
    if (action === "DECISION" && (input as AttendanceReviewMutation).decision === "REVIEWED" && current.evidence.status !== "CLEAR")
      problem(409, "ATTENDANCE_REVIEW_ISSUES_REMAIN", "Outstanding or incomplete evidence must be documented as reviewed with issues.");

    const revision = previousRevision + 1;
    const metadata: AttendanceReviewEventMetadata = {
      version: 1, academic_year_id: academicYearId, class_id: classId, month: input.month,
      revision, previous_revision: previousRevision, action,
      decision: action === "REOPEN" ? null : (input as AttendanceReviewMutation).decision,
      evidence_version: current.review.evidence_version,
      evidence_references: current.review.evidence_references,
    };
    if (!Value.Check(AttendanceReviewEventMetadataSchema, metadata))
      problem(500, "ATTENDANCE_REVIEW_METADATA_INVALID", "Attendance review evidence could not be recorded safely.");
    context.database.client.run(`INSERT INTO operations_audit_events
      (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, reason, success, metadata, schema_version)
      VALUES (?, ?, ?, 'manage_attendance_review', 'ATTENDANCE_MONTH_REVIEW', ?, ?, 'MEDIUM', 'API', ?, 1, ?, '1')`, [
      randomUUID(), user.username, user.role, reviewEntityReference(academicYearId, classId, input.month),
      action === "REOPEN" ? "ATTENDANCE_REVIEW_REOPENED" : "ATTENDANCE_REVIEW_DECIDED", note, JSON.stringify(metadata),
    ]);
  });
  return resolveAttendanceReconciliation(context, query);
}

export function attendanceReconciliationRoutes(app: any, context: AuthContext): void {
  app.get("/api/attendance/reconciliation", (ctx: any) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Insufficient permissions" };
    try { return resolveAttendanceReconciliation(context, ctx.query); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "ATTENDANCE_RECONCILIATION_FAILED",
        message: ctx.set.status === 500 ? "Monthly attendance reconciliation could not be loaded." : cause instanceof Error ? cause.message : "Invalid reconciliation scope." } };
    }
  }, { query: AttendanceReconciliationQuerySchema, response: AttendanceReconciliationResponseSchema });
  app.post("/api/attendance/reconciliation/review", (ctx: any) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Insufficient permissions" };
    try { return reviewMutation(context, user, ctx.body, "DECISION"); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "ATTENDANCE_REVIEW_FAILED",
        message: ctx.set.status === 500 ? "Monthly attendance review could not be recorded." : cause instanceof Error ? cause.message : "Invalid review request." } };
    }
  }, { body: AttendanceReviewMutationSchema, response: AttendanceReconciliationResponseSchema });
  app.post("/api/attendance/reconciliation/reopen", (ctx: any) => {
    const user = actor(context, ctx, { role: "admin" });
    if (!user) return { detail: "Insufficient permissions" };
    try { return reviewMutation(context, user, ctx.body, "REOPEN"); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "ATTENDANCE_REVIEW_FAILED",
        message: ctx.set.status === 500 ? "Monthly attendance review could not be reopened." : cause instanceof Error ? cause.message : "Invalid reopen request." } };
    }
  }, { body: AttendanceReviewReopenSchema, response: AttendanceReconciliationResponseSchema });
}
