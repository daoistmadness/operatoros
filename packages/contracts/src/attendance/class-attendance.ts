import { Type, type Static } from "@sinclair/typebox";

const AttendanceDateSchema = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const AttendanceTimeSchema = Type.Union([
  Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
  Type.Null(),
]);

export const ClassAttendanceRosterItemSchema = Type.Object({
  student_id: Type.Number({ minimum: 1 }),
  student_name: Type.String({ minLength: 1 }),
  attendance_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  raw_status: Type.String({ minLength: 1 }),
  effective_status: Type.String({ minLength: 1 }),
  is_overridden: Type.Boolean(),
  scan_in: AttendanceTimeSchema,
  scan_out: AttendanceTimeSchema,
  is_absent: Type.Boolean(),
  pending_correction: Type.Boolean(),
  correction_request_id: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
}, { additionalProperties: false });

export const ClassAttendanceResponseSchema = Type.Object({
  class_id: Type.Number({ minimum: 1 }),
  class_name: Type.String({ minLength: 1 }),
  date: AttendanceDateSchema,
  is_finalized: Type.Boolean(),
  total_enrolled: Type.Number({ minimum: 0 }),
  items: Type.Array(ClassAttendanceRosterItemSchema),
}, { additionalProperties: false });

export const ClassAttendanceEntriesResponseSchema = Type.Object({
  class_id: Type.Number({ minimum: 1 }),
  date: AttendanceDateSchema,
  total_submitted: Type.Number({ minimum: 0 }),
  created: Type.Number({ minimum: 0 }),
  updated: Type.Number({ minimum: 0 }),
  submitted_by: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type ClassAttendanceRosterItem = Static<typeof ClassAttendanceRosterItemSchema>;
export type ClassAttendanceResponse = Static<typeof ClassAttendanceResponseSchema>;
export type ClassAttendanceEntriesResponse = Static<typeof ClassAttendanceEntriesResponseSchema>;
