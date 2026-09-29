import { Type, type Static } from "@sinclair/typebox";
import { TermAttendanceCountsSchema } from "./term-attendance";
import { TermLatenessCutoffSchema } from "./term-lateness";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const Month = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" });
const Count = Type.Integer({ minimum: 0 });
const NullableCount = Type.Union([Count, Type.Null()]);
const Basis = Type.Union([Type.Literal("OBSERVED"), Type.Literal("DECLARED"), Type.Literal("NOT_REPORTED")]);
const LedgerState = Type.Union([Type.Literal("MISSING"), Type.Literal("OPEN"), Type.Literal("SUBMITTED")]);
const EntryMode = Type.Union([Type.Literal("TOTALS_ONLY"), Type.Literal("PER_STUDENT"), Type.Null()]);
const ReconciliationReason = Type.Union([
  Type.Literal("NO_CANONICAL_EVIDENCE"),
  Type.Literal("LEDGER_NOT_SUBMITTED"),
  Type.Literal("NO_EXPECTED_STUDENT_DAYS"),
  Type.Literal("CANONICAL_COVERAGE_INCOMPLETE"),
  Type.Literal("CANONICAL_STATUS_UNRESOLVED"),
  Type.Literal("DECLARED_ABSENCE_EXCEEDS_EXPECTED_DAYS"),
  Type.Literal("ABSENCE_TOTAL_MISMATCH"),
]);

export const AttendanceBasisQuerySchema = Type.Object({
  academic_year_id: Id,
  month: Month,
  jenjang_id: Type.Optional(Id),
  program_id: Type.Optional(Id),
  grade_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
});

export const AttendanceBasisConflictSchema = Type.Object({
  class_id: Type.Number({ minimum: 1 }),
  class_name: Type.String(),
  month: Month,
  canonical_non_hadir_student_days: Count,
  declared_absence_student_days: Count,
  delta_student_days: Type.Integer(),
  reason_code: Type.Literal("ABSENCE_TOTAL_MISMATCH"),
});

export const AttendanceBasisClassSchema = Type.Object({
  class_id: Type.Number({ minimum: 1 }),
  class_name: Type.String(),
  grade_id: Type.Number({ minimum: 1 }),
  grade: Type.String(),
  program_id: Type.Number({ minimum: 1 }),
  program: Type.String(),
  jenjang_id: Type.Number({ minimum: 1 }),
  jenjang: Type.String(),
  month: Month,
  basis: Basis,
  canonical_evidence_records: Count,
  canonical: TermAttendanceCountsSchema,
  ledger: Type.Object({ state: LedgerState, entry_mode: EntryMode }),
  declared: Type.Object({
    sakit_student_days: NullableCount,
    izin_student_days: NullableCount,
    alfa_student_days: NullableCount,
  }),
  draft: Type.Union([Type.Object({
    sakit_student_days: Count,
    izin_student_days: Count,
    alfa_student_days: Count,
  }), Type.Null()]),
  draft_reconciliation: Type.Union([Type.Object({
    status: Type.Union([Type.Literal("NOT_AVAILABLE"), Type.Literal("NOT_COMPARABLE"), Type.Literal("MATCH"), Type.Literal("CONFLICT")]),
    reason_code: Type.Union([ReconciliationReason, Type.Null()]),
  }), Type.Null()]),
  draft_conflict: Type.Union([AttendanceBasisConflictSchema, Type.Null()]),
  resolved: Type.Object({
    hadir_student_days: NullableCount,
    sakit_student_days: NullableCount,
    izin_student_days: NullableCount,
    alfa_student_days: NullableCount,
  }),
  presumed_hadir_student_days: NullableCount,
  lateness: Type.Object({
    availability: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("UNAVAILABLE")]),
    reason_code: Type.Union([Type.Literal("NO_CANONICAL_EVIDENCE"), Type.Literal("CUTOFF_POLICY_UNCONFIGURED"), Type.Null()]),
    late_events: NullableCount,
  }),
  reconciliation: Type.Object({
    status: Type.Union([Type.Literal("NOT_AVAILABLE"), Type.Literal("NOT_COMPARABLE"), Type.Literal("MATCH"), Type.Literal("CONFLICT")]),
    reason_code: Type.Union([ReconciliationReason, Type.Null()]),
  }),
  conflict: Type.Union([AttendanceBasisConflictSchema, Type.Null()]),
});

export const AttendanceBasisResponseSchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  academic_year_label: Type.String(),
  month: Month,
  start_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  end_date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  classes: Type.Array(AttendanceBasisClassSchema),
  cutoffs: Type.Array(TermLatenessCutoffSchema),
  quality: Type.Object({
    unknown_calendar_dates: Type.Array(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    unknown_calendar_student_days: Count,
    unresolved_class_student_days: Count,
    other_status_student_days: Count,
  }),
});

export type AttendanceBasisQuery = Static<typeof AttendanceBasisQuerySchema>;
export type AttendanceBasisConflict = Static<typeof AttendanceBasisConflictSchema>;
export type AttendanceBasisClass = Static<typeof AttendanceBasisClassSchema>;
export type AttendanceBasisResponse = Static<typeof AttendanceBasisResponseSchema>;
