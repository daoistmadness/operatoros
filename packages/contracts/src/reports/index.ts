import { Type, type Static } from "@sinclair/typebox";

export const ReportScopeSchema = Type.Union([
  Type.Literal("combined"),
  Type.Literal("early_year"),
  Type.Literal("primary"),
  Type.Literal("secondary"),
]);

export type ReportScope = Static<typeof ReportScopeSchema>;

export const ReportQuerySchema = Type.Object({
  academic_year_id: Type.Number({ minimum: 1 }),
  scope: ReportScopeSchema,
  month: Type.Optional(Type.String()),
  class_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  subject_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
});

export type ReportQuery = Static<typeof ReportQuerySchema>;
