import { Type, type Static } from "@sinclair/typebox";

export const RosterImportPayloadValueSchema = Type.Union([Type.String(), Type.Number(), Type.Null()]);

export const RosterImportPreviewRowSchema = Type.Object({
  preview_row_id: Type.Number(),
  source_sheet: Type.String(),
  source_row: Type.Number(),
  classification: Type.String(),
  matched_student_master_id: Type.Union([Type.String(), Type.Null()]),
  match_rule: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), RosterImportPayloadValueSchema),
  errors: Type.Array(Type.String()),
});
export type RosterImportPreviewRow = Static<typeof RosterImportPreviewRowSchema>;

export const RosterImportSummarySchema = Type.Object({
  total: Type.Number(),
  create_enrollment: Type.Number(),
  create_new_master: Type.Number(),
  possible_duplicate: Type.Number(),
  class_not_found: Type.Number(),
  class_inactive: Type.Number(),
  class_context_conflict: Type.Number(),
  ambiguous_class: Type.Number(),
  invalid: Type.Number(),
});
export type RosterImportSummary = Static<typeof RosterImportSummarySchema>;

export const RosterImportPreviewSchema = Type.Object({
  preview_id: Type.String(),
  checksum: Type.String(),
  status: Type.Literal("preview"),
  preview_checksum: Type.String(),
  plan_token: Type.String(),
  summary: RosterImportSummarySchema,
  rows: Type.Array(RosterImportPreviewRowSchema),
});
export type RosterImportPreview = Static<typeof RosterImportPreviewSchema>;

export const RosterImportCommitRequestSchema = Type.Object({
  preview_id: Type.String({ minLength: 1 }),
  selected_row_ids: Type.Array(Type.Number({ minimum: 1 }), { minItems: 1 }),
  confirmation: Type.String(),
  preview_checksum: Type.Optional(Type.String()),
  plan_token: Type.Optional(Type.String()),
});
export type RosterImportCommitRequest = Static<typeof RosterImportCommitRequestSchema>;

export const RosterImportCommitResponseSchema = Type.Object({
  status: Type.Literal("committed"),
  preview_id: Type.String(),
  created: Type.Number(),
  students_created: Type.Number(),
});
export type RosterImportCommitResponse = Static<typeof RosterImportCommitResponseSchema>;

export const StudentUpdateRowSchema = Type.Object({
  id: Type.Number(),
  source_row: Type.Number(),
  classification: Type.String(),
  student_master_id: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
  differences: Type.Record(Type.String(), Type.Object({
    current: Type.Unknown(),
    uploaded: Type.Unknown(),
    action: Type.Optional(Type.String()),
  })),
  errors: Type.Array(Type.Object({
    code: Type.String(),
    field: Type.Optional(Type.String()),
    message: Type.String(),
    owner: Type.Optional(Type.String()),
  })),
  selected: Type.Boolean(),
});
export type StudentUpdateRow = Static<typeof StudentUpdateRowSchema>;

export const StudentUpdateSummarySchema = Type.Object({
  total: Type.Number(),
  updates: Type.Number(),
  unchanged: Type.Number(),
  conflicts: Type.Number(),
  invalid: Type.Number(),
});
export type StudentUpdateSummary = Static<typeof StudentUpdateSummarySchema>;

export const StudentUpdateImportSchema = Type.Object({
  id: Type.String(),
  session_id: Type.String(),
  filename: Type.String(),
  file_checksum: Type.String(),
  status: Type.String(),
  rollback_state: Type.String(),
  applied_action_count: Type.Number(),
  rollback_action_count: Type.Number(),
  rollback_unavailable_reason: Type.Union([Type.String(), Type.Null()]),
  created_by: Type.String(),
  created_at: Type.String(),
  committed_at: Type.Union([Type.String(), Type.Null()]),
  preview_checksum: Type.String(),
  summary: StudentUpdateSummarySchema,
  rows: Type.Array(StudentUpdateRowSchema),
});
export type StudentUpdateImport = Static<typeof StudentUpdateImportSchema>;

export const StudentUpdatePreviewSchema = StudentUpdateImportSchema;
export type StudentUpdatePreview = StudentUpdateImport;

