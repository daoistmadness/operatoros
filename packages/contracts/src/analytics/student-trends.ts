import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const DateString = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });

export const StudentTrendQuerySchema = Type.Object({
  window: Type.Optional(Type.Union([Type.Literal("rolling_4w"), Type.Literal("term")])),
  academic_year_id: Id,
  jenjang_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
  search: Type.Optional(Type.String({ maxLength: 120 })),
  sort: Type.Optional(Type.Union([
    Type.Literal("name"),
    Type.Literal("attendance_delta"),
    Type.Literal("academic_delta"),
    Type.Literal("tardiness_delta"),
    Type.Literal("alfa_delta"),
  ])),
  order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
  page: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  page_size: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

const TrendMetricSchema = Type.Object({
  unit: Type.Union([Type.Literal("percent"), Type.Literal("score"), Type.Literal("count")]),
  current: Type.Union([Type.Number(), Type.Null()]),
  previous: Type.Union([Type.Number(), Type.Null()]),
  delta: Type.Union([Type.Number(), Type.Null()]),
  direction: Type.Union([
    Type.Literal("up"),
    Type.Literal("down"),
    Type.Literal("flat"),
    Type.Literal("insufficient_data"),
  ]),
  currentSampleSize: Type.Number({ minimum: 0 }),
  previousSampleSize: Type.Number({ minimum: 0 }),
});

export const StudentTrendWindowSchema = Type.Object({
  kind: Type.Union([Type.Literal("rolling_4w"), Type.Literal("term")]),
  anchorDate: DateString,
  currentStart: DateString,
  currentEnd: DateString,
  previousStart: Type.Union([DateString, Type.Null()]),
  previousEnd: Type.Union([DateString, Type.Null()]),
  currentEligibleDays: Type.Number({ minimum: 0 }),
  previousEligibleDays: Type.Number({ minimum: 0 }),
  comparison: Type.Union([Type.Literal("comparable"), Type.Literal("insufficient_data")]),
});

const ScopeSchema = Type.Object({
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.String({ minLength: 1 }),
  jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
});

const StudentTrendRowSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  studentName: Type.String({ minLength: 1 }),
  className: Type.Union([Type.String(), Type.Null()]),
  jenjang: Type.Union([Type.String(), Type.Null()]),
  attendance: Type.Union([TrendMetricSchema, Type.Null()]),
  academic: TrendMetricSchema,
  tardiness: Type.Union([TrendMetricSchema, Type.Null()]),
  alfa: Type.Union([TrendMetricSchema, Type.Null()]),
});

export const StudentTrendInsightsResponseSchema = Type.Object({
  scope: ScopeSchema,
  window: StudentTrendWindowSchema,
  totalStudents: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1, maximum: 200 }),
  rows: Type.Array(StudentTrendRowSchema),
  limitations: Type.Array(Type.String({ minLength: 1 })),
});

export type StudentTrendQuery = Static<typeof StudentTrendQuerySchema>;
export type StudentTrendWindow = Static<typeof StudentTrendWindowSchema>;
export type StudentTrendMetric = Static<typeof TrendMetricSchema>;
export type StudentTrendInsightsResponse = Static<typeof StudentTrendInsightsResponseSchema>;
