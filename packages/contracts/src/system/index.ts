import { Type, type Static } from "@sinclair/typebox";

export const DataResetScopeSchema = Type.Union([
  Type.Literal("ATTENDANCE"),
  Type.Literal("ACADEMIC_RESULTS"),
  Type.Literal("STUDENTS"),
  Type.Literal("ALL_SCHOOL_DATA"),
]);

export type DataResetScope = Static<typeof DataResetScopeSchema>;

export const DataResetPreviewRequestSchema = Type.Object({ scope: DataResetScopeSchema }, { additionalProperties: false });
export const DataResetCommitRequestSchema = Type.Object({
  scope: DataResetScopeSchema,
  confirmation: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const DataResetPreviewResponseSchema = Type.Object({
  scope: DataResetScopeSchema,
  will_delete: Type.Array(Type.Object({ domain: Type.String(), count: Type.Integer({ minimum: 0 }) })),
  will_preserve: Type.Array(Type.String()),
  encrypted_backup_required: Type.Literal(true),
});

export const DataResetResultSchema = Type.Object({
  scope: DataResetScopeSchema,
  deleted_counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  completed_at: Type.String({ format: "date-time" }),
  backup_filename: Type.String({ minLength: 1 }),
});

export type DataResetPreviewRequest = Static<typeof DataResetPreviewRequestSchema>;
export type DataResetCommitRequest = Static<typeof DataResetCommitRequestSchema>;
export type DataResetPreviewResponse = Static<typeof DataResetPreviewResponseSchema>;
export type DataResetResult = Static<typeof DataResetResultSchema>;
