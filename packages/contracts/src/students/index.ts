import { Type, type Static } from "@sinclair/typebox";

export const NisnStatusFilterSchema = Type.Union([Type.Literal("inputted"), Type.Literal("not_inputted")]);
export type NisnStatusFilter = Static<typeof NisnStatusFilterSchema>;

export const IdentityVerificationStatusSchema = Type.Union([
  Type.Literal("UNVERIFIED"),
  Type.Literal("VERIFIED"),
  Type.Literal("NEEDS_CORRECTION"),
]);
export type IdentityVerificationStatus = Static<typeof IdentityVerificationStatusSchema>;

export const IdentifierTypeSchema = Type.Union([
  Type.Literal("NIK"),
  Type.Literal("KK"),
]);
export type IdentifierType = Static<typeof IdentifierTypeSchema>;

export const DapodikRegistrationStatusSchema = Type.Union([
  Type.Literal("NOT_STARTED"),
  Type.Literal("PENDING_EXTERNAL_PROCESSING"),
  Type.Literal("ENTERED"),
  Type.Literal("SYNCHRONIZED"),
  Type.Literal("NEEDS_CORRECTION"),
]);
export type DapodikRegistrationStatus = Static<typeof DapodikRegistrationStatusSchema>;

export const IomTypeSchema = Type.Union([
  Type.Literal("TRANSFER_IN"),
  Type.Literal("TRANSFER_OUT"),
]);
export type IomType = Static<typeof IomTypeSchema>;

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
  nik_verification_status: Type.Optional(Type.Union([IdentityVerificationStatusSchema, Type.Null()])),
  kk_verification_status: Type.Optional(Type.Union([IdentityVerificationStatusSchema, Type.Null()])),
  dapodik_status: Type.Optional(Type.Union([DapodikRegistrationStatusSchema, Type.Null()])),
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

export const StudentIdentityVerificationSchema = Type.Object({
  id: Type.Number(),
  student_master_id: Type.String(),
  identifier_type: IdentifierTypeSchema,
  verification_status: IdentityVerificationStatusSchema,
  verified_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  verified_by: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  correction_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type StudentIdentityVerification = Static<typeof StudentIdentityVerificationSchema>;

export const UpdateIdentityVerificationRequestSchema = Type.Object({
  identifier_type: IdentifierTypeSchema,
  verification_status: IdentityVerificationStatusSchema,
  correction_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type UpdateIdentityVerificationRequest = Static<typeof UpdateIdentityVerificationRequestSchema>;

export const StudentDapodikRegistrationSchema = Type.Object({
  id: Type.Number(),
  student_master_id: Type.String(),
  status: DapodikRegistrationStatusSchema,
  external_reference: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_by: Type.String(),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  correction_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  synchronized_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type StudentDapodikRegistration = Static<typeof StudentDapodikRegistrationSchema>;

export const UpdateDapodikRegistrationRequestSchema = Type.Object({
  status: DapodikRegistrationStatusSchema,
  external_reference: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  correction_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type UpdateDapodikRegistrationRequest = Static<typeof UpdateDapodikRegistrationRequestSchema>;

export const StudentIomDocumentSchema = Type.Object({
  id: Type.String(),
  student_master_id: Type.String(),
  iom_type: IomTypeSchema,
  description: Type.String(),
  file_sha256: Type.String(),
  file_size_bytes: Type.Number(),
  original_filename: Type.String(),
  uploaded_by: Type.String(),
  uploaded_at: Type.String(),
  updated_at: Type.String(),
  updated_by: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type StudentIomDocument = Static<typeof StudentIomDocumentSchema>;

export const UpdateIomDocumentRequestSchema = Type.Object({
  description: Type.String({ minLength: 1 }),
});
export type UpdateIomDocumentRequest = Static<typeof UpdateIomDocumentRequestSchema>;

export * from "./overview";
