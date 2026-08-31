import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });

export const StudentIndicatorQuerySchema = Type.Object({
  window: Type.Optional(Type.Union([Type.Literal("rolling_4w"), Type.Literal("term")])),
  academic_year_id: Id,
  jenjang_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
  student_id: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  search: Type.Optional(Type.String({ maxLength: 120 })),
  sort: Type.Optional(Type.Union([
    Type.Literal("name"),
    Type.Literal("attendance_rate"),
    Type.Literal("attendance_delta"),
    Type.Literal("tardiness_rate"),
    Type.Literal("tardiness_delta"),
    Type.Literal("alfa_rate"),
    Type.Literal("alfa_delta"),
    Type.Literal("academic_average"),
    Type.Literal("academic_participation"),
  ])),
  order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
  page: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  page_size: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

const IndicatorDataStatusSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("insufficient_data"),
  Type.Literal("not_applicable"),
]);

const IndicatorDirectionSchema = Type.Union([
  Type.Literal("up"),
  Type.Literal("down"),
  Type.Literal("flat"),
  Type.Literal("insufficient_data"),
]);

const IndicatorValueSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  domain: Type.Union([Type.Literal("attendance"), Type.Literal("academic")]),
  unit: Type.Union([Type.Literal("percent"), Type.Literal("score")]),
  current: Type.Union([Type.Number(), Type.Null()]),
  previous: Type.Union([Type.Number(), Type.Null()]),
  delta: Type.Union([Type.Number(), Type.Null()]),
  direction: IndicatorDirectionSchema,
  currentSampleSize: Type.Number({ minimum: 0 }),
  previousSampleSize: Type.Number({ minimum: 0 }),
  dataStatus: IndicatorDataStatusSchema,
});

const StudentIndicatorRowSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  studentName: Type.String({ minLength: 1 }),
  className: Type.Union([Type.String(), Type.Null()]),
  jenjang: Type.Union([Type.String(), Type.Null()]),
  attendanceRate: Type.Union([IndicatorValueSchema, Type.Null()]),
  tardinessRate: Type.Union([IndicatorValueSchema, Type.Null()]),
  alfaRate: Type.Union([IndicatorValueSchema, Type.Null()]),
  academicAverage: IndicatorValueSchema,
  academicParticipation: IndicatorValueSchema,
  dataAvailability: Type.Object({
    attendance: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
    comparison: Type.Union([Type.Literal("available"), Type.Literal("insufficient_data")]),
    academic: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
  }),
});

const IndicatorDefinitionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  domain: Type.Union([Type.Literal("attendance"), Type.Literal("academic")]),
  unit: Type.Union([Type.Literal("percent"), Type.Literal("score")]),
  sourceMetric: Type.String({ minLength: 1 }),
  missingData: Type.String({ minLength: 1 }),
});

export const StudentIndicatorInsightsResponseSchema = Type.Object({
  scope: Type.Object({
    academicYearId: Type.Number({ minimum: 1 }),
    academicYearLabel: Type.String({ minLength: 1 }),
    jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  }),
  window: Type.Object({
    kind: Type.Union([Type.Literal("rolling_4w"), Type.Literal("term")]),
    anchorDate: Type.String({ minLength: 1 }),
    currentStart: Type.String({ minLength: 1 }),
    currentEnd: Type.String({ minLength: 1 }),
    previousStart: Type.Union([Type.String(), Type.Null()]),
    previousEnd: Type.Union([Type.String(), Type.Null()]),
    currentEligibleDays: Type.Number({ minimum: 0 }),
    previousEligibleDays: Type.Number({ minimum: 0 }),
    comparison: Type.Union([Type.Literal("comparable"), Type.Literal("insufficient_data")]),
  }),
  totalStudents: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1, maximum: 200 }),
  rows: Type.Array(StudentIndicatorRowSchema),
  indicatorDefinitions: Type.Array(IndicatorDefinitionSchema),
  limitations: Type.Array(Type.String({ minLength: 1 })),
});

export type StudentIndicatorQuery = Static<typeof StudentIndicatorQuerySchema>;
export type StudentIndicatorValue = Static<typeof IndicatorValueSchema>;
export type StudentIndicatorInsightsResponse = Static<typeof StudentIndicatorInsightsResponseSchema>;
