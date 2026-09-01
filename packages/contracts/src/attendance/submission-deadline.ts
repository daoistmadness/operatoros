import { Type, type Static } from "@sinclair/typebox";

export const AttendanceSubmissionDeadlineTimeSchema = Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });
export const AttendanceSubmissionTimingStatusSchema = Type.Union([
  Type.Literal("BEFORE_DEADLINE"), Type.Literal("DEADLINE_PASSED"),
  Type.Literal("DEADLINE_UNKNOWN"), Type.Literal("NOT_APPLICABLE"),
]);
export const AttendanceSubmissionTimingSchema = Type.Object({
  status: AttendanceSubmissionTimingStatusSchema,
  deadlineLocalTime: Type.Union([AttendanceSubmissionDeadlineTimeSchema, Type.Null()]),
  deadlineAt: Type.Union([Type.String(), Type.Null()]),
  authorityAvailable: Type.Boolean(),
});
export const AttendanceSubmissionDeadlineRequestSchema = Type.Object({
  academic_year_id: Type.Integer({ minimum: 1 }),
  jenjang_id: Type.Integer({ minimum: 1 }),
  cutoff_time: Type.Union([AttendanceSubmissionDeadlineTimeSchema, Type.Null()]),
});
export type AttendanceSubmissionTiming = Static<typeof AttendanceSubmissionTimingSchema>;
export type AttendanceSubmissionDeadlineRequest = Static<typeof AttendanceSubmissionDeadlineRequestSchema>;
