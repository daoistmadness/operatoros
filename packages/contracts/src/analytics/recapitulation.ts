import { Type, type Static } from "@sinclair/typebox";

export const StudentRecapDimensionSchema = Type.Union([
  Type.Literal("gender"),
  Type.Literal("religion"),
  Type.Literal("jenjang"),
  Type.Literal("class"),
  Type.Literal("age"),
  Type.Literal("status"),
]);

export const StaffRecapDimensionSchema = Type.Union([
  Type.Literal("employment"),
  Type.Literal("job_title"),
  Type.Literal("education"),
  Type.Literal("jenjang"),
]);

export const RecapRowSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  count: Type.Number({ minimum: 0 }),
  percentage: Type.Number({ minimum: 0, maximum: 100 }),
});

export const RecapMatrixColumnSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
});

export const RecapMatrixRowSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  cells: Type.Array(Type.Number({ minimum: 0 })),
  rowTotal: Type.Number({ minimum: 0 }),
});

export const RecapMatrixSchema = Type.Object({
  columns: Type.Array(RecapMatrixColumnSchema),
  rows: Type.Array(RecapMatrixRowSchema),
  columnTotals: Type.Array(Type.Number({ minimum: 0 })),
  grandTotal: Type.Number({ minimum: 0 }),
});

export const StudentRecapResponseSchema = Type.Object({
  scope: Type.Object({
    academicYearLabel: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
    jenjangId: Type.Union([Type.Number(), Type.Null()]),
    classId: Type.Union([Type.Number(), Type.Null()]),
  }),
  total: Type.Number({ minimum: 0 }),
  summary: Type.Object({
    male: Type.Number({ minimum: 0 }),
    female: Type.Number({ minimum: 0 }),
    genderUnknown: Type.Number({ minimum: 0 }),
    classes: Type.Number({ minimum: 0 }),
    jenjangCount: Type.Number({ minimum: 0 }),
  }),
  dimension: StudentRecapDimensionSchema,
  rows: Type.Array(RecapRowSchema),
  matrix: Type.Union([RecapMatrixSchema, Type.Null()]),
  unknownCount: Type.Number({ minimum: 0 }),
  generatedAt: Type.String(),
});

export const StaffRecapResponseSchema = Type.Object({
  scope: Type.Object({
    employmentStatus: Type.String(),
    jenjangId: Type.Union([Type.Number(), Type.Null()]),
  }),
  total: Type.Number({ minimum: 0 }),
  dimension: StaffRecapDimensionSchema,
  rows: Type.Array(RecapRowSchema),
  unknownCount: Type.Number({ minimum: 0 }),
  generatedAt: Type.String(),
});

export type StudentRecapDimension = Static<typeof StudentRecapDimensionSchema>;
export type StaffRecapDimension = Static<typeof StaffRecapDimensionSchema>;
export type RecapRow = Static<typeof RecapRowSchema>;
export type RecapMatrix = Static<typeof RecapMatrixSchema>;
export type StudentRecapResponse = Static<typeof StudentRecapResponseSchema>;
export type StaffRecapResponse = Static<typeof StaffRecapResponseSchema>;
