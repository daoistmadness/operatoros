import { Type, type Static } from "@sinclair/typebox";
import { AttendanceSubmissionDeadlineTimeSchema } from "./submission-deadline";

export const AttendanceCalendarDateSchema = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
export const AttendanceCalendarRuleValueSchema = Type.Union([
  Type.Literal("EXPECTED"),
  Type.Literal("NOT_EXPECTED"),
]);
export const AttendanceCalendarStatusSchema = Type.Union([
  Type.Literal("EXPECTED"),
  Type.Literal("NOT_EXPECTED"),
  Type.Literal("UNKNOWN"),
]);
export const AttendanceCalendarReasonSchema = Type.Union([
  Type.Literal("HOLIDAY"),
  Type.Literal("SCHOOL_BREAK"),
  Type.Literal("SCHOOL_CLOSED"),
  Type.Literal("NON_INSTRUCTIONAL_DAY"),
  Type.Literal("PROGRAM_NOT_IN_SESSION"),
  Type.Literal("REPLACEMENT_SCHOOL_DAY"),
  Type.Literal("SPECIAL_INSTRUCTIONAL_DAY"),
]);
export const AttendanceCalendarSourceSchema = Type.Union([
  Type.Literal("DATE_EXCEPTION"),
  Type.Literal("WEEKDAY_RULE"),
  Type.Literal("NONE"),
]);

const Id = Type.Integer({ minimum: 1 });

export const AttendanceCalendarExpectationSchema = Type.Object({
  status: AttendanceCalendarStatusSchema,
  reason: Type.Union([AttendanceCalendarReasonSchema, Type.Literal("OUTSIDE_ACADEMIC_YEAR"), Type.Null()]),
  source: AttendanceCalendarSourceSchema,
});

export const AttendanceCalendarOverviewQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
});

const AttendanceCalendarWeekdaySchema = Type.Object({
  weekday: Type.Integer({ minimum: 0, maximum: 6 }),
  expectation: Type.Union([AttendanceCalendarRuleValueSchema, Type.Null()]),
});

const AttendanceCalendarExceptionSchema = Type.Object({
  id: Id,
  date: AttendanceCalendarDateSchema,
  expectation: AttendanceCalendarRuleValueSchema,
  reason: AttendanceCalendarReasonSchema,
});

export const AttendanceCalendarOverviewResponseSchema = Type.Object({
  scope: Type.Object({
    academicYearId: Id,
    academicYearLabel: Type.String({ minLength: 1 }),
    startDate: AttendanceCalendarDateSchema,
    endDate: AttendanceCalendarDateSchema,
  }),
  jenjangs: Type.Array(Type.Object({
    id: Id,
    name: Type.String({ minLength: 1 }),
    weekdays: Type.Array(AttendanceCalendarWeekdaySchema, { minItems: 7, maxItems: 7 }),
    exceptions: Type.Array(AttendanceCalendarExceptionSchema),
    submissionDeadlineLocalTime: Type.Union([AttendanceSubmissionDeadlineTimeSchema, Type.Null()]),
  })),
});

export const AttendanceCalendarWeekdayRequestSchema = Type.Object({
  academic_year_id: Id,
  jenjang_id: Id,
  weekday: Type.Integer({ minimum: 0, maximum: 6 }),
  expectation: Type.Union([AttendanceCalendarRuleValueSchema, Type.Null()]),
});

export const AttendanceCalendarExceptionRequestSchema = Type.Object({
  id: Type.Optional(Id),
  academic_year_id: Id,
  jenjang_id: Id,
  date: AttendanceCalendarDateSchema,
  expectation: AttendanceCalendarRuleValueSchema,
  reason: AttendanceCalendarReasonSchema,
});

export const AttendanceCalendarExceptionParamsSchema = Type.Object({ id: Type.String({ pattern: "^[1-9]\\d*$" }) });

export const AttendanceCalendarPeriodRequestSchema = Type.Object({
  academic_year_id: Id,
  jenjang_id: Id,
  start_date: AttendanceCalendarDateSchema,
  end_date: AttendanceCalendarDateSchema,
  expectation: AttendanceCalendarRuleValueSchema,
  reason: AttendanceCalendarReasonSchema,
});

const AttendanceCalendarPeriodRowSchema = Type.Object({
  date: AttendanceCalendarDateSchema,
  classification: Type.Union([
    Type.Literal("CREATE"),
    Type.Literal("NOOP_SAME"),
    Type.Literal("CONFLICT_EXISTING_EXCEPTION"),
  ]),
  existingExpectation: Type.Union([AttendanceCalendarRuleValueSchema, Type.Null()]),
  existingReason: Type.Union([AttendanceCalendarReasonSchema, Type.Null()]),
});

const AttendanceCalendarPeriodSummarySchema = Type.Object({
  totalDates: Type.Integer({ minimum: 0 }),
  creates: Type.Integer({ minimum: 0 }),
  noops: Type.Integer({ minimum: 0 }),
  conflicts: Type.Integer({ minimum: 0 }),
});

export const AttendanceCalendarPeriodPreviewResponseSchema = Type.Object({
  request: AttendanceCalendarPeriodRequestSchema,
  summary: AttendanceCalendarPeriodSummarySchema,
  rows: Type.Array(AttendanceCalendarPeriodRowSchema, { maxItems: 366 }),
  previewDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});

export const AttendanceCalendarPeriodApplyRequestSchema = Type.Object({
  academic_year_id: Id,
  jenjang_id: Id,
  start_date: AttendanceCalendarDateSchema,
  end_date: AttendanceCalendarDateSchema,
  expectation: AttendanceCalendarRuleValueSchema,
  reason: AttendanceCalendarReasonSchema,
  preview_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  confirmation: Type.Literal("APPLY_ATTENDANCE_CALENDAR_PERIOD"),
});

export const AttendanceCalendarPeriodApplyResponseSchema = Type.Object({
  status: Type.Literal("applied"),
  summary: Type.Object({
    created: Type.Integer({ minimum: 0 }),
    noops: Type.Integer({ minimum: 0 }),
    conflicts: Type.Integer({ minimum: 0 }),
  }),
});

export type AttendanceCalendarStatus = Static<typeof AttendanceCalendarStatusSchema>;
export type AttendanceCalendarReason = Static<typeof AttendanceCalendarReasonSchema>;
export type AttendanceCalendarExpectation = Static<typeof AttendanceCalendarExpectationSchema>;
export type AttendanceCalendarOverview = Static<typeof AttendanceCalendarOverviewResponseSchema>;
export type AttendanceCalendarWeekdayRequest = Static<typeof AttendanceCalendarWeekdayRequestSchema>;
export type AttendanceCalendarExceptionRequest = Static<typeof AttendanceCalendarExceptionRequestSchema>;
export type AttendanceCalendarPeriodRequest = Static<typeof AttendanceCalendarPeriodRequestSchema>;
export type AttendanceCalendarPeriodPreviewResponse = Static<typeof AttendanceCalendarPeriodPreviewResponseSchema>;
export type AttendanceCalendarPeriodApplyRequest = Static<typeof AttendanceCalendarPeriodApplyRequestSchema>;
export type AttendanceCalendarPeriodApplyResponse = Static<typeof AttendanceCalendarPeriodApplyResponseSchema>;
