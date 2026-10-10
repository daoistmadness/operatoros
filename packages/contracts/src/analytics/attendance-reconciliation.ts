import { Type, type Static } from "@sinclair/typebox";
import { ReportScopeSchema } from "../reports";
import { TermAttendanceCountsSchema } from "./term-attendance";

const Id = Type.String({ pattern: "^[1-9]\\d*$" });
const Month = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" });
const Date = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const Count = Type.Integer({ minimum: 0 });
const PositiveId = Type.Integer({ minimum: 1 });
const EvidenceVersion = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const NullableCount = Type.Union([Count, Type.Null()]);
const ComparisonStatus = Type.Union([
  Type.Literal("NOT_REPORTED"), Type.Literal("NOT_COMPARABLE"), Type.Literal("MATCH"), Type.Literal("MISMATCH"),
]);
const Reason = Type.Union([
  Type.Literal("LEDGER_NOT_SUBMITTED"), Type.Literal("CLASS_TOTALS_ONLY"), Type.Literal("NO_EXPECTED_STUDENT_DAYS"),
  Type.Literal("NO_CANONICAL_EVIDENCE"),
  Type.Literal("CANONICAL_COVERAGE_INCOMPLETE"), Type.Literal("CANONICAL_STATUS_UNRESOLVED"),
  Type.Literal("CALENDAR_UNKNOWN"), Type.Literal("CANONICAL_CLASS_UNRESOLVED"), Type.Literal("SIA_REASON_MISMATCH"),
  Type.Null(),
]);
const SiaTotals = Type.Object({ sakit: NullableCount, izin: NullableCount, alfa: NullableCount });
const DeltaTotals = Type.Object({ sakit: Type.Union([Type.Integer(), Type.Null()]), izin: Type.Union([Type.Integer(), Type.Null()]), alfa: Type.Union([Type.Integer(), Type.Null()]) });
const ReviewDecision = Type.Union([Type.Literal("REVIEWED"), Type.Literal("REVIEWED_WITH_ISSUES")]);
const ReviewAction = Type.Union([ReviewDecision, Type.Literal("REOPENED")]);
const EvidenceReferences = Type.Object({
  attendance_ids: Type.Array(PositiveId),
  override_history_ids: Type.Array(PositiveId),
  attendance_import_row_ids: Type.Array(PositiveId),
  enrollment_ids: Type.Array(PositiveId),
  enrollment_class_history_ids: Type.Array(PositiveId),
  enrollment_lifecycle_audit_ids: Type.Array(PositiveId),
  calendar_rule_ids: Type.Array(PositiveId),
  calendar_exception_ids: Type.Array(PositiveId),
  ledger_revision_id: Type.Union([PositiveId, Type.Null()]),
}, { additionalProperties: false });

export const AttendanceReviewEventMetadataSchema = Type.Object({
  version: Type.Literal(1),
  academic_year_id: PositiveId,
  class_id: PositiveId,
  month: Month,
  revision: PositiveId,
  previous_revision: Count,
  action: Type.Union([Type.Literal("DECISION"), Type.Literal("REOPEN")]),
  decision: Type.Union([ReviewDecision, Type.Null()]),
  evidence_version: EvidenceVersion,
  evidence_references: EvidenceReferences,
}, { additionalProperties: false });

export const AttendanceReviewMutationSchema = Type.Object({
  academic_year_id: Id,
  class_id: Id,
  month: Month,
  scope: ReportScopeSchema,
  expected_revision: Count,
  evidence_version: EvidenceVersion,
  decision: ReviewDecision,
  note: Type.Optional(Type.String({ maxLength: 1000 })),
});

export const AttendanceReviewReopenSchema = Type.Object({
  academic_year_id: Id,
  class_id: Id,
  month: Month,
  scope: ReportScopeSchema,
  expected_revision: PositiveId,
  evidence_version: EvidenceVersion,
  reason: Type.String({ minLength: 5, maxLength: 1000 }),
});

const AttendanceReviewHistoryEntry = Type.Object({
  revision: PositiveId,
  previous_revision: Count,
  action: ReviewAction,
  actor: Type.String({ minLength: 1 }),
  timestamp: Type.String({ minLength: 1 }),
  evidence_version: EvidenceVersion,
  note: Type.Union([Type.String(), Type.Null()]),
  evidence_references: EvidenceReferences,
});

