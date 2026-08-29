import { Type, type Static } from "@sinclair/typebox";

const DateStringSchema = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });

export const AttendanceAnalyticsStatusCountsSchema = Type.Object({
  present: Type.Number({ minimum: 0 }),
  late: Type.Number({ minimum: 0 }),
  incomplete: Type.Number({ minimum: 0 }),
  absent: Type.Number({ minimum: 0 }),
  sakit: Type.Number({ minimum: 0 }),
  izin: Type.Number({ minimum: 0 }),
  alfa: Type.Number({ minimum: 0 }),
  unrecorded: Type.Number({ minimum: 0 }),
});

export const AttendanceAnalyticsQuerySchema = Type.Object({
  date_from: DateStringSchema,
  date_to: DateStringSchema,
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  class_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  search: Type.Optional(Type.String({ maxLength: 120 })),
  sort: Type.Optional(Type.Union([Type.Literal("name"), Type.Literal("attendance_rate"), Type.Literal("late"), Type.Literal("alfa")])),
  order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
  page: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
  page_size: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

export const AttendanceAnalyticsOptionsQuerySchema = Type.Object({
  academic_year_id: Type.String({ pattern: "^[1-9]\\d*$" }),
  jenjang_id: Type.Optional(Type.String({ pattern: "^[1-9]\\d*$" })),
});

export const AttendanceAnalyticsOptionsResponseSchema = Type.Object({
  academicYears: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), label: Type.String(), startDate: DateStringSchema, endDate: DateStringSchema, isDefault: Type.Boolean() })),
  jenjangs: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String() })),
  classes: Type.Array(Type.Object({ id: Type.Number({ minimum: 1 }), name: Type.String(), jenjangId: Type.Number({ minimum: 1 }) })),
});

export const AttendanceAnalyticsScopeSchema = Type.Object({
  dateFrom: DateStringSchema,
  dateTo: DateStringSchema,
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.Union([Type.String(), Type.Null()]),
  jenjangId: Type.Union([Type.Number(), Type.Null()]),
  classId: Type.Union([Type.Number(), Type.Null()]),
  totalApplicableRecords: Type.Number({ minimum: 0 }),
});

export const AttendanceOverviewResponseSchema = Type.Object({
  scope: AttendanceAnalyticsScopeSchema,
  totalRecords: Type.Number({ minimum: 0 }),
  students: Type.Number({ minimum: 0 }),
  classes: Type.Number({ minimum: 0 }),
  counts: AttendanceAnalyticsStatusCountsSchema,
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  tardinessRate: Type.Number({ minimum: 0, maximum: 100 }),
  unexcusedAbsenceRate: Type.Number({ minimum: 0, maximum: 100 }),
  overriddenRecords: Type.Number({ minimum: 0 }),
  overridePercentage: Type.Number({ minimum: 0, maximum: 100 }),
  hebTotal: Type.Number({ minimum: 0 }),
  generatedAt: Type.String(),
});

export const AttendanceClassRowSchema = Type.Object({
  classId: Type.Union([Type.Number(), Type.Null()]),
  className: Type.String({ minLength: 1 }),
  students: Type.Number({ minimum: 0 }),
  counts: AttendanceAnalyticsStatusCountsSchema,
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  tardinessRate: Type.Number({ minimum: 0, maximum: 100 }),
  unexcusedAbsenceRate: Type.Number({ minimum: 0, maximum: 100 }),
});

export const AttendanceClassesResponseSchema = Type.Object({
  scope: AttendanceAnalyticsScopeSchema,
  rows: Type.Array(AttendanceClassRowSchema),
  generatedAt: Type.String(),
});

export const AttendanceJenjangRowSchema = Type.Object({
  jenjangId: Type.Union([Type.Number(), Type.Null()]),
  jenjang: Type.String({ minLength: 1 }),
  students: Type.Number({ minimum: 0 }),
  counts: AttendanceAnalyticsStatusCountsSchema,
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  tardinessRate: Type.Number({ minimum: 0, maximum: 100 }),
  unexcusedAbsenceRate: Type.Number({ minimum: 0, maximum: 100 }),
});

export const AttendanceJenjangResponseSchema = Type.Object({
  scope: AttendanceAnalyticsScopeSchema,
  rows: Type.Array(AttendanceJenjangRowSchema),
  generatedAt: Type.String(),
});

export const AttendanceDailyRowSchema = Type.Object({
  date: DateStringSchema,
  records: Type.Number({ minimum: 0 }),
  counts: AttendanceAnalyticsStatusCountsSchema,
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
});

export const AttendanceDailyResponseSchema = Type.Object({
  scope: AttendanceAnalyticsScopeSchema,
  rows: Type.Array(AttendanceDailyRowSchema),
  generatedAt: Type.String(),
});

export const AttendanceStudentRowSchema = Type.Object({
  studentId: Type.Number(),
  studentName: Type.String({ minLength: 1 }),
  className: Type.Union([Type.String(), Type.Null()]),
  counts: AttendanceAnalyticsStatusCountsSchema,
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  tardinessRate: Type.Number({ minimum: 0, maximum: 100 }),
  unexcusedAbsenceRate: Type.Number({ minimum: 0, maximum: 100 }),
});

export const AttendanceStudentsResponseSchema = Type.Object({
  scope: AttendanceAnalyticsScopeSchema,
  total: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1 }),
  rows: Type.Array(AttendanceStudentRowSchema),
  generatedAt: Type.String(),
});

export type AttendanceAnalyticsStatusCounts = Static<typeof AttendanceAnalyticsStatusCountsSchema>;
export type AttendanceAnalyticsOptionsResponse = Static<typeof AttendanceAnalyticsOptionsResponseSchema>;
export type AttendanceOverviewResponse = Static<typeof AttendanceOverviewResponseSchema>;
export type AttendanceClassesResponse = Static<typeof AttendanceClassesResponseSchema>;
export type AttendanceJenjangResponse = Static<typeof AttendanceJenjangResponseSchema>;
export type AttendanceDailyResponse = Static<typeof AttendanceDailyResponseSchema>;
export type AttendanceStudentsResponse = Static<typeof AttendanceStudentsResponseSchema>;
