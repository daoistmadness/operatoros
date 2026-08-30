import { Type, type Static } from "@sinclair/typebox";

const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const AssessmentType = Type.Union([Type.Literal("sumatif"), Type.Literal("formatif")]);

export const AcademicAnalyticsQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  class_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  subject_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  assessment_type: Type.Optional(AssessmentType),
  search: Type.Optional(Type.String({ maxLength: 120 })),
  sort: Type.Optional(Type.Union([Type.Literal("name"), Type.Literal("average"), Type.Literal("formative"), Type.Literal("summative"), Type.Literal("missing")])),
  order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
  page: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  page_size: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

export const AcademicAnalyticsOptionsQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

const AcademicYear = Type.Object({
  id: Type.Number({ minimum: 1 }), label: Type.String(), startDate: Type.String(), endDate: Type.String(), isDefault: Type.Boolean(),
});
const NamedId = Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String({ minLength: 1 }) });

export const AcademicAnalyticsOptionsResponseSchema = Type.Object({
  academicYears: Type.Array(AcademicYear),
  jenjangs: Type.Array(NamedId),
  classes: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String({ minLength: 1 }), jenjangId: Type.Number({ minimum: 1 }) })),
  subjects: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String({ minLength: 1 }), jenjangId: Type.Number({ minimum: 1 }) })),
  assessmentTypes: Type.Array(Type.Object({ id: AssessmentType, label: Type.String({ minLength: 1 }) })),
});

export const AcademicAnalyticsScopeSchema = Type.Object({
  academicYearId: Type.Number({ minimum: 1 }), academicYearLabel: Type.String({ minLength: 1 }), term: Type.Null(),
  jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]), classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  subjectId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]), assessmentType: Type.Union([AssessmentType, Type.Null()]),
  includedStudentCount: Type.Number({ minimum: 0 }), includedAssessmentCount: Type.Number({ minimum: 0 }),
});

export const AcademicScoreSummarySchema = Type.Object({
  average: NullableNumber, scoreSum: Type.Number({ minimum: 0 }), scoreCount: Type.Number({ minimum: 0 }),
  min: NullableNumber, max: NullableNumber,
});

export const AcademicMetricDefinitionsSchema = Type.Object({
  average: Type.String({ minLength: 1 }), participation: Type.String({ minLength: 1 }), missing: Type.String({ minLength: 1 }),
  rounding: Type.String({ minLength: 1 }), mastery: Type.String({ minLength: 1 }), term: Type.String({ minLength: 1 }),
});

export const AcademicMasterySchema = Type.Object({
  available: Type.Boolean(), evaluatedResults: Type.Number({ minimum: 0 }), meetingResults: Type.Number({ minimum: 0 }),
  belowResults: Type.Number({ minimum: 0 }), meetingStudents: Type.Number({ minimum: 0 }), belowStudents: Type.Number({ minimum: 0 }),
  fallbackThreshold: Type.Number({ minimum: 0, maximum: 100 }),
});

export const AcademicGroupRowSchema = Type.Object({
  id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]), label: Type.String({ minLength: 1 }),
  students: Type.Number({ minimum: 0 }), scoredStudents: Type.Number({ minimum: 0 }), assessments: Type.Number({ minimum: 0 }),
  expectedResults: Type.Number({ minimum: 0 }), scoredResults: Type.Number({ minimum: 0 }), missingResults: Type.Number({ minimum: 0 }),
  participationPercentage: Type.Number({ minimum: 0, maximum: 100 }), average: NullableNumber,
  min: NullableNumber, max: NullableNumber, formativeAverage: NullableNumber, summativeAverage: NullableNumber,
});

export const AcademicAssessmentRowSchema = Type.Object({
  id: Type.Number({ minimum: 1 }), label: Type.String({ minLength: 1 }), subjectId: Type.Number({ minimum: 1 }),
  subjectName: Type.String({ minLength: 1 }), assessmentType: AssessmentType, participants: Type.Number({ minimum: 0 }),
  scored: Type.Number({ minimum: 0 }), missing: Type.Number({ minimum: 0 }), average: NullableNumber, min: NullableNumber, max: NullableNumber,
});

export const AcademicDistributionRowSchema = Type.Object({ bucket: Type.String({ minLength: 1 }), min: Type.Number(), max: Type.Number(), count: Type.Number({ minimum: 0 }) });

export const AcademicAnalyticsOverviewResponseSchema = Type.Object({
  scope: AcademicAnalyticsScopeSchema,
  summary: Type.Object({
    students: Type.Number({ minimum: 0 }), assessments: Type.Number({ minimum: 0 }), expectedResults: Type.Number({ minimum: 0 }),
    scoredResults: Type.Number({ minimum: 0 }), missingResults: Type.Number({ minimum: 0 }), participationPercentage: Type.Number({ minimum: 0, maximum: 100 }),
    score: AcademicScoreSummarySchema, formative: AcademicScoreSummarySchema, summative: AcademicScoreSummarySchema, mastery: AcademicMasterySchema,
  }),
  subjects: Type.Array(AcademicGroupRowSchema), classes: Type.Array(AcademicGroupRowSchema), jenjang: Type.Array(AcademicGroupRowSchema),
  assessments: Type.Array(AcademicAssessmentRowSchema), distribution: Type.Array(AcademicDistributionRowSchema),
  metricDefinitions: AcademicMetricDefinitionsSchema, generatedAt: Type.String(),
});

export const AcademicStudentRowSchema = Type.Object({
  studentId: Type.Number({ minimum: 1 }), studentName: Type.String({ minLength: 1 }), className: Type.Union([Type.String(), Type.Null()]),
  subjectsIncluded: Type.Number({ minimum: 0 }), assessmentsIncluded: Type.Number({ minimum: 0 }), expectedAssessments: Type.Number({ minimum: 0 }),
  missingAssessments: Type.Number({ minimum: 0 }), average: NullableNumber, formativeAverage: NullableNumber, summativeAverage: NullableNumber,
});

export const AcademicAnalyticsStudentsResponseSchema = Type.Object({
  scope: AcademicAnalyticsScopeSchema, total: Type.Number({ minimum: 0 }), page: Type.Number({ minimum: 1 }), pageSize: Type.Number({ minimum: 1 }),
  rows: Type.Array(AcademicStudentRowSchema), generatedAt: Type.String(),
});

export type AcademicAnalyticsQuery = Static<typeof AcademicAnalyticsQuerySchema>;
export type AcademicAnalyticsOptionsResponse = Static<typeof AcademicAnalyticsOptionsResponseSchema>;
export type AcademicAnalyticsOverviewResponse = Static<typeof AcademicAnalyticsOverviewResponseSchema>;
export type AcademicAnalyticsStudentsResponse = Static<typeof AcademicAnalyticsStudentsResponseSchema>;
