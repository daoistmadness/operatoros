import { Type, type Static } from "@sinclair/typebox";

const DateStringSchema = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });

export const AnalyticsDateRangeSchema = Type.Object({
  start_date: DateStringSchema,
  end_date: DateStringSchema,
});

export type AnalyticsDateRange = Static<typeof AnalyticsDateRangeSchema>;

export const AnalyticsMetricDefinitionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  unit: Type.Union([Type.Literal("count"), Type.Literal("percent"), Type.Literal("score")]),
  numerator: Type.String({ minLength: 1 }),
  denominator: Type.String({ minLength: 1 }),
  rounding: Type.String({ minLength: 1 }),
  missing_data: Type.String({ minLength: 1 }),
});

export type AnalyticsMetricDefinition = Static<typeof AnalyticsMetricDefinitionSchema>;

export const AnalyticsMetricValueSchema = Type.Object({
  value: Type.Union([Type.Number(), Type.Null()]),
  numerator: Type.Number({ minimum: 0 }),
  denominator: Type.Number({ minimum: 0 }),
  unit: Type.Union([Type.Literal("count"), Type.Literal("percent"), Type.Literal("score")]),
  status: Type.Union([
    Type.Literal("value"),
    Type.Literal("zero"),
    Type.Literal("unavailable"),
    Type.Literal("not_applicable"),
  ]),
});

export type AnalyticsMetricValue = Static<typeof AnalyticsMetricValueSchema>;

export const AnalyticsFilterResultSchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  academic_year_label: Type.String({ minLength: 1 }),
  start_date: DateStringSchema,
  end_date: DateStringSchema,
  jenjang_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  class_name: Type.Union([Type.String(), Type.Null()]),
  subject_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
});

export type AnalyticsFilterResult = Static<typeof AnalyticsFilterResultSchema>;

export const AnalyticsAttendanceCountsSchema = Type.Object({
  present: Type.Number({ minimum: 0 }),
  sakit: Type.Number({ minimum: 0 }),
  izin: Type.Number({ minimum: 0 }),
  alfa: Type.Number({ minimum: 0 }),
  late: Type.Number({ minimum: 0 }),
});

export type AnalyticsAttendanceCounts = Static<typeof AnalyticsAttendanceCountsSchema>;

export const AnalyticsSummarySchema = Type.Object({
  student_count: Type.Number({ minimum: 0 }),
  attendance_counts: AnalyticsAttendanceCountsSchema,
  attendance_rate: AnalyticsMetricValueSchema,
  grade_average: AnalyticsMetricValueSchema,
});

export type AnalyticsSummary = Static<typeof AnalyticsSummarySchema>;

export const AnalyticsCohortSchema = Type.Object({
  dimension: Type.Union([Type.Literal("class"), Type.Literal("jenjang")]),
  id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  label: Type.String({ minLength: 1 }),
  student_count: Type.Number({ minimum: 0 }),
  attendance_rate: AnalyticsMetricValueSchema,
  grade_average: AnalyticsMetricValueSchema,
});

export type AnalyticsCohort = Static<typeof AnalyticsCohortSchema>;

export const AnalyticsOverviewResponseSchema = Type.Object({
  contract_version: Type.Literal("analytics.v1"),
  filters: AnalyticsFilterResultSchema,
  metric_definitions: Type.Array(AnalyticsMetricDefinitionSchema),
  summary: AnalyticsSummarySchema,
  cohorts: Type.Array(AnalyticsCohortSchema),
});

export type AnalyticsOverviewResponse = Static<typeof AnalyticsOverviewResponseSchema>;

export const AnalyticsTrendPointSchema = Type.Object({
  period: Type.String({ minLength: 1 }),
  start_date: DateStringSchema,
  end_date: DateStringSchema,
  metric: AnalyticsMetricValueSchema,
});

export type AnalyticsTrendPoint = Static<typeof AnalyticsTrendPointSchema>;

export const AnalyticsTrendSeriesSchema = Type.Object({
  metric_id: Type.Literal("attendance_rate"),
  time_grain: Type.Literal("month"),
  points: Type.Array(AnalyticsTrendPointSchema),
});

export type AnalyticsTrendSeries = Static<typeof AnalyticsTrendSeriesSchema>;

export const AnalyticsTrendsResponseSchema = Type.Object({
  contract_version: Type.Literal("analytics.v1"),
  filters: AnalyticsFilterResultSchema,
  metric_definitions: Type.Array(AnalyticsMetricDefinitionSchema),
  series: Type.Array(AnalyticsTrendSeriesSchema),
});

export type AnalyticsTrendsResponse = Static<typeof AnalyticsTrendsResponseSchema>;

export const AnalyticsCohortsResponseSchema = Type.Object({
  contract_version: Type.Literal("analytics.v1"),
  filters: AnalyticsFilterResultSchema,
  metric_definitions: Type.Array(AnalyticsMetricDefinitionSchema),
  dimension: Type.Union([Type.Literal("class"), Type.Literal("jenjang")]),
  cohorts: Type.Array(AnalyticsCohortSchema),
});

export type AnalyticsCohortsResponse = Static<typeof AnalyticsCohortsResponseSchema>;

export * from "./recapitulation";
export * from "./data-quality";
