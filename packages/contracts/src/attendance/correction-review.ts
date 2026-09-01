import { Type, type Static } from "@sinclair/typebox";

const DateString = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const Status = Type.String({ minLength: 1, maxLength: 64 });
const NullableString = Type.Union([Type.String(), Type.Null()]);

export const AttendanceCorrectionReviewQuerySchema = Type.Object({
  academic_year_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  class_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  date_from: Type.Optional(DateString),
  date_to: Type.Optional(DateString),
  base_status: Type.Optional(Status),
  effective_status: Type.Optional(Status),
  student_search: Type.Optional(Type.String({ maxLength: 120 })),
  page: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  page_size: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

const CorrectionMetadataSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  note: Type.String({ minLength: 1 }),
  reviewedBy: Type.String({ minLength: 1 }),
  reviewedAt: Type.String({ minLength: 1 }),
  overrideCheckIn: NullableString,
  overrideCheckOut: NullableString,
  active: Type.Literal(true),
});

const CorrectionLinksSchema = Type.Object({
  correctionReview: Type.String({ minLength: 1 }),
  editCorrection: NullableString,
  student360: Type.String({ minLength: 1 }),
  class360: NullableString,
  dailyAttendance: Type.String({ minLength: 1 }),
});

export const AttendanceCorrectionReviewItemSchema = Type.Object({
  attendanceId: Type.Number({ minimum: 1 }),
  studentId: Type.Number({ minimum: 1 }),
  studentMasterId: NullableString,
  studentName: Type.String({ minLength: 1 }),
  classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  className: Type.String({ minLength: 1 }),
  jenjang: NullableString,
  academicYearId: Type.Number({ minimum: 1 }),
  date: DateString,
  baseStatus: Status,
  effectiveStatus: Status,
  correction: CorrectionMetadataSchema,
  canEdit: Type.Boolean(),
  links: CorrectionLinksSchema,
});

export const AttendanceCorrectionReviewResponseSchema = Type.Object({
  scope: Type.Object({
    academicYearId: Type.Number({ minimum: 1 }),
    academicYearLabel: Type.String({ minLength: 1 }),
    jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    dateFrom: DateString,
    dateTo: DateString,
  }),
  summary: Type.Object({ corrections: Type.Number({ minimum: 0 }) }),
  total: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1 }),
  items: Type.Array(AttendanceCorrectionReviewItemSchema),
});

export type AttendanceCorrectionReviewQuery = Static<typeof AttendanceCorrectionReviewQuerySchema>;
export type AttendanceCorrectionReviewItem = Static<typeof AttendanceCorrectionReviewItemSchema>;
export type AttendanceCorrectionReviewResponse = Static<typeof AttendanceCorrectionReviewResponseSchema>;
