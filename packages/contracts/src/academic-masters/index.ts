import { Type, type Static } from "@sinclair/typebox";

export const AcademicMasterGradeSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  jenjang_id: Type.Integer({ minimum: 1 }),
  program_id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  sequence_number: Type.Integer({ minimum: 1 }),
  active: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
}, { additionalProperties: false });

export const CreateAcademicGradesBulkRequestSchema = Type.Object({
  program_id: Type.Integer({ minimum: 1 }),
  grades: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    sequence_number: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
}, { additionalProperties: false });

export type AcademicMasterGrade = Static<typeof AcademicMasterGradeSchema>;
export type CreateAcademicGradesBulkRequest = Static<typeof CreateAcademicGradesBulkRequestSchema>;
export type CreateAcademicGradesBulkResponse = AcademicMasterGrade[];

export const CreateAcademicGradesBulkResponseSchema = Type.Array(AcademicMasterGradeSchema);
