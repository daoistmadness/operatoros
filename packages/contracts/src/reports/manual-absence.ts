import { Type, type Static } from "@sinclair/typebox";
import { AttendanceBasisClassSchema } from "../analytics/attendance-basis";
import { TermAttendanceCountsSchema } from "../analytics/term-attendance";

const MonthKey = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" });
const NullableCount = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
const PositiveId = Type.Number({ minimum: 1 });

export const ManualAbsenceQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  month: MonthKey,
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  program_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

export const ManualAbsenceClassSchema = Type.Object({
  class_id: PositiveId,
  class_name: Type.String(),
  grade_id: PositiveId,
  grade: Type.String(),
  program_id: PositiveId,
  program: Type.String(),
  jenjang_id: PositiveId,
  jenjang: Type.String(),
  sakit: Type.Integer({ minimum: 0 }),
  izin: Type.Integer({ minimum: 0 }),
  alfa: Type.Integer({ minimum: 0 }),
  has_data: Type.Boolean(),
  state: Type.Union([Type.Literal("MISSING"), Type.Literal("OPEN"), Type.Literal("SUBMITTED")]),
  entry_mode: Type.Union([Type.Literal("TOTALS_ONLY"), Type.Literal("PER_STUDENT"), Type.Null()]),
  is_locked: Type.Boolean(),
  expected_student_days: Type.Integer({ minimum: 0 }),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const ManualAbsenceMonthlyResponseSchema = Type.Object({
  academic_year_id: PositiveId,
  academic_year_label: Type.String(),
  month: MonthKey,
  classes: Type.Array(ManualAbsenceClassSchema),
});

export const ManualAbsenceStudentTotalsQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  month: MonthKey,
  class_id: Type.String({ pattern: "^[1-9]\\d*$" }),
});

export const ManualAbsenceStudentTotalsResponseSchema = Type.Object({
  academic_year_id: PositiveId,
  month: MonthKey,
  class_id: PositiveId,
  students: Type.Array(Type.Object({
    enrollment_id: PositiveId,
    student_name: Type.String(),
    expected_student_days: Type.Integer({ minimum: 0 }),
    sakit: Type.Integer({ minimum: 0 }),
    izin: Type.Integer({ minimum: 0 }),
    alfa: Type.Integer({ minimum: 0 }),
  })),
});

export const LegacyAbsenceReasonsQuerySchema = Type.Object({ month: MonthKey });

export const LegacyAbsenceReasonsResponseSchema = Type.Object({
  month: MonthKey,
  rows: Type.Array(Type.Object({
    student_name: Type.String(),
    class_name: Type.Union([Type.String(), Type.Null()]),
    sakit: Type.Integer({ minimum: 0 }),
    izin: Type.Integer({ minimum: 0 }),
    alfa: Type.Integer({ minimum: 0 }),
  })),
});

export const ManualAbsenceSaveRequestSchema = Type.Object({
  academic_year_id: PositiveId,
  month: MonthKey,
  jenjang_id: Type.Optional(PositiveId),
  program_id: Type.Optional(PositiveId),
  classes: Type.Array(Type.Object({
    class_id: PositiveId,
    entry_mode: Type.Optional(Type.Union([Type.Literal("TOTALS_ONLY"), Type.Literal("PER_STUDENT")])),
    sakit: Type.Optional(Type.Integer({ minimum: 0 })),
    izin: Type.Optional(Type.Integer({ minimum: 0 })),
    alfa: Type.Optional(Type.Integer({ minimum: 0 })),
    student_totals: Type.Optional(Type.Array(Type.Object({
      enrollment_id: PositiveId,
      sakit: Type.Integer({ minimum: 0 }),
      izin: Type.Integer({ minimum: 0 }),
      alfa: Type.Integer({ minimum: 0 }),
    }))),
    change_reason: Type.Optional(Type.String({ minLength: 5, maxLength: 1000 })),
  }), { minItems: 1 }),
});

export const ManualAbsenceSaveResponseSchema = Type.Object({
  inserted: Type.Integer({ minimum: 0 }),
  updated: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
  state: Type.Literal("OPEN"),
});

export const ManualAbsenceLedgerActionRequestSchema = Type.Object({
  academic_year_id: PositiveId,
  month: MonthKey,
  class_id: PositiveId,
});

export const ManualAbsenceLedgerReopenRequestSchema = Type.Object({
  academic_year_id: PositiveId,
  month: MonthKey,
  class_id: PositiveId,
  reason: Type.String({ minLength: 5, maxLength: 1000 }),
});

export const ManualAbsenceLedgerActionResponseSchema = Type.Object({
  academic_year_id: PositiveId,
  class_id: PositiveId,
  month: MonthKey,
  state: Type.Union([Type.Literal("OPEN"), Type.Literal("SUBMITTED")]),
  revision_no: Type.Integer({ minimum: 1 }),
});

