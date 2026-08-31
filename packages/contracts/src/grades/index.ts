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
