import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const CountRow = Type.Object({ key: Type.String(), label: Type.String(), count: Type.Number({ minimum: 0 }), percentage: Type.Number({ minimum: 0, maximum: 100 }) });

export const ManagementReviewProfileQuerySchema = Type.Object({
  academic_year_id: Id,
  term_id: Id,
  jenjang_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
  residence_group_by: Type.Optional(Type.Union([Type.Literal("kelurahan"), Type.Literal("kecamatan"), Type.Literal("city_regency"), Type.Literal("province")])),
  residence_top_n: Type.Optional(Type.Union([Type.Literal("5"), Type.Literal("10"), Type.Literal("all")])),
});

export const ManagementReviewProfileResponseSchema = Type.Object({
  context: Type.Object({
    academicYearId: Type.Number({ minimum: 1 }), academicYearLabel: Type.String(), termId: Type.Number({ minimum: 1 }), termLabel: Type.String(),
    termStart: Type.String(), termEnd: Type.String(), jenjangId: Type.Union([Type.Number(), Type.Null()]), classId: Type.Union([Type.Number(), Type.Null()]),
    jenjangLabel: Type.Union([Type.String(), Type.Null()]), classLabel: Type.Union([Type.String(), Type.Null()]), generatedAt: Type.String(),
    demographicSemantics: Type.Literal("Current profile data for students enrolled in the selected term."),
  }),
  summary: Type.Object({ totalStudents: Type.Number({ minimum: 0 }), programs: Type.Number({ minimum: 0 }), classes: Type.Number({ minimum: 0 }), male: Type.Number({ minimum: 0 }), female: Type.Number({ minimum: 0 }), genderNotSpecified: Type.Number({ minimum: 0 }), needsCompletion: Type.Number({ minimum: 0 }) }),
  programs: Type.Array(Type.Intersect([CountRow, Type.Object({ id: Type.Number({ minimum: 1 }), classes: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), label: Type.String(), count: Type.Number({ minimum: 0 }) })) })])),
  gender: Type.Array(CountRow),
  residence: Type.Object({ groupBy: Type.String(), topN: Type.Union([Type.Number(), Type.Null()]), rows: Type.Array(CountRow) }),
  fatherOccupation: Type.Array(CountRow),
  motherOccupation: Type.Array(CountRow),
  dataQuality: Type.Object({ complete: Type.Number({ minimum: 0 }), needsCompletion: Type.Number({ minimum: 0 }), missing: Type.Object({ program: Type.Number({ minimum: 0 }), class: Type.Number({ minimum: 0 }), gender: Type.Number({ minimum: 0 }), residence: Type.Number({ minimum: 0 }), fatherOccupation: Type.Number({ minimum: 0 }), motherOccupation: Type.Number({ minimum: 0 }) }) }),
  insights: Type.Array(Type.String()),
});

export type ManagementReviewProfileQuery = Static<typeof ManagementReviewProfileQuerySchema>;
export type ManagementReviewProfileResponse = Static<typeof ManagementReviewProfileResponseSchema>;
