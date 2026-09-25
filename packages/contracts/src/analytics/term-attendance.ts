import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const NullableId = Type.Union([Type.Number({ minimum: 1 }), Type.Null()]);
const Counts = Type.Object({
  expected_student_days: Type.Number({ minimum: 0 }),
  recorded_student_days: Type.Number({ minimum: 0 }),
  unrecorded_student_days: Type.Number({ minimum: 0 }),
  hadir_count: Type.Number({ minimum: 0 }),
  sakit_count: Type.Number({ minimum: 0 }),
  izin_count: Type.Number({ minimum: 0 }),
  alfa_count: Type.Number({ minimum: 0 }),
  late_count: Type.Number({ minimum: 0 }),
  other_status_count: Type.Number({ minimum: 0 }),
  coverage_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  hadir_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  sakit_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  izin_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  alfa_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  attendance_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  recorded_attendance_rate: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
});

export const TermAttendanceQuerySchema = Type.Object({
  academic_year_id: Id,
  term_number: Type.String({ pattern: "^[1-4]$" }),
  jenjang_id: Type.Optional(Id),
  program_id: Type.Optional(Id),
  grade_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
});

export const TermAttendanceResponseSchema = Type.Object({
  period: Type.Object({ academic_year_id: Type.Number({ minimum: 1 }), academic_year_label: Type.String(), term_id: NullableId, term_number: Type.Number({ minimum: 1, maximum: 4 }), term_label: Type.String(), start_date: Type.String(), end_date: Type.String(), source: Type.Union([Type.Literal("custom"), Type.Literal("default")]) }),
  scope: Type.Object({ jenjang_id: NullableId, program_id: NullableId, grade_id: NullableId, class_id: NullableId }),
  totals: Counts,
  jenjangs: Type.Array(Type.Object({ jenjang_id: NullableId, jenjang: Type.String(), totals: Counts })),
  programs: Type.Array(Type.Object({ program_id: NullableId, program: Type.String(), totals: Counts })),
  grades: Type.Array(Type.Object({ grade_id: NullableId, grade: Type.String(), totals: Counts })),
  classes: Type.Array(Type.Object({ class_id: NullableId, class_name: Type.String(), totals: Counts })),
  students: Type.Array(Type.Object({ student_key: Type.String(), class_representations: Type.Array(Type.Object({ class_id: NullableId, class_name: Type.String() })), totals: Counts })),
  quality: Type.Object({ unknown_calendar_dates: Type.Array(Type.String()), unknown_calendar_student_days: Type.Number({ minimum: 0 }), unresolved_class_student_days: Type.Number({ minimum: 0 }), other_status_student_days: Type.Number({ minimum: 0 }), report_data_ready: Type.Boolean() }),
});

export type TermAttendanceQuery = Static<typeof TermAttendanceQuerySchema>;
export type TermAttendanceResponse = Static<typeof TermAttendanceResponseSchema>;
