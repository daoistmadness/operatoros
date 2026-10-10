import {
  AttendanceReconciliationQuerySchema,
  AttendanceReconciliationResponseSchema,
  type AttendanceReconciliationQuery,
  type AttendanceReconciliationResponse,
} from "@operatoros/contracts/analytics";
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
  const basis = resolveAttendanceBasis(context, {
    academic_year_id: academicYearId, month: query.month,
    jenjang_id: String(classRow.jenjang_id), program_id: String(classRow.program_id),
    grade_id: String(classRow.grade_id), class_id: String(classId),
  }, {
    observeAttendanceDay: (value) => dayDetails.push(value),
    observeAttendanceEvidence: (date, _enrollmentId, resolvedClassId) => {
      if (resolvedClassId === null) { unresolvedClassEvidence++; unknownClassDates.add(date); }
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
  const students = [...studentByEnrollment.values()].map((student) => {
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

  return {
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
}
