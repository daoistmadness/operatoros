import { Type, type Static } from "@sinclair/typebox";

export const CreateEnrollmentRequestSchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  academic_class_id: Type.Number({ minimum: 1 }),
  effective_from: Type.String(),
});

export type CreateEnrollmentRequest = Static<typeof CreateEnrollmentRequestSchema>;

export const ManagedStudentSchema = Type.Object({
  id: Type.String(),
  full_name: Type.String(),
  preferred_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nipd_masked: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nisn_masked: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  current_jenjang: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  current_class: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  academic_year: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  device_identifier_masked: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  profile_completeness: Type.Number(),
  student_status: Type.String(),
  quality_flags: Type.Array(Type.String()),
  age_years: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  current_programme: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  current_grade: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ManagedStudent = Static<typeof ManagedStudentSchema>;

export const StudentListResponseSchema = Type.Object({
  items: Type.Array(ManagedStudentSchema),
  total: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  page_size: Type.Number({ minimum: 1 }),
  total_pages: Type.Number({ minimum: 0 }),
});

export type StudentListResponse = Static<typeof StudentListResponseSchema>;

export const LegacyLinkCandidateSchema = Type.Object({
  legacy_student_id: Type.Number({ minimum: 1 }),
  name: Type.String(),
  jenjang: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  class_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  attendance_count: Type.Number({ minimum: 0 }),
});

export type LegacyLinkCandidate = Static<typeof LegacyLinkCandidateSchema>;

export const LegacyLinkStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal("LINKED"),
    Type.Literal("NOT_LINKED"),
    Type.Literal("REVIEW_REQUIRED"),
  ]),
  legacy_student_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
  candidates: Type.Array(LegacyLinkCandidateSchema),
});

export type LegacyLinkStatus = Static<typeof LegacyLinkStatusSchema>;
