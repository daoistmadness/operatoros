import { Type, type Static } from "@sinclair/typebox";

export const StaffMonthlyActivityStatus = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("COMPLETED"),
  Type.Literal("NEEDS_CORRECTION"),
  Type.Literal("NOT_APPLICABLE"),
]);
export type StaffMonthlyActivityStatusDto = Static<typeof StaffMonthlyActivityStatus>;

const Month = Type.String({ pattern: "^[1-9][0-9]{3}-(0[1-9]|1[0-2])$" });
const ActivityId = Type.Integer({ minimum: 1 });
const SchoolUnitId = Type.Integer({ minimum: 1 });
const SchoolUnitIdQuery = Type.String({ pattern: "^[1-9][0-9]*$" });
const NullableString = Type.Union([Type.String(), Type.Null()]);

export const StaffMonthlyActivityListQuery = Type.Object({
  month: Month,
  school_unit_id: Type.Optional(SchoolUnitIdQuery),
  status: Type.Optional(StaffMonthlyActivityStatus),
}, { additionalProperties: false });
export type StaffMonthlyActivityListQueryDto = Static<typeof StaffMonthlyActivityListQuery>;

export const StaffMonthlyActivitySummaryQuery = Type.Object({
  from_month: Month,
  to_month: Month,
  school_unit_id: Type.Optional(SchoolUnitIdQuery),
}, { additionalProperties: false });
export type StaffMonthlyActivitySummaryQueryDto = Static<typeof StaffMonthlyActivitySummaryQuery>;

export const StaffMonthlyActivityExportQuery = Type.Object({
  month: Month,
  school_unit_id: Type.Optional(SchoolUnitIdQuery),
  status: Type.Optional(StaffMonthlyActivityStatus),
  format: Type.Union([Type.Literal("xlsx"), Type.Literal("pdf")]),
}, { additionalProperties: false });
export type StaffMonthlyActivityExportQueryDto = Static<typeof StaffMonthlyActivityExportQuery>;

export const StaffMonthlyActivityGenerateRequest = Type.Object({ month: Month }, { additionalProperties: false });
export type StaffMonthlyActivityGenerateRequestDto = Static<typeof StaffMonthlyActivityGenerateRequest>;

export const StaffMonthlyActivityUpdateRequest = Type.Object({
  expected_version: Type.Integer({ minimum: 1 }),
  status: Type.Optional(StaffMonthlyActivityStatus),
  confirmation_date: Type.Optional(Type.String({ minLength: 10, maxLength: 10 })),
  processing_notes: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
}, { minProperties: 2, additionalProperties: false });
export type StaffMonthlyActivityUpdateRequestDto = Static<typeof StaffMonthlyActivityUpdateRequest>;

export const StaffMonthlyActivityItem = Type.Object({
  id: ActivityId,
  staff_member_id: Type.String(),
  staff_code: NullableString,
  staff_name: Type.String(),
  school_unit_id: SchoolUnitId,
  school_unit_name: Type.String(),
  month: Month,
  status: StaffMonthlyActivityStatus,
  confirmation_date: NullableString,
  confirmed_by: NullableString,
  processing_notes: NullableString,
  version: Type.Integer({ minimum: 1 }),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type StaffMonthlyActivityItemDto = Static<typeof StaffMonthlyActivityItem>;

export const StaffMonthlyActivitySummary = Type.Object({
  month: Month,
  school_unit_id: Type.Union([SchoolUnitId, Type.Null()]),
  school_unit_name: NullableString,
  total_activities: Type.Integer({ minimum: 0 }),
  total_applicable: Type.Integer({ minimum: 0 }),
  completed: Type.Integer({ minimum: 0 }),
  pending: Type.Integer({ minimum: 0 }),
  needs_correction: Type.Integer({ minimum: 0 }),
  not_applicable: Type.Integer({ minimum: 0 }),
  completion_percentage: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
});
export type StaffMonthlyActivitySummaryDto = Static<typeof StaffMonthlyActivitySummary>;

export const StaffMonthlyActivityListResponse = Type.Object({
  period: Type.Object({ month: Month, generated: Type.Boolean(), generated_at: NullableString, generated_by: NullableString }),
  summary: StaffMonthlyActivitySummary,
  items: Type.Array(StaffMonthlyActivityItem),
});
export type StaffMonthlyActivityListResponseDto = Static<typeof StaffMonthlyActivityListResponse>;

export const StaffMonthlyActivityGenerateResponse = Type.Object({
  month: Month,
  generated_count: Type.Integer({ minimum: 0 }),
  already_generated: Type.Boolean(),
});
export type StaffMonthlyActivityGenerateResponseDto = Static<typeof StaffMonthlyActivityGenerateResponse>;

export const StaffMonthlyActivityHistoryItem = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  from_status: Type.Union([StaffMonthlyActivityStatus, Type.Null()]),
  to_status: StaffMonthlyActivityStatus,
  from_confirmation_date: NullableString,
  to_confirmation_date: NullableString,
  from_confirmed_by: NullableString,
  to_confirmed_by: NullableString,
  from_processing_notes: NullableString,
  to_processing_notes: NullableString,
  action: Type.Union([Type.Literal("GENERATED"), Type.Literal("STATUS_CHANGED"), Type.Literal("NOTES_UPDATED"), Type.Literal("CORRECTION")]),
  reason: NullableString,
  actor: Type.String(),
  occurred_at: Type.String(),
});
export type StaffMonthlyActivityHistoryItemDto = Static<typeof StaffMonthlyActivityHistoryItem>;

export const StaffMonthlyActivityHistoryResponse = Type.Object({ items: Type.Array(StaffMonthlyActivityHistoryItem) });
export type StaffMonthlyActivityHistoryResponseDto = Static<typeof StaffMonthlyActivityHistoryResponse>;

export const StaffMonthlyActivityTrendResponse = Type.Object({ items: Type.Array(StaffMonthlyActivitySummary) });
export type StaffMonthlyActivityTrendResponseDto = Static<typeof StaffMonthlyActivityTrendResponse>;
