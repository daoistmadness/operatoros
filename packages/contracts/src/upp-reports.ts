import { Type, type Static } from "@sinclair/typebox";

const Month = Type.String({ pattern: "^[1-9][0-9]{3}-(0[1-9]|1[0-2])$" });
const Id = Type.Integer({ minimum: 1 });
const NullableString = Type.Union([Type.String(), Type.Null()]);

export const UppSubmissionStatus = Type.Union([
  Type.Literal("UPLOADED"),
  Type.Literal("READY_FOR_SUBMISSION"),
  Type.Literal("SUBMITTED"),
]);
export type UppSubmissionStatusDto = Static<typeof UppSubmissionStatus>;

export const UppReportListQuery = Type.Object({
  month: Month,
  school_unit_id: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })),
}, { additionalProperties: false });
export type UppReportListQueryDto = Static<typeof UppReportListQuery>;

export const UppReportSummary = Type.Object({
  id: Type.Union([Id, Type.Null()]),
  school_unit_id: Id,
  school_unit_name: Type.String(),
  month: Month,
  file_name: NullableString,
  file_size_bytes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  version_id: Type.Union([Id, Type.Null()]),
  uploaded_at: NullableString,
  uploaded_by: NullableString,
  submission_status: Type.Union([UppSubmissionStatus, Type.Literal("NOT_UPLOADED")]),
  submitted_at: NullableString,
  submitted_by: NullableString,
  submission_notes: NullableString,
  updated_at: NullableString,
});
export type UppReportSummaryDto = Static<typeof UppReportSummary>;

export const UppReportListResponse = Type.Object({ month: Month, items: Type.Array(UppReportSummary) });
export type UppReportListResponseDto = Static<typeof UppReportListResponse>;

export const UppReportVersion = Type.Object({
  id: Id,
  version_number: Type.Integer({ minimum: 1 }),
  file_name: Type.String(),
  file_size_bytes: Type.Integer({ minimum: 1 }),
  uploaded_at: Type.String(),
  uploaded_by: Type.String(),
  notes: NullableString,
  active: Type.Boolean(),
});
export const UppReportHistoryItem = Type.Object({
  id: Id,
  action: Type.Union([Type.Literal("UPLOAD"), Type.Literal("REPLACEMENT"), Type.Literal("STATUS_CHANGED")]),
  from_status: Type.Union([UppSubmissionStatus, Type.Null()]),
  to_status: UppSubmissionStatus,
  version_number: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  actor: Type.String(),
  notes: NullableString,
  occurred_at: Type.String(),
});
export const UppReportEvidence = Type.Object({
  id: Id,
  file_name: Type.String(),
  file_size_bytes: Type.Integer({ minimum: 1 }),
  uploaded_at: Type.String(),
  uploaded_by: Type.String(),
});
export const UppReportDetailResponse = Type.Object({
  report: UppReportSummary,
  versions: Type.Array(UppReportVersion),
  history: Type.Array(UppReportHistoryItem),
  evidence: Type.Array(UppReportEvidence),
});
export type UppReportDetailResponseDto = Static<typeof UppReportDetailResponse>;

export const UppReportStatusChangeRequest = Type.Object({
  status: UppSubmissionStatus,
  expected_updated_at: Type.String({ minLength: 1, maxLength: 64 }),
  submission_notes: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
}, { additionalProperties: false });
export type UppReportStatusChangeRequestDto = Static<typeof UppReportStatusChangeRequest>;
