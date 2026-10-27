import { Type, type Static } from "@sinclair/typebox";

export const DashboardOperationalOverviewSchema = Type.Object({
  students: Type.Object({
    active_count: Type.Integer(),
    nisn_inputted_count: Type.Integer(),
    nisn_not_inputted_count: Type.Integer(),
    pending_verification_count: Type.Integer(),
  }),
  staff: Type.Object({
    active_count: Type.Integer(),
    monthly_ptk_completed_count: Type.Integer(),
    monthly_ptk_pending_count: Type.Integer(),
  }),
  upp: Type.Object({
    current_period: Type.String(),
    status: Type.Union([Type.String(), Type.Null()]),
    has_workbook: Type.Boolean(),
    submitted_at: Type.Union([Type.String(), Type.Null()]),
  }),
});

export type DashboardOperationalOverviewResponse = Static<typeof DashboardOperationalOverviewSchema>;

export const BospReminderStatusSchema = Type.Object({
  calendar_year: Type.Integer(),
  cutoff_date: Type.String(),
  advance_notice_days: Type.Integer(),
  is_in_notice_window: Type.Boolean(),
  days_remaining: Type.Integer(),
  is_acknowledged: Type.Boolean(),
  acknowledged_at: Type.Union([Type.String(), Type.Null()]),
  acknowledged_by: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  is_blocking: Type.Boolean(),
});

export type BospReminderStatusResponse = Static<typeof BospReminderStatusSchema>;

export const BospAcknowledgePayloadSchema = Type.Object({
  calendar_year: Type.Integer({ minimum: 2020, maximum: 2099 }),
  notes: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
});

export type BospAcknowledgePayload = Static<typeof BospAcknowledgePayloadSchema>;

export const OperatorWorkQueueItemSchema = Type.Object({
  item_type: Type.String(),
  source_id: Type.String(),
  deduplication_key: Type.String(),
  student_reference: Type.Union([Type.String(), Type.Integer(), Type.Null()]),
  student_display_label: Type.String(),
  class_reference: Type.Union([Type.String(), Type.Null()]),
  jenjang_reference: Type.Union([Type.String(), Type.Null()]),
  event_date: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
  evidence_summary: Type.String(),
  workflow_status: Type.String(),
  priority: Type.String(),
  due_at: Type.Union([Type.String(), Type.Null()]),
  derived_due_state: Type.String(),
  available_actions: Type.Array(Type.String()),
  source_route: Type.String(),
  last_activity_timestamp: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Any()),
});

export type OperatorWorkQueueItem = Static<typeof OperatorWorkQueueItemSchema>;
