import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const NullableId = Type.Union([Type.Number({ minimum: 1 }), Type.Null()]);
const NullableRate = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);

const Totals = Type.Object({
  expected_student_days: Type.Number({ minimum: 0 }),
  late_events: Type.Number({ minimum: 0 }),
  affected_students: Type.Number({ minimum: 0 }),
  total_late_minutes: Type.Number({ minimum: 0 }),
  average_late_minutes: NullableRate,
  late_event_rate: NullableRate,
});

export const TermLatenessQuerySchema = Type.Object({
  academic_year_id: Id,
  term_number: Type.String({ pattern: "^[1-4]$" }),
  jenjang_id: Type.Optional(Id),
  program_id: Type.Optional(Id),
  grade_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
});

export const TermLatenessResponseSchema = Type.Object({
  period: Type.Object({ academic_year_id: Type.Number({ minimum: 1 }), academic_year_label: Type.String(), term_id: NullableId, term_number: Type.Number({ minimum: 1, maximum: 4 }), term_label: Type.String(), start_date: Type.String(), end_date: Type.String(), source: Type.Union([Type.Literal("custom"), Type.Literal("default")]) }),
  scope: Type.Object({ jenjang_id: NullableId, program_id: NullableId, grade_id: NullableId, class_id: NullableId }),
  cutoffs: Type.Array(Type.Object({ jenjang_id: NullableId, jenjang: Type.String(), cutoff_time: Type.Union([Type.String(), Type.Null()]) })),
  totals: Totals,
  classes: Type.Array(Type.Object({ class_id: NullableId, class_name: Type.String(), totals: Totals })),
  students: Type.Array(Type.Object({ student_key: Type.String(), late_events: Type.Number({ minimum: 0 }), total_late_minutes: Type.Number({ minimum: 0 }) })),
  quality: Type.Object({ unknown_calendar_dates: Type.Array(Type.String()), unknown_calendar_student_days: Type.Number({ minimum: 0 }), unresolved_class_student_days: Type.Number({ minimum: 0 }), other_status_student_days: Type.Number({ minimum: 0 }), report_data_ready: Type.Boolean() }),
});

export type TermLatenessQuery = Static<typeof TermLatenessQuerySchema>;
export type TermLatenessResponse = Static<typeof TermLatenessResponseSchema>;
