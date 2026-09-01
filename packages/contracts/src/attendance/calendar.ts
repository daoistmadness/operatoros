import { Type, type Static } from "@sinclair/typebox";

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

export type AttendanceCalendarStatus = Static<typeof AttendanceCalendarStatusSchema>;
export type AttendanceCalendarReason = Static<typeof AttendanceCalendarReasonSchema>;
export type AttendanceCalendarExpectation = Static<typeof AttendanceCalendarExpectationSchema>;
export type AttendanceCalendarOverview = Static<typeof AttendanceCalendarOverviewResponseSchema>;
export type AttendanceCalendarWeekdayRequest = Static<typeof AttendanceCalendarWeekdayRequestSchema>;
export type AttendanceCalendarExceptionRequest = Static<typeof AttendanceCalendarExceptionRequestSchema>;
