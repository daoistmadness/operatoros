import { Type, type Static } from "@sinclair/typebox";

export const AttendancePeriodFinalizeRequestSchema = Type.Object({
  attendance_date: Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" }),
  reason: Type.String({ minLength: 5, maxLength: 1000 }),
  confirmation: Type.Literal("FINALIZE_ATTENDANCE_PERIOD"),
  acknowledge_ledger_warning: Type.Optional(Type.Boolean()),
});

export const AttendanceLedgerFinalizeWarningSchema = Type.Object({
  class_id: Type.Integer({ minimum: 1 }),
  class_name: Type.String(),
  month: Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }),
  ledger_state: Type.Union([Type.Literal("MISSING"), Type.Literal("OPEN")]),
});

export const AttendancePeriodFinalizeResponseSchema = Type.Object({
  attendance_date: Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" }),
  status: Type.Literal("FINALIZED"),
  version: Type.Integer({ minimum: 1 }),
  finalized_by: Type.String(),
  ledger_warning: Type.Array(AttendanceLedgerFinalizeWarningSchema),
  warning_acknowledged: Type.Boolean(),
});

export type AttendancePeriodFinalizeRequest = Static<typeof AttendancePeriodFinalizeRequestSchema>;
export type AttendanceLedgerFinalizeWarning = Static<typeof AttendanceLedgerFinalizeWarningSchema>;
export type AttendancePeriodFinalizeResponse = Static<typeof AttendancePeriodFinalizeResponseSchema>;