export const StudentUpdateCommitRequestSchema = Type.Object({
  selected_row_ids: Type.Array(Type.Number(), { minItems: 1 }),
  confirmation: Type.Literal("COMMIT_STUDENT_DATA_UPDATE"),
  preview_checksum: Type.String({ minLength: 64, maxLength: 64 }),
});
export type StudentUpdateCommitRequest = Static<typeof StudentUpdateCommitRequestSchema>;

export const StudentUpdateCommitResponseSchema = Type.Object({
  status: Type.Literal("committed"),
  batch_id: Type.String(),
  updated: Type.Number(),
  idempotent_replay: Type.Boolean(),
});
export type StudentUpdateCommitResponse = Static<typeof StudentUpdateCommitResponseSchema>;

export const StudentUpdateHistoryResponseSchema = Type.Object({
  items: Type.Array(StudentUpdateImportSchema),
  total: Type.Number(),
  page: Type.Number(),
  page_size: Type.Number(),
});
export type StudentUpdateHistoryResponse = Static<typeof StudentUpdateHistoryResponseSchema>;

export const ImportRollbackConflictSchema = Type.Object({
  action_id: Type.Number(),
  action_type: Type.String(),
  entity_id: Type.Union([Type.String(), Type.Number()]),
  conflict_code: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
});

export const ImportRollbackActionSchema = Type.Object({
  id: Type.Number(),
  action_sequence: Type.Number(),
  action_type: Type.String(),
  entity_type: Type.String(),
  entity_id: Type.Union([Type.String(), Type.Number()]),
  eligibility: Type.String(),
  conflict_code: Type.Union([Type.String(), Type.Null()]),
  block_reason: Type.Union([Type.String(), Type.Null()]),
  before_state: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  after_state: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  compensation_type: Type.Union([Type.String(), Type.Null()]),
});

export const StudentUpdateRollbackPreviewSchema = Type.Object({
  session_reference: Type.String(),
  session_id: Type.String(),
  provenance_status: Type.String(),
  rollback_state: Type.String(),
  is_rollbackable: Type.Boolean(),
  non_rollbackable_reason: Type.Optional(Type.String()),
  total_applied_actions: Type.Number(),
  eligible_actions: Type.Number(),
  blocked_actions: Type.Number(),
  manual_review_actions: Type.Number(),
  already_compensated_actions: Type.Number(),
  affected_entity_counts: Type.Object({ students: Type.Number(), enrollments: Type.Number(), devices: Type.Number() }),
  proposed_reverse_action_order: Type.Array(ImportRollbackActionSchema),
  dependency_conflicts: Type.Array(ImportRollbackConflictSchema),
  preview_checksum: Type.String(),
  expiration: Type.String(),
  required_capability: Type.Literal("rollback_import_session"),
  required_confirmation: Type.String(),
  history_preservation_disclosure: Type.String(),
});
export type StudentUpdateRollbackPreview = Static<typeof StudentUpdateRollbackPreviewSchema>;

export const StudentUpdateRollbackRequestSchema = Type.Object({
  preview_checksum: Type.String({ minLength: 1 }),
  mode: Type.Optional(Type.String()),
  selected_action_ids: Type.Optional(Type.Array(Type.Number())),
  reason: Type.String({ minLength: 5 }),
  confirmation_value: Type.String({ minLength: 1 }),
  idempotency_token: Type.String({ minLength: 8 }),
});
export type StudentUpdateRollbackRequest = Static<typeof StudentUpdateRollbackRequestSchema>;

export const StudentUpdateRollbackResponseSchema = Type.Object({
  session_id: Type.String(),
  session_reference: Type.String(),
  rollback_state: Type.String(),
  status: Type.Literal("COMPLETED"),
  compensated_action_count: Type.Optional(Type.Number()),
  blocked_action_count: Type.Optional(Type.Number()),
  compensation_actions: Type.Optional(Type.Array(Type.Number())),
  idempotent_replay: Type.Boolean(),
  history_preserved: Type.Optional(Type.Boolean()),
  message: Type.String(),
});
export type StudentUpdateRollbackResponse = Static<typeof StudentUpdateRollbackResponseSchema>;

export * from "./overview";