export const AttendanceReportQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  period_type: Type.Union([
    Type.Literal("month"), Type.Literal("term"), Type.Literal("bimonthly"), Type.Literal("semester"), Type.Literal("yearly"), Type.Literal("date_range"),
  ]),
  period: Type.String(),
  start_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  end_date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  program_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  class_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

export const ManualAbsenceAggregateSchema = Type.Object({
  source: Type.Literal("manual_monthly_class_totals"),
  period_policy: Type.Literal("include_full_intersecting_months"),
  completeness: Type.Object({
    complete: Type.Boolean(),
    expected_class_month_entries: Type.Integer({ minimum: 0 }),
    completed_class_month_entries: Type.Integer({ minimum: 0 }),
    missing_class_month_entries: Type.Integer({ minimum: 0 }),
    missing: Type.Array(Type.Object({ class_id: PositiveId, class_name: Type.String(), month: MonthKey })),
  }),
  classes: Type.Array(Type.Object({
    class_id: PositiveId,
    class_name: Type.String(),
    jenjang: Type.String(),
    program: Type.String(),
    sakit: NullableCount,
    izin: NullableCount,
    alfa: NullableCount,
    completed_months: Type.Integer({ minimum: 0 }),
    expected_months: Type.Integer({ minimum: 0 }),
    missing_months: Type.Array(MonthKey),
  })),
  totals: Type.Object({ sakit: NullableCount, izin: NullableCount, alfa: NullableCount }),
});

export const ManualAbsenceReportResponseSchema = Type.Object({
  scope: Type.Object({
    academic_year_id: PositiveId,
    academic_year_label: Type.String(),
    period_type: Type.Union([
      Type.Literal("month"), Type.Literal("term"), Type.Literal("bimonthly"), Type.Literal("semester"), Type.Literal("yearly"), Type.Literal("date_range"),
    ]),
    period: Type.String(),
    start_date: Type.String(),
    end_date: Type.String(),
    manual_months: Type.Array(MonthKey),
  }),
  manual_absence: ManualAbsenceAggregateSchema,
});

export const AttendanceReportResponseSchema = Type.Object({
  scope: Type.Object({
    academic_year_id: PositiveId,
    academic_year_label: Type.String(),
    period_type: Type.Union([
      Type.Literal("month"), Type.Literal("term"), Type.Literal("bimonthly"), Type.Literal("semester"), Type.Literal("yearly"), Type.Literal("date_range"),
    ]),
    period: Type.String(),
    start_date: Type.String(),
    end_date: Type.String(),
    manual_months: Type.Array(MonthKey),
  }),
  canonical_attendance: Type.Object({
    source: Type.Literal("student_attendance_records"),
    totals: TermAttendanceCountsSchema,
  }),
  students: Type.Array(Type.Object({
    student_id: PositiveId,
    name: Type.String(),
    class_name: Type.Union([Type.String(), Type.Null()]),
    jenjang: Type.Union([Type.String(), Type.Null()]),
    hadir: Type.Integer({ minimum: 0 }),
    late: Type.Integer({ minimum: 0 }),
    absent: Type.Integer({ minimum: 0 }),
    incomplete: Type.Integer({ minimum: 0 }),
    sakit: Type.Integer({ minimum: 0 }),
    izin: Type.Integer({ minimum: 0 }),
    alfa: Type.Integer({ minimum: 0 }),
    recorded: Type.Integer({ minimum: 0 }),
    total_late_time_str: Type.String(),
  })),
  summary: Type.Object({ avg_late_time_str: Type.String() }),
  manual_absence: ManualAbsenceAggregateSchema,
  attendance_basis: Type.Array(AttendanceBasisClassSchema),
  attendance_basis_unavailable_reason: Type.Union([Type.Literal("CANONICAL_CLASS_UNRESOLVED"), Type.Null()]),
});

export type ManualAbsenceQuery = Static<typeof ManualAbsenceQuerySchema>;
export type ManualAbsenceMonthlyResponse = Static<typeof ManualAbsenceMonthlyResponseSchema>;
export type ManualAbsenceStudentTotalsQuery = Static<typeof ManualAbsenceStudentTotalsQuerySchema>;
export type ManualAbsenceStudentTotalsResponse = Static<typeof ManualAbsenceStudentTotalsResponseSchema>;
export type LegacyAbsenceReasonsResponse = Static<typeof LegacyAbsenceReasonsResponseSchema>;
export type ManualAbsenceSaveRequest = Static<typeof ManualAbsenceSaveRequestSchema>;
export type ManualAbsenceLedgerActionRequest = Static<typeof ManualAbsenceLedgerActionRequestSchema>;
export type ManualAbsenceLedgerReopenRequest = Static<typeof ManualAbsenceLedgerReopenRequestSchema>;
export type ManualAbsenceLedgerActionResponse = Static<typeof ManualAbsenceLedgerActionResponseSchema>;
export type AttendanceReportQuery = Static<typeof AttendanceReportQuerySchema>;
export type AttendanceReportResponse = Static<typeof AttendanceReportResponseSchema>;
export type ManualAbsenceReportResponse = Static<typeof ManualAbsenceReportResponseSchema>;