const AttendanceReviewState = Type.Object({
  status: Type.Union([
    Type.Literal("NOT_REVIEWED"), Type.Literal("REVIEWED"),
    Type.Literal("REVIEWED_WITH_ISSUES"), Type.Literal("REVIEW_OUTDATED"),
  ]),
  revision: Count,
  evidence_version: EvidenceVersion,
  decision: Type.Union([ReviewDecision, Type.Null()]),
  reviewed_by: Type.Union([Type.String(), Type.Null()]),
  reviewed_at: Type.Union([Type.String(), Type.Null()]),
  note: Type.Union([Type.String(), Type.Null()]),
  evidence_references: EvidenceReferences,
  history: Type.Array(AttendanceReviewHistoryEntry),
});

export const AttendanceReconciliationQuerySchema = Type.Object({
  academic_year_id: Id,
  class_id: Id,
  month: Month,
  scope: ReportScopeSchema,
});

export const AttendanceReconciliationResponseSchema = Type.Object({
  academic_year: Type.Object({ id: Type.Integer({ minimum: 1 }), label: Type.String(), start_date: Date, end_date: Date }),
  class: Type.Object({
    id: Type.Integer({ minimum: 1 }), name: Type.String(), grade: Type.String(),
    program: Type.String(), jenjang: Type.String(),
  }),
  month: Month,
  review: AttendanceReviewState,
  scope: ReportScopeSchema,
  period: Type.Object({ start_date: Date, end_date: Date }),
  calendar: Type.Object({
    expected_school_days: Count,
    non_school_days: Count,
    unknown_dates: Type.Array(Date),
  }),
  canonical: TermAttendanceCountsSchema,
  machine_evidence: Type.Object({
    coverage_status: Type.Literal("NOT_TRACKED"),
    recorded_student_days: Count,
  }),
  ledger: Type.Object({
    state: Type.Union([Type.Literal("MISSING"), Type.Literal("OPEN"), Type.Literal("SUBMITTED")]),
    entry_mode: Type.Union([Type.Literal("TOTALS_ONLY"), Type.Literal("PER_STUDENT"), Type.Null()]),
    reported: SiaTotals,
    comparison: Type.Object({ status: ComparisonStatus, reason_code: Reason, differences: DeltaTotals }),
  }),
  evidence: Type.Object({
    status: Type.Union([Type.Literal("CLEAR"), Type.Literal("INCOMPLETE"), Type.Literal("CONTRADICTORY")]),
    unresolved_student_days: Count,
    contradictory_student_days: Count,
    unresolved_class_evidence: Count,
    unknown_calendar_dates: Type.Array(Date),
  }),
  summary: Type.Object({
    applicable_students: Count,
    students_needing_review: Count,
    matching_students: Count,
    mismatched_students: Count,
    unresolved_student_days: Count,
    missing_book_reports: Count,
    machine_recorded_student_days: Count,
    contradictory_student_days: Count,
  }),
  students: Type.Array(Type.Object({
    enrollment_id: Type.Integer({ minimum: 1 }),
    student_name: Type.String({ minLength: 1 }),
    expected_student_days: Count,
    machine_records: Type.Array(Type.Object({
      date: Date, status: Type.String(), scan_in: Type.Union([Type.String(), Type.Null()]),
      scan_out: Type.Union([Type.String(), Type.Null()]),
      source_state: Type.Union([Type.Literal("APPLIED"), Type.Literal("UNCHANGED"), Type.Literal("CONFLICT")]),
    })),
    daily_evidence: Type.Array(Type.Object({
      date: Date, raw_status: Type.Union([Type.String(), Type.Null()]),
      override_status: Type.Union([Type.String(), Type.Null()]),
      effective_status: Type.Union([Type.String(), Type.Null()]),
      machine_recorded: Type.Boolean(),
    })),
    effective: Type.Object({ present: Count, sakit: Count, izin: Count, alfa: Count, unresolved: Count }),
    book_totals: SiaTotals,
    differences: DeltaTotals,
    comparison: Type.Object({ status: ComparisonStatus, reason_code: Reason }),
    unresolved_dates: Type.Array(Date),
    unknown_calendar_dates: Type.Array(Date),
    contradictory_dates: Type.Array(Date),
    first_review_date: Type.Union([Date, Type.Null()]),
  }, { additionalProperties: false })),
});

export type AttendanceReconciliationQuery = Static<typeof AttendanceReconciliationQuerySchema>;
export type AttendanceReconciliationResponse = Static<typeof AttendanceReconciliationResponseSchema>;
export type AttendanceReviewMutation = Static<typeof AttendanceReviewMutationSchema>;
export type AttendanceReviewReopen = Static<typeof AttendanceReviewReopenSchema>;
export type AttendanceReviewEventMetadata = Static<typeof AttendanceReviewEventMetadataSchema>;
