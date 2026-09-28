import { Type, type Static } from "@sinclair/typebox";
export * from "./manual-absence";

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
  class_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
  class_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  subject_id: Type.Optional(Type.Union([Type.Number({ minimum: 1 }), Type.Null()])),
});

export type ReportQuery = Static<typeof ReportQuerySchema>;

export const ReportFiltersResponseSchema = Type.Object({
  academic_years: Type.Array(Type.Object({
    id: Type.Number(), name: Type.String(), start_date: Type.String(), end_date: Type.String(), is_default: Type.Boolean(),
  })),
  default_academic_year_id: Type.Union([Type.Number(), Type.Null()]),
  months: Type.Array(Type.Object({ value: Type.String(), label: Type.String() })),
  scopes: Type.Array(Type.Object({ value: ReportScopeSchema, label: Type.String() })),
  classes: Type.Array(Type.String()),
  class_options: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String() })),
  subjects: Type.Array(Type.Object({ id: Type.Number(), name: Type.String(), jenjang_id: Type.Number(), jenjang_name: Type.String() })),
});

export type ReportFiltersResponse = Static<typeof ReportFiltersResponseSchema>;
