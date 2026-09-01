import { Type, type Static } from "@sinclair/typebox";
export * from "./calendar";
export * from "./submission-deadline";
export * from "./correction-review";
export * from "./machine-import-preview";
import { AttendanceCalendarExpectationSchema } from "./calendar";
import { AttendanceSubmissionTimingSchema } from "./submission-deadline";

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

const DailyAttendanceDateSchema = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });

export const DailyAttendanceOperationsQuerySchema = Type.Object({
  date: DailyAttendanceDateSchema,
  academic_year_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  class_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

const DailyAttendanceCountsSchema = Type.Object({
  present: Type.Number({ minimum: 0 }),
  late: Type.Number({ minimum: 0 }),
  sakit: Type.Number({ minimum: 0 }),
  izin: Type.Number({ minimum: 0 }),
  alfa: Type.Number({ minimum: 0 }),
  absent: Type.Number({ minimum: 0 }),
  incomplete: Type.Number({ minimum: 0 }),
});

const DailyAttendanceClassSchema = Type.Object({
  classId: Type.Number({ minimum: 1 }),
  className: Type.String({ minLength: 1 }),
  jenjang: Type.String({ minLength: 1 }),
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.String({ minLength: 1 }),
  expectedStudentCount: Type.Number({ minimum: 0 }),
  recordedStudentCount: Type.Number({ minimum: 0 }),
  unrecordedStudentCount: Type.Number({ minimum: 0 }),
  coverageState: Type.Union([Type.Literal("COMPLETE"), Type.Literal("PARTIAL"), Type.Literal("NONE"), Type.Literal("EMPTY_CLASS")]),
  coveragePercent: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  counts: DailyAttendanceCountsSchema,
  periodFinalized: Type.Boolean(),
  attendanceExpectation: AttendanceCalendarExpectationSchema,
  submissionTiming: AttendanceSubmissionTimingSchema,
});

export const DailyAttendanceOperationsResponseSchema = Type.Object({
  scope: Type.Object({
    date: DailyAttendanceDateSchema,
    academicYearId: Type.Number({ minimum: 1 }),
    academicYearLabel: Type.String({ minLength: 1 }),
    jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    schoolDayAuthority: Type.Literal("AVAILABLE"),
  }),
  totals: Type.Object({
    classes: Type.Number({ minimum: 0 }),
    expectedStudents: Type.Number({ minimum: 0 }),
    recordedStudents: Type.Number({ minimum: 0 }),
    unrecordedStudents: Type.Number({ minimum: 0 }),
    completeClasses: Type.Number({ minimum: 0 }),
    partialClasses: Type.Number({ minimum: 0 }),
    noRecordClasses: Type.Number({ minimum: 0 }),
    emptyClasses: Type.Number({ minimum: 0 }),
    expectedClasses: Type.Number({ minimum: 0 }),
    notExpectedClasses: Type.Number({ minimum: 0 }),
    unknownClasses: Type.Number({ minimum: 0 }),
  }),
  classes: Type.Array(DailyAttendanceClassSchema),
});

export type DailyAttendanceOperationsQuery = Static<typeof DailyAttendanceOperationsQuerySchema>;
export type DailyAttendanceOperationsResponse = Static<typeof DailyAttendanceOperationsResponseSchema>;
