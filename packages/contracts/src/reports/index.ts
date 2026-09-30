import { Type, type Static } from "@sinclair/typebox";
import { AttendanceBasisConflictSchema } from "../analytics/attendance-basis";
export * from "./manual-absence";

export const ReportScopeSchema = Type.Union([
  Type.Literal("combined"),
  Type.Literal("early_year"),
  Type.Literal("primary"),
  Type.Literal("secondary"),
]);

export type ReportScope = Static<typeof ReportScopeSchema>;

export const ReportQuerySchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  scope: ReportScopeSchema,
  month: Type.Optional(Type.String()),
  class_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
  class_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  subject_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
});

export type ReportQuery = Static<typeof ReportQuerySchema>;

export const ReportFiltersResponseSchema = Type.Object({
  academic_years: Type.Array(Type.Object({
    id: Type.Number(), name: Type.String(), start_date: Type.String(), end_date: Type.String(), is_default: Type.Boolean(),
  })),
  default_academic_year_id: Type.Union([Type.Number(), Type.Null()]),
  months: Type.Array(Type.Object({ value: Type.String(), label: Type.String() })),
  scopes: Type.Array(Type.Object({ value: ReportScopeSchema, label: Type.String() })),
  classes: Type.Array(Type.String()),
  class_options: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String() })),
  subjects: Type.Array(Type.Object({ id: Type.Number(), name: Type.String(), jenjang_id: Type.Number(), jenjang_name: Type.String() })),
});

export type ReportFiltersResponse = Static<typeof ReportFiltersResponseSchema>;

export const MonthlyReportResponseSchema = Type.Object({
  meta: Type.Object({
    report_type: Type.Literal("monthly"), scope: ReportScopeSchema,
    academic_year: Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String() }),
    period: Type.Object({ start: Type.String(), end: Type.String() }), generated_at: Type.String(),
  }),
  report_period: Type.Object({
    selected_month: Type.String(), academic_year_id: Type.Number({ minimum: 1 }), academic_year_label: Type.String(),
    sections: Type.Object({
      attendance: Type.Object({ basis: Type.String(), month_bound: Type.Literal(true), label: Type.String() }),
      population: Type.Object({ basis: Type.String(), month_bound: Type.Literal(false), label: Type.String() }),
      academics: Type.Object({ basis: Type.String(), month_bound: Type.Literal(false), label: Type.String() }),
    }),
  }),
  population: Type.Object({ total_students: Type.Integer({ minimum: 0 }), total_classes: Type.Integer({ minimum: 0 }) }),
  attendance: Type.Object({
    classes: Type.Array(Type.Object({
      class_id: Type.Number({ minimum: 1 }), class_name: Type.String(), jenjang: Type.String(),
      basis: Type.Union([Type.Literal("OBSERVED"), Type.Literal("DECLARED"), Type.Literal("NOT_REPORTED")]),
      expected_student_days: Type.Integer({ minimum: 0 }), recorded_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      hadir_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      presumed_hadir_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      sakit_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      izin_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      alfa_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      unrecorded_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      other_status_student_days: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      attendance_rate: Type.Union([Type.Number(), Type.Null()]),
      coverage_rate: Type.Union([Type.Number(), Type.Null()]),
      lateness: Type.Object({
        availability: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("UNAVAILABLE")]),
        late_events: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        late_event_rate: Type.Union([Type.Number(), Type.Null()]),
        late_minutes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        unknown_duration_events: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      }),
      conflict: Type.Union([AttendanceBasisConflictSchema, Type.Null()]),
    })),
    summary: Type.Object({
      basis_counts: Type.Object({ observed: Type.Integer({ minimum: 0 }), declared: Type.Integer({ minimum: 0 }), not_reported: Type.Integer({ minimum: 0 }) }),
      observed: Type.Object({
        class_count: Type.Integer({ minimum: 0 }), expected_student_days: Type.Integer({ minimum: 0 }),
        hadir_student_days: Type.Integer({ minimum: 0 }), sakit_student_days: Type.Integer({ minimum: 0 }),
        izin_student_days: Type.Integer({ minimum: 0 }), alfa_student_days: Type.Integer({ minimum: 0 }),
        recorded_student_days: Type.Integer({ minimum: 0 }), unrecorded_student_days: Type.Integer({ minimum: 0 }),
        other_status_student_days: Type.Integer({ minimum: 0 }),
        attendance_rate: Type.Union([Type.Number(), Type.Null()]), coverage_rate: Type.Union([Type.Number(), Type.Null()]),
      }),
      lateness: Type.Object({
        availability: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("PARTIAL"), Type.Literal("UNAVAILABLE")]),
        late_events: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        late_minutes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        unknown_duration_events: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        late_event_rate: Type.Union([Type.Number(), Type.Null()]),
        late_among_present: Type.Union([Type.Number(), Type.Null()]),
        covered_expected_student_days: Type.Integer({ minimum: 0 }),
        available_hadir_student_days: Type.Integer({ minimum: 0 }),
        scope_expected_student_days: Type.Integer({ minimum: 0 }),
        coverage_rate: Type.Union([Type.Number(), Type.Null()]),
      }),
      conflict_count: Type.Integer({ minimum: 0 }),
    }),
  }),
  academic_summary: Type.Object({
    availability: Type.Boolean(), reason: Type.Union([Type.String(), Type.Null()]),
    sumatif_average: Type.Union([Type.Number(), Type.Null()]), formatif_average: Type.Union([Type.Number(), Type.Null()]),
    below_kkm_count: Type.Integer({ minimum: 0 }),
    by_subject: Type.Array(Type.Object({ subject_id: Type.Number(), subject_name: Type.String(), jenjang: Type.String(),
      sumatif_average: Type.Union([Type.Number(), Type.Null()]), formatif_average: Type.Union([Type.Number(), Type.Null()]),
      below_kkm_count: Type.Integer({ minimum: 0 }) })),
  }),
  data_quality: Type.Object({
    empty_grade_cells: Type.Integer({ minimum: 0 }), unmapped_levels: Type.Array(Type.String()),
    not_reported_classes: Type.Integer({ minimum: 0 }), partial_observed_classes: Type.Integer({ minimum: 0 }),
    unresolved_conflicts: Type.Integer({ minimum: 0 }), warnings: Type.Array(Type.String()),
  }),
});

export type MonthlyReportResponse = Static<typeof MonthlyReportResponseSchema>;
