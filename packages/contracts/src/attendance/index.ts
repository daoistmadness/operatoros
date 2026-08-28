import { Type, type Static } from "@sinclair/typebox";

export const AttendanceCorrectionRequestSchema = Type.Object({
  attendance_id: Type.Number({ minimum: 1 }),
  proposed_status: Type.String(),
  proposed_check_in: Type.Optional(Type.String()),
  proposed_check_out: Type.Optional(Type.String()),
  reason_code: Type.String({ minLength: 2, maxLength: 64 }),
  explanation: Type.String({ minLength: 5, maxLength: 2000 }),
});

export type AttendanceCorrectionRequest = Static<typeof AttendanceCorrectionRequestSchema>;

export const AttendanceImportCommitRequestSchema = Type.Object({
  selected_row_ids: Type.Array(Type.Number({ minimum: 1 }), { minItems: 1 }),
  confirmation: Type.String(),
  preview_checksum: Type.String({ minLength: 64, maxLength: 64 }),
});

export type AttendanceImportCommitRequest = Static<typeof AttendanceImportCommitRequestSchema>;
