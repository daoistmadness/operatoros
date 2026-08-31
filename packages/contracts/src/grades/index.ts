import { Type, type Static } from "@sinclair/typebox";

export const AcademicYearStatusSchema = Type.Union([
  Type.Literal("upcoming"),
  Type.Literal("active"),
  Type.Literal("closed"),
]);

export const AcademicYearSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  label: Type.String({ minLength: 1, maxLength: 32 }),
  start_date: Type.String(),
  end_date: Type.String(),
  status: AcademicYearStatusSchema,
  is_default: Type.Boolean(),
});

export type AcademicYear = Static<typeof AcademicYearSchema>;

export const SubjectSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  jenjang_id: Type.Number({ minimum: 1 }),
  supports_sumatif: Type.Boolean(),
  supports_formatif: Type.Boolean(),
});

export type Subject = Static<typeof SubjectSchema>;

export const AssessmentTypeSchema = Type.Union([
  Type.Literal("sumatif"),
  Type.Literal("formatif"),
]);

export const AssessmentComponentSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  name: Type.String({ minLength: 1 }),
  assessment_type: AssessmentTypeSchema,
  subject_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
});

export type AssessmentComponent = Static<typeof AssessmentComponentSchema>;

export const AcademicAssessmentSessionSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  academic_year_id: Type.Number({ minimum: 1 }),
  term_number: Type.Number({ minimum: 1, maximum: 4 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  assessment_date: Type.Union([Type.String(), Type.Null()]),
});

export type AcademicAssessmentSession = Static<typeof AcademicAssessmentSessionSchema>;

export const CreateAcademicAssessmentSessionSchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  term_number: Type.Number({ minimum: 1, maximum: 4 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  assessment_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type CreateAcademicAssessmentSession = Static<typeof CreateAcademicAssessmentSessionSchema>;

export const GradeLineItemSchema = Type.Object({
  subject_id: Type.Number({ minimum: 1 }),
  component_id: Type.Number({ minimum: 1 }),
  score: Type.Optional(Type.Union([
    Type.Number({ minimum: 0, maximum: 100 }),
    Type.Null(),
  ])),
});

export type GradeLineItem = Static<typeof GradeLineItemSchema>;

export const GradeGridSaveRequestSchema = Type.Object({
  enrollment_id: Type.Number({ minimum: 1 }),
  assessment_session_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  grades: Type.Array(GradeLineItemSchema, { minItems: 1 }),
});

export type GradeGridSaveRequest = Static<typeof GradeGridSaveRequestSchema>;

export const GradeSaveResponseSchema = Type.Object({
  status: Type.Literal("success"),
  inserted: Type.Number({ minimum: 0 }),
  updated: Type.Number({ minimum: 0 }),
  saved: Type.Number({ minimum: 0 }),
  grades: Type.Array(Type.Object({
    id: Type.Number({ minimum: 1 }),
    enrollment_id: Type.Number({ minimum: 1 }),
    subject_id: Type.Number({ minimum: 1 }),
    component_id: Type.Number({ minimum: 1 }),
    assessment_session_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    score: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  })),
});

export type GradeSaveResponse = Static<typeof GradeSaveResponseSchema>;

export const AssessmentOperationsCoverageStateSchema = Type.Union([
  Type.Literal("COMPLETE"),
  Type.Literal("PARTIAL"),
  Type.Literal("NONE"),
  Type.Literal("EMPTY"),
]);

export type AssessmentOperationsCoverageState = Static<typeof AssessmentOperationsCoverageStateSchema>;

export const AssessmentOperationsScopeSchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  academic_year: Type.String({ minLength: 1 }),
  term: Type.Union([Type.Number({ minimum: 1, maximum: 4 }), Type.Null()]),
  class_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  subject_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  coverage_state: Type.Union([
    Type.Literal("ALL"),
    AssessmentOperationsCoverageStateSchema,
  ]),
});

export type AssessmentOperationsScope = Static<typeof AssessmentOperationsScopeSchema>;

export const AssessmentOperationsTotalsSchema = Type.Object({
  assessment_sessions: Type.Integer({ minimum: 0 }),
  scopes: Type.Integer({ minimum: 0 }),
  applicable_students: Type.Integer({ minimum: 0 }),
  recorded_scores: Type.Integer({ minimum: 0 }),
  unrecorded_scores: Type.Integer({ minimum: 0 }),
  complete_scopes: Type.Integer({ minimum: 0 }),
  partial_scopes: Type.Integer({ minimum: 0 }),
  no_score_scopes: Type.Integer({ minimum: 0 }),
  empty_scopes: Type.Integer({ minimum: 0 }),
});

export type AssessmentOperationsTotals = Static<typeof AssessmentOperationsTotalsSchema>;

export const AssessmentOperationsSessionSchema = Type.Object({
  assessment_session_id: Type.Number({ minimum: 1 }),
  assessment_label: Type.String({ minLength: 1 }),
  class_id: Type.Number({ minimum: 1 }),
  class_name: Type.String({ minLength: 1 }),
  jenjang_id: Type.Number({ minimum: 1 }),
  jenjang: Type.String({ minLength: 1 }),
  subject_id: Type.Number({ minimum: 1 }),
  subject_name: Type.String({ minLength: 1 }),
  academic_year_id: Type.Number({ minimum: 1 }),
  academic_year: Type.String({ minLength: 1 }),
  term_number: Type.Integer({ minimum: 1, maximum: 4 }),
  term_label: Type.String({ minLength: 1 }),
  assessment_date: Type.Union([Type.String(), Type.Null()]),
  applicable_student_count: Type.Integer({ minimum: 0 }),
  recorded_score_count: Type.Integer({ minimum: 0 }),
  unrecorded_score_count: Type.Integer({ minimum: 0 }),
  coverage_percent: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  coverage_state: AssessmentOperationsCoverageStateSchema,
});

export type AssessmentOperationsSession = Static<typeof AssessmentOperationsSessionSchema>;

export const AssessmentOperationsResponseSchema = Type.Object({
  scope: AssessmentOperationsScopeSchema,
  totals: AssessmentOperationsTotalsSchema,
  total: Type.Integer({ minimum: 0 }),
  page: Type.Integer({ minimum: 1 }),
  page_size: Type.Integer({ minimum: 1, maximum: 100 }),
  sessions: Type.Array(AssessmentOperationsSessionSchema),
});

export type AssessmentOperationsResponse = Static<typeof AssessmentOperationsResponseSchema>;
