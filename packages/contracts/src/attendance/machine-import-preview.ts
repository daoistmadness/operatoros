import { Type, type Static } from "@sinclair/typebox";
import { AttendanceCalendarExpectationSchema } from "./calendar";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const MatchingState = Type.Union([
  Type.Literal("MATCHED"), Type.Literal("UNMAPPED"), Type.Literal("AMBIGUOUS"),
  Type.Literal("INVALID_IDENTIFIER"), Type.Literal("INVALID_SOURCE_ROW"),
]);
const MachineEvidence = Type.Union([
  Type.Literal("SCAN_PRESENT"), Type.Literal("NO_SCAN"), Type.Literal("MULTIPLE_SCANS"), Type.Literal("INVALID_SCAN_VALUE"), Type.Literal("UNSUPPORTED_SOURCE_STATUS"),
]);
const ReconciliationState = Type.Union([
  Type.Literal("SCAN_EXPECTED"), Type.Literal("NO_SCAN_EXPECTED"), Type.Literal("NO_SCAN_NOT_EXPECTED"),
  Type.Literal("SCAN_NOT_EXPECTED"), Type.Literal("EXPECTATION_UNKNOWN"), Type.Literal("INVALID_SCAN"),
  Type.Literal("UNSUPPORTED_SOURCE_STATUS"), Type.Literal("UNMAPPED"), Type.Literal("AMBIGUOUS"), Type.Literal("INVALID_SOURCE_ROW"),
]);
const ApplyClassification = Type.Union([
  Type.Literal("ELIGIBLE_CREATE"), Type.Literal("NOOP_ALREADY_CANONICAL"),
  Type.Literal("CONFLICT_EXISTING_ATTENDANCE"), Type.Literal("CONFLICT_EXISTING_OVERRIDE"),
  Type.Literal("BLOCKED_NO_SCAN"), Type.Literal("BLOCKED_MULTIPLE_SCANS_UNCLEAR"), Type.Literal("BLOCKED_INVALID_SCAN"),
  Type.Literal("BLOCKED_UNSUPPORTED_SOURCE_STATUS"), Type.Literal("BLOCKED_UNMAPPED"), Type.Literal("BLOCKED_AMBIGUOUS"),
  Type.Literal("BLOCKED_NO_ACTIVE_ENROLLMENT"), Type.Literal("BLOCKED_AMBIGUOUS_ENROLLMENT"), Type.Literal("BLOCKED_OUT_OF_SCOPE"),
  Type.Literal("BLOCKED_CALENDAR_NOT_EXPECTED"), Type.Literal("BLOCKED_CALENDAR_UNKNOWN"), Type.Literal("BLOCKED_FUTURE_DATE"),
  Type.Literal("BLOCKED_FINALIZED_PERIOD"), Type.Literal("BLOCKED_INCOMPLETE_SCAN"), Type.Literal("BLOCKED_INVALID_SOURCE_ROW"),
]);
export type MachineImportApplyClassification = Static<typeof ApplyClassification>;

const ResolutionClass = Type.Union([
  Type.Literal("ATTENDANCE_REVIEW"), Type.Literal("ATTENDANCE_CORRECTION"),
  Type.Literal("STUDENT_DATA_RESOLUTION"), Type.Literal("ENROLLMENT_RESOLUTION"),
  Type.Literal("CALENDAR_RESOLUTION"), Type.Literal("SOURCE_FILE_REVIEW"),
  Type.Literal("NO_ACTION_REQUIRED"), Type.Literal("NOT_RESOLVABLE_IN_OPERATOROS"),
]);
const ResolutionTarget = Type.Object({
  type: Type.Union([
    Type.Literal("ATTENDANCE_REVIEW"), Type.Literal("ATTENDANCE_CORRECTION"),
    Type.Literal("STUDENT_DATA_RESOLUTION"), Type.Literal("ENROLLMENT_RESOLUTION"),
    Type.Literal("CALENDAR_RESOLUTION"),
  ]),
  path: Type.String({ pattern: "^/" }),
  label: Type.String({ minLength: 1 }),
});
const Resolution = Type.Object({
  class: ResolutionClass,
  note: Type.String({ minLength: 1 }),
  target: Type.Union([ResolutionTarget, Type.Null()]),
});

const StudentSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  masterId: NullableString,
  name: Type.String({ minLength: 1 }),
  className: NullableString,
  jenjang: NullableString,
});
const IdentityReview = Type.Object({
  deviceIdentifier: Type.String({ minLength: 1 }),
  machineName: NullableString,
  effectiveFrom: NullableString,
  occurrences: Type.Number({ minimum: 1 }),
});

export const MachineImportPreviewResponseSchema = Type.Object({
  previewOnly: Type.Literal(true),
  fileFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  previewDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
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
    eligibleCreates: Type.Number({ minimum: 0 }),
    alreadyCanonical: Type.Number({ minimum: 0 }),
    conflicts: Type.Number({ minimum: 0 }),
    blocked: Type.Number({ minimum: 0 }),
    blockedByClassification: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
  }),
  identityReview: Type.Array(IdentityReview),
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
    applyClassification: ApplyClassification,
    canonicalStatus: NullableString,
    existingAttendance: Type.Union([Type.Object({ baseStatus: Type.String({ minLength: 1 }), effectiveStatus: Type.String({ minLength: 1 }), hasOverride: Type.Boolean() }), Type.Null()]),
    resolution: Resolution,
  })),
  pagination: Type.Object({ page: Type.Number({ minimum: 1 }), pageSize: Type.Number({ minimum: 1 }), total: Type.Number({ minimum: 0 }) }),
});

export type MachineImportPreviewResponse = Static<typeof MachineImportPreviewResponseSchema>;

export const MachineImportApplyResponseSchema = Type.Object({
  status: Type.Literal("APPLIED"),
  batchId: Type.String({ minLength: 1 }),
  fileFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  appliedAt: Type.String({ minLength: 1 }),
  summary: Type.Object({
    rowsInspected: Type.Number({ minimum: 0 }),
    created: Type.Number({ minimum: 0 }),
    alreadyCanonical: Type.Number({ minimum: 0 }),
    conflicts: Type.Number({ minimum: 0 }),
    blocked: Type.Number({ minimum: 0 }),
    blockedByClassification: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
  }),
});

export type MachineImportApplyResponse = Static<typeof MachineImportApplyResponseSchema>;
