import { Type, type Static } from "@sinclair/typebox";
import { AttendanceCalendarExpectationSchema } from "./calendar";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const MatchingState = Type.Union([
  Type.Literal("MATCHED"), Type.Literal("UNMAPPED"), Type.Literal("AMBIGUOUS"),
  Type.Literal("INVALID_IDENTIFIER"), Type.Literal("INVALID_SOURCE_ROW"),
]);
const MachineEvidence = Type.Union([
  Type.Literal("SCAN_PRESENT"), Type.Literal("NO_SCAN"), Type.Literal("MULTIPLE_SCANS"), Type.Literal("INVALID_SCAN_VALUE"),
]);
const ReconciliationState = Type.Union([
  Type.Literal("SCAN_EXPECTED"), Type.Literal("NO_SCAN_EXPECTED"), Type.Literal("NO_SCAN_NOT_EXPECTED"),
  Type.Literal("SCAN_NOT_EXPECTED"), Type.Literal("EXPECTATION_UNKNOWN"), Type.Literal("INVALID_SCAN"),
  Type.Literal("UNMAPPED"), Type.Literal("AMBIGUOUS"), Type.Literal("INVALID_SOURCE_ROW"),
]);

const StudentSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  masterId: NullableString,
  name: Type.String({ minLength: 1 }),
  className: NullableString,
  jenjang: NullableString,
});

export const MachineImportPreviewResponseSchema = Type.Object({
  previewOnly: Type.Literal(true),
  workbook: Type.Object({
    detectedProfile: Type.String({ minLength: 1 }),
    sheet: Type.String({ minLength: 1 }),
    dimensions: Type.String({ minLength: 1 }),
    sourceRows: Type.Number({ minimum: 0 }),
    dateCoverage: Type.Object({ from: NullableString, to: NullableString, distinctDates: Type.Number({ minimum: 0 }) }),
    warnings: Type.Array(Type.String()),
  }),
  summary: Type.Object({
    matchedStudents: Type.Number({ minimum: 0 }),
    unmappedStudents: Type.Number({ minimum: 0 }),
    ambiguousStudents: Type.Number({ minimum: 0 }),
    invalidIdentifiers: Type.Number({ minimum: 0 }),
    scanFacts: Type.Number({ minimum: 0 }),
    multipleScans: Type.Number({ minimum: 0 }),
    expectedNoScan: Type.Number({ minimum: 0 }),
    notExpectedNoScan: Type.Number({ minimum: 0 }),
    expectationUnknown: Type.Number({ minimum: 0 }),
  }),
  rows: Type.Array(Type.Object({
    date: NullableString,
    sourceStudentName: NullableString,
    machineStudentIdentifier: NullableString,
    matchingState: MatchingState,
    student: Type.Union([StudentSchema, Type.Null()]),
    machineEvidence: MachineEvidence,
    scanTimes: Type.Array(Type.String()),
    expectation: AttendanceCalendarExpectationSchema,
    reconciliationState: ReconciliationState,
  })),
  pagination: Type.Object({ page: Type.Number({ minimum: 1 }), pageSize: Type.Number({ minimum: 1 }), total: Type.Number({ minimum: 0 }) }),
});

export type MachineImportPreviewResponse = Static<typeof MachineImportPreviewResponseSchema>;
