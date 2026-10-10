import {
  AttendanceBasisQuerySchema,
  AttendanceBasisResponseSchema,
  type AttendanceBasisClass,
  type AttendanceBasisQuery,
  type AttendanceBasisResponse,
} from "@operatoros/contracts/analytics";
import type { AuthContext } from "../auth/service";
import { actor } from "./core";
import { getMonthlyClassAbsenceTotals } from "./manual-absence";
import { emptyTermAttendanceCounts, termAttendanceForRange, type AttendanceDayObserver, type AttendanceEvidenceObserver } from "./term-attendance";
import { tallyLatenessRange } from "./term-lateness";

type Row = Record<string, any>;

function one(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function problem(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function monthRange(context: AuthContext, academicYearId: number, month: string): { year: Row; start_date: string; end_date: string } {
  const year = one(context, "SELECT id,label,start_date,end_date FROM academic_years WHERE id=?", [academicYearId]);
  if (!year) problem(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found.");
  const [yearNumber, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const start_date = monthStart > String(year.start_date) ? monthStart : String(year.start_date);
  const end_date = monthEnd < String(year.end_date) ? monthEnd : String(year.end_date);
  if (start_date > end_date) problem(422, "MONTH_OUTSIDE_ACADEMIC_YEAR", "Month does not overlap the selected academic year.");
  return { year, start_date, end_date };
}

function emptyReconciliation(status: "NOT_AVAILABLE" | "NOT_COMPARABLE", reason_code: AttendanceBasisClass["reconciliation"]["reason_code"]) {
  return { status, reason_code };
}

export function resolveAttendanceBasis(
  context: AuthContext,
  query: Omit<AttendanceBasisQuery, "academic_year_id"> & { academic_year_id: number },
  options: {
    observeAttendanceDay?: AttendanceDayObserver;
    observeAttendanceEvidence?: AttendanceEvidenceObserver;
    allowUnresolvedClassEvidence?: boolean;
    allowDeclaredExcess?: boolean;
  } = {},
): AttendanceBasisResponse {
  const academicYearId = Number(query.academic_year_id);
  const range = monthRange(context, academicYearId, query.month);
  const manual = getMonthlyClassAbsenceTotals(context, academicYearId, query.month, {
    jenjang_id: query.jenjang_id === undefined ? undefined : Number(query.jenjang_id),
    program_id: query.program_id === undefined ? undefined : Number(query.program_id),
  });
  const termQuery = {
    academic_year_id: String(academicYearId), term_number: "1",
    jenjang_id: query.jenjang_id, program_id: query.program_id,
    grade_id: query.grade_id, class_id: query.class_id,
  };
  const canonical = termAttendanceForRange(context, termQuery, range, options.observeAttendanceDay, options.observeAttendanceEvidence);
  const unresolvedEvidence = canonical.evidence_by_class.get(null) ?? 0;
  if (unresolvedEvidence > 0 && !options.allowUnresolvedClassEvidence)
    problem(409, "CANONICAL_CLASS_UNRESOLVED", "Canonical attendance exists in the selected scope, but its historical class cannot be resolved.");
  const lateness = tallyLatenessRange(context, {
    startDate: range.start_date, endDate: range.end_date, academicYearId,
    scope: {
      jenjang_id: query.jenjang_id === undefined ? null : Number(query.jenjang_id),
      program_id: query.program_id === undefined ? null : Number(query.program_id),
      grade_id: query.grade_id === undefined ? null : Number(query.grade_id),
      class_id: query.class_id === undefined ? null : Number(query.class_id),
    },
  });
  const attendanceByClass = new Map(canonical.attendance.classes
    .filter((value) => value.class_id !== null)
    .map((value) => [Number(value.class_id), value.totals]));
  const classes = manual.classes.filter((value) =>
    (query.grade_id === undefined || value.grade_id === Number(query.grade_id))
    && (query.class_id === undefined || value.class_id === Number(query.class_id)));
  if (query.class_id !== undefined && !classes.length)
    problem(404, "CLASS_NOT_FOUND", "Class not found in the selected academic year and scope.");

  const resultClasses: AttendanceBasisClass[] = classes.map((value) => {
    const counts = attendanceByClass.get(value.class_id) ?? emptyTermAttendanceCounts();
    const evidenceRecords = canonical.evidence_by_class.get(value.class_id) ?? 0;
    const submitted = value.state === "SUBMITTED";
    const declared = {
      sakit_student_days: submitted ? value.sakit : null,
      izin_student_days: submitted ? value.izin : null,
      alfa_student_days: submitted ? value.alfa : null,
    };
    const declaredTotal = submitted ? value.sakit + value.izin + value.alfa : null;
    if (declaredTotal !== null && declaredTotal > counts.expected_student_days && !options.allowDeclaredExcess)
      problem(409, "DECLARED_ABSENCE_EXCEEDS_EXPECTED_DAYS", `Submitted class S/I/A total ${declaredTotal} exceeds ${counts.expected_student_days} known Expected Student-Days for ${value.class_name} in ${query.month}.`);
    const draft = value.state === "OPEN" ? {
      sakit_student_days: value.sakit, izin_student_days: value.izin, alfa_student_days: value.alfa,
    } : null;
    const draftTotal = draft ? draft.sakit_student_days + draft.izin_student_days + draft.alfa_student_days : null;
    let draftReconciliation: AttendanceBasisClass["draft_reconciliation"] = null;
    let draftConflict: AttendanceBasisClass["draft_conflict"] = null;
    if (draftTotal !== null) {
      if (draftTotal > counts.expected_student_days)
        draftReconciliation = emptyReconciliation("NOT_COMPARABLE", "DECLARED_ABSENCE_EXCEEDS_EXPECTED_DAYS");
      else if (evidenceRecords === 0) draftReconciliation = emptyReconciliation("NOT_AVAILABLE", "NO_CANONICAL_EVIDENCE");
      else if (counts.expected_student_days === 0) draftReconciliation = emptyReconciliation("NOT_COMPARABLE", "NO_EXPECTED_STUDENT_DAYS");
      else if (counts.recorded_student_days !== counts.expected_student_days) draftReconciliation = emptyReconciliation("NOT_COMPARABLE", "CANONICAL_COVERAGE_INCOMPLETE");
      else if (counts.other_status_count > 0) draftReconciliation = emptyReconciliation("NOT_COMPARABLE", "CANONICAL_STATUS_UNRESOLVED");
      else {
        const canonicalNonHadir = counts.expected_student_days - counts.hadir_count;
        const delta = draftTotal - canonicalNonHadir;
        draftReconciliation = { status: delta === 0 ? "MATCH" : "CONFLICT", reason_code: delta === 0 ? null : "ABSENCE_TOTAL_MISMATCH" };
        if (delta !== 0) draftConflict = {
          class_id: value.class_id, class_name: value.class_name, month: query.month,
          canonical_non_hadir_student_days: canonicalNonHadir,
          declared_absence_student_days: draftTotal, delta_student_days: delta,
          reason_code: "ABSENCE_TOTAL_MISMATCH",
        };
      }
    }

    const basis: AttendanceBasisClass["basis"] = evidenceRecords > 0 ? "OBSERVED" : submitted ? "DECLARED" : "NOT_REPORTED";
    const resolved = basis === "OBSERVED" ? {
      hadir_student_days: counts.hadir_count,
      sakit_student_days: counts.sakit_count,
      izin_student_days: counts.izin_count,
      alfa_student_days: counts.alfa_count,
    } : basis === "DECLARED" ? {
      hadir_student_days: counts.expected_student_days - declaredTotal!,
      sakit_student_days: declared.sakit_student_days,
      izin_student_days: declared.izin_student_days,
      alfa_student_days: declared.alfa_student_days,
    } : {
      hadir_student_days: null, sakit_student_days: null, izin_student_days: null, alfa_student_days: null,
    };
    const presumedHadir = basis === "DECLARED" ? counts.expected_student_days - declaredTotal! : null;

    const classCutoffs = [...lateness.cutoffs.values()].filter((cutoff) => cutoff.jenjang_id === value.jenjang_id);
    const cutoffUnavailable = classCutoffs.length === 0 || classCutoffs.some((cutoff) => cutoff.source === "UNCONFIGURED");
    const latenessAvailable = basis === "OBSERVED" && !cutoffUnavailable;
    const lateTally = lateness.byClass.get(`id:${value.class_id}`);

    let reconciliation: AttendanceBasisClass["reconciliation"];
    let conflict: AttendanceBasisClass["conflict"] = null;
    if (!submitted) reconciliation = emptyReconciliation("NOT_AVAILABLE", "LEDGER_NOT_SUBMITTED");
    else if (evidenceRecords === 0) reconciliation = emptyReconciliation("NOT_AVAILABLE", "NO_CANONICAL_EVIDENCE");
    else if (counts.expected_student_days === 0) reconciliation = emptyReconciliation("NOT_COMPARABLE", "NO_EXPECTED_STUDENT_DAYS");
    else if (counts.recorded_student_days !== counts.expected_student_days) reconciliation = emptyReconciliation("NOT_COMPARABLE", "CANONICAL_COVERAGE_INCOMPLETE");
    else if (counts.other_status_count > 0) reconciliation = emptyReconciliation("NOT_COMPARABLE", "CANONICAL_STATUS_UNRESOLVED");
    else {
      const canonicalNonHadir = counts.expected_student_days - counts.hadir_count;
      const delta = declaredTotal! - canonicalNonHadir;
      reconciliation = { status: delta === 0 ? "MATCH" : "CONFLICT", reason_code: delta === 0 ? null : "ABSENCE_TOTAL_MISMATCH" };
      if (delta !== 0) conflict = {
        class_id: value.class_id, class_name: value.class_name, month: query.month,
        canonical_non_hadir_student_days: canonicalNonHadir,
        declared_absence_student_days: declaredTotal!, delta_student_days: delta,
        reason_code: "ABSENCE_TOTAL_MISMATCH",
      };
    }

    return {
      class_id: value.class_id, class_name: value.class_name,
      grade_id: value.grade_id, grade: value.grade,
      program_id: value.program_id, program: value.program,
      jenjang_id: value.jenjang_id, jenjang: value.jenjang,
      month: query.month, basis, canonical_evidence_records: evidenceRecords,
      canonical: counts,
      ledger: { state: value.state, entry_mode: value.entry_mode },
      declared, draft, draft_reconciliation: draftReconciliation, draft_conflict: draftConflict,
      resolved, presumed_hadir_student_days: presumedHadir,
      lateness: {
        availability: latenessAvailable ? "AVAILABLE" : "UNAVAILABLE",
        reason_code: latenessAvailable ? null : basis !== "OBSERVED" ? "NO_CANONICAL_EVIDENCE" : "CUTOFF_POLICY_UNCONFIGURED",
        late_events: latenessAvailable ? lateTally?.late_events ?? 0 : null,
      },
      reconciliation, conflict,
    };
  });

  return {
    academic_year_id: Number(range.year.id), academic_year_label: String(range.year.label),
    month: query.month, start_date: range.start_date, end_date: range.end_date,
    classes: resultClasses,
    cutoffs: [...lateness.cutoffs.values()],
    quality: {
      unknown_calendar_dates: canonical.attendance.quality.unknown_calendar_dates,
      unknown_calendar_student_days: canonical.attendance.quality.unknown_calendar_student_days,
      unresolved_class_student_days: canonical.attendance.quality.unresolved_class_student_days,
      other_status_student_days: canonical.attendance.quality.other_status_student_days,
    },
  };
}

export function attendanceBasisRoutes(app: any, context: AuthContext): void {
  app.get("/api/analytics/attendance/basis", (ctx: any) => {
    if (!actor(context, ctx, { capability: "view_attendance" })) return { detail: "Insufficient permissions" };
    try { return resolveAttendanceBasis(context, { ...ctx.query, academic_year_id: Number(ctx.query.academic_year_id) }); }
    catch (cause) {
      ctx.set.status = cause instanceof Error && "status" in cause ? Number(cause.status) : 500;
      return { detail: { code: cause instanceof Error && "code" in cause ? String(cause.code) : "ATTENDANCE_BASIS_FAILED",
        message: ctx.set.status === 500 ? "Attendance basis could not be resolved." : cause instanceof Error ? cause.message : "Invalid attendance basis request." } };
    }
  }, { query: AttendanceBasisQuerySchema, response: AttendanceBasisResponseSchema });
}
