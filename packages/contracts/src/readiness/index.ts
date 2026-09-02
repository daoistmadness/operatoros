import { Type, type Static } from "@sinclair/typebox";

export const ReadinessStateSchema = Type.Union([
  Type.Literal("READY"),
  Type.Literal("ACTION_REQUIRED"),
  Type.Literal("BLOCKED"),
  Type.Literal("ERROR"),
  Type.Literal("NOT_APPLICABLE"),
]);

export type ReadinessState = Static<typeof ReadinessStateSchema>;

export const ReadinessKeySchema = Type.Union([
  Type.Literal("academic_year"),
  Type.Literal("jenjang"),
  Type.Literal("academic_periods"),
  Type.Literal("classes"),
  Type.Literal("calendar"),
  Type.Literal("students"),
  Type.Literal("enrollment"),
]);

export type ReadinessKey = Static<typeof ReadinessKeySchema>;

export const FeatureReadinessKeySchema = Type.Union([
  Type.Literal("MACHINE_IMPORT"),
]);

export type FeatureReadinessKey = Static<typeof FeatureReadinessKeySchema>;

export const ReadinessActionSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 128 }),
  route: Type.String({ pattern: "^/" }),
}, { additionalProperties: false });

export type ReadinessAction = Static<typeof ReadinessActionSchema>;

export const ReadinessItemSchema = Type.Object({
  key: ReadinessKeySchema,
  label: Type.String({ minLength: 1, maxLength: 128 }),
  state: ReadinessStateSchema,
  summary: Type.String({ minLength: 1, maxLength: 512 }),
  count: Type.Optional(Type.Number({ minimum: 0 })),
  blockers: Type.Optional(Type.Array(ReadinessKeySchema)),
  actions: Type.Array(ReadinessActionSchema),
}, { additionalProperties: false });

export type ReadinessItem = Static<typeof ReadinessItemSchema>;

export const FeatureReadinessSchema = Type.Object({
  key: FeatureReadinessKeySchema,
  label: Type.String({ minLength: 1, maxLength: 128 }),
  route: Type.String({ pattern: "^/" }),
  state: ReadinessStateSchema,
  blockers: Type.Array(ReadinessKeySchema),
  actions: Type.Array(ReadinessActionSchema),
}, { additionalProperties: false });

export type FeatureReadiness = Static<typeof FeatureReadinessSchema>;

export const ReadinessOverallSchema = Type.Object({
  state: ReadinessStateSchema,
  summary: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false });

export type ReadinessOverall = Static<typeof ReadinessOverallSchema>;

export const ReadinessLegacyStatusSchema = Type.Union([
  Type.Literal("FIRST_RUN"),
  Type.Literal("SETUP_PARTIAL"),
  Type.Literal("READY_WITH_RECOMMENDATIONS"),
  Type.Literal("OPERATIONALLY_READY"),
  Type.Literal("READ_ONLY_GUIDANCE"),
]);

export type ReadinessLegacyStatus = Static<typeof ReadinessLegacyStatusSchema>;

export const ReadinessLegacyStepStatusSchema = Type.Union([
  Type.Literal("NOT_STARTED"),
  Type.Literal("COMPLETE"),
  Type.Literal("OPTIONAL"),
]);

export type ReadinessLegacyStepStatus = Static<typeof ReadinessLegacyStepStatusSchema>;

export const ReadinessRequirementSchema = Type.Union([
  Type.Literal("REQUIRED"),
  Type.Literal("WORKFLOW"),
  Type.Literal("RECOMMENDED"),
  Type.Literal("OPTIONAL"),
]);

export type ReadinessRequirement = Static<typeof ReadinessRequirementSchema>;

export const ReadinessLegacyStepSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  status: ReadinessLegacyStepStatusSchema,
  requirement: ReadinessRequirementSchema,
  reason: Type.String({ minLength: 1, maxLength: 512 }),
  destination: Type.Union([Type.String({ pattern: "^/" }), Type.Null()]),
  can_manage: Type.Boolean(),
  responsibility: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
}, { additionalProperties: false });

export type ReadinessLegacyStep = Static<typeof ReadinessLegacyStepSchema>;

export const ReadinessResponseSchema = Type.Object({
  overall: ReadinessOverallSchema,
  foundation: Type.Array(ReadinessItemSchema),
  operational: Type.Array(ReadinessItemSchema),
  features: Type.Array(FeatureReadinessSchema),
  overall_status: ReadinessLegacyStatusSchema,
  steps: Type.Array(ReadinessLegacyStepSchema),
}, { additionalProperties: false });

export type ReadinessResponse = Static<typeof ReadinessResponseSchema>;
