import { Type, type Static } from "@sinclair/typebox";

export const ExcelWorksheetDtoSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 31 }),
  headers: Type.Array(Type.String({ minLength: 1 })),
  rows: Type.Array(Type.Array(Type.Unknown())),
});

export type ExcelWorksheetDto = Static<typeof ExcelWorksheetDtoSchema>;
