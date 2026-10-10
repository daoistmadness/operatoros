import { Type, type Static } from "@sinclair/typebox";
import { ReportScopeSchema } from "../reports";
import { TermAttendanceCountsSchema } from "./term-attendance";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const Month = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" });
const Date = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const Count = Type.Integer({ minimum: 0 });
const NullableCount = Type.Union([Count, Type.Null()]);
const ComparisonStatus = Type.Union([
  Type.Literal("NOT_REPORTED"), Type.Literal("NOT_COMPARABLE"), Type.Literal("MATCH"), Type.Literal("MISMATCH"),
]);
const Reason = Type.Union([
  Type.Literal("LEDGER_NOT_SUBMITTED"), Type.Literal("CLASS_TOTALS_ONLY"), Type.Literal("NO_EXPECTED_STUDENT_DAYS"),
  Type.Literal("NO_CANONICAL_EVIDENCE"),
  Type.Literal("CANONICAL_COVERAGE_INCOMPLETE"), Type.Literal("CANONICAL_STATUS_UNRESOLVED"),
  Type.Literal("CALENDAR_UNKNOWN"), Type.Literal("CANONICAL_CLASS_UNRESOLVED"), Type.Literal("SIA_REASON_MISMATCH"),
  Type.Null(),
]);
const SiaTotals = Type.Object({ sakit: NullableCount, izin: NullableCount, alfa: NullableCount });
const DeltaTotals = Type.Object({ sakit: Type.Union([Type.Integer(), Type.Null()]), izin: Type.Union([Type.Integer(), Type.Null()]), alfa: Type.Union([Type.Integer(), Type.Null()]) });

export const AttendanceReconciliationQuerySchema = Type.Object({
  academic_year_id: Id,
  class_id: Id,
  month: Month,
  scope: ReportScopeSchema,
});

export const AttendanceReconciliationResponseSchema = Type.Object({
  academic_year: Type.Object({ id: Type.Integer({ minimum: 1 }), label: Type.String(), start_date: Date, end_date: Date }),
  class: Type.Object({
    id: Type.Integer({ minimum: 1 }), name: Type.String(), grade: Type.String(),
    program: Type.String(), jenjang: Type.String(),
  }),
  month: Month,
  scope: ReportScopeSchema,
  period: Type.Object({ start_date: Date, end_date: Date }),
  calendar: Type.Object({
    expected_school_days: Count,
    non_school_days: Count,
    unknown_dates: Type.Array(Date),
  }),
  canonical: TermAttendanceCountsSchema,
  machine_evidence: Type.Object({
    coverage_status: Type.Literal("NOT_TRACKED"),
    recorded_student_days: Count,
  }),
  ledger: Type.Object({
    state: Type.Union([Type.Literal("MISSING"), Type.Literal("OPEN"), Type.Literal("SUBMITTED")]),
    entry_mode: Type.Union([Type.Literal("TOTALS_ONLY"), Type.Literal("PER_STUDENT"), Type.Null()]),
    reported: SiaTotals,
    comparison: Type.Object({ status: ComparisonStatus, reason_code: Reason, differences: DeltaTotals }),
  }),
  evidence: Type.Object({
    status: Type.Union([Type.Literal("CLEAR"), Type.Literal("INCOMPLETE"), Type.Literal("CONTRADICTORY")]),
    unresolved_student_days: Count,
    contradictory_student_days: Count,
    unresolved_class_evidence: Count,
    unknown_calendar_dates: Type.Array(Date),
  }),
  summary: Type.Object({
    applicable_students: Count,
    students_needing_review: Count,
    matching_students: Count,
    mismatched_students: Count,
    unresolved_student_days: Count,
    missing_book_reports: Count,
    machine_recorded_student_days: Count,
    contradictory_student_days: Count,
  }),
  students: Type.Array(Type.Object({
    enrollment_id: Type.Integer({ minimum: 1 }),
    student_name: Type.String({ minLength: 1 }),
    expected_student_days: Count,
    machine_records: Type.Array(Type.Object({
      date: Date, status: Type.String(), scan_in: Type.Union([Type.String(), Type.Null()]),
      scan_out: Type.Union([Type.String(), Type.Null()]),
      source_state: Type.Union([Type.Literal("APPLIED"), Type.Literal("UNCHANGED"), Type.Literal("CONFLICT")]),
    })),
    daily_evidence: Type.Array(Type.Object({
      date: Date, raw_status: Type.Union([Type.String(), Type.Null()]),
      override_status: Type.Union([Type.String(), Type.Null()]),
      effective_status: Type.Union([Type.String(), Type.Null()]),
      machine_recorded: Type.Boolean(),
    })),
    effective: Type.Object({ present: Count, sakit: Count, izin: Count, alfa: Count, unresolved: Count }),
    book_totals: SiaTotals,
    differences: DeltaTotals,
    comparison: Type.Object({ status: ComparisonStatus, reason_code: Reason }),
    unresolved_dates: Type.Array(Date),
    unknown_calendar_dates: Type.Array(Date),
    contradictory_dates: Type.Array(Date),
    first_review_date: Type.Union([Date, Type.Null()]),
  }, { additionalProperties: false })),
});

export type AttendanceReconciliationQuery = Static<typeof AttendanceReconciliationQuerySchema>;
export type AttendanceReconciliationResponse = Static<typeof AttendanceReconciliationResponseSchema>;
