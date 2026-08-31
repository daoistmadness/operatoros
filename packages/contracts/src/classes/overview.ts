import { Type, type Static } from "@sinclair/typebox";
import { AttendanceAnalyticsStatusCountsSchema } from "../analytics/attendance-expansion";

const DateString = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const Term = Type.Union([Type.Literal("term_1"), Type.Literal("term_2"), Type.Literal("term_3"), Type.Literal("term_4")]);
const Unavailable = Type.Object({ status: Type.Literal("unavailable"), reason: Type.Literal("unauthorized") });

export const ClassOverviewQuerySchema = Type.Object({
  term: Type.Optional(Term),
  attendance_date_from: Type.Optional(DateString),
  attendance_date_to: Type.Optional(DateString),
  search: Type.Optional(Type.String({ maxLength: 120 })),
});

const ClassSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  name: Type.String({ minLength: 1 }),
  jenjang: Type.String({ minLength: 1 }),
  grade: Type.String({ minLength: 1 }),
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.String({ minLength: 1 }),
  active: Type.Boolean(),
});

const ScopeSchema = Type.Object({
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.String({ minLength: 1 }),
  term: Type.Union([Term, Type.Null()]),
  attendanceDateFrom: DateString,
  attendanceDateTo: DateString,
});

const RosterRowSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  studentName: Type.String({ minLength: 1 }),
  enrollmentStatus: Type.String({ minLength: 1 }),
  dataQualityIssueCount: Type.Number({ minimum: 0 }),
  student360Link: Type.String({ minLength: 1 }),
});

const RosterSchema = Type.Object({
  total: Type.Number({ minimum: 0 }),
  rows: Type.Array(RosterRowSchema),
});

const AttendanceSchema = Type.Object({
  status: Type.Literal("available"),
  totalRecords: Type.Number({ minimum: 0 }),
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  tardinessRate: Type.Number({ minimum: 0, maximum: 100 }),
  unexcusedAbsenceRate: Type.Number({ minimum: 0, maximum: 100 }),
  counts: AttendanceAnalyticsStatusCountsSchema,
  overriddenRecords: Type.Number({ minimum: 0 }),
});

const AcademicSchema = Type.Object({
  status: Type.Literal("available"),
  average: Type.Union([Type.Number(), Type.Null()]),
  students: Type.Number({ minimum: 0 }),
  assessments: Type.Number({ minimum: 0 }),
  participationPercentage: Type.Number({ minimum: 0, maximum: 100 }),
  term: Type.Union([Type.Number({ minimum: 1, maximum: 4 }), Type.Null()]),
  periodStatus: Type.Union([Type.Literal("known"), Type.Literal("mixed"), Type.Literal("unknown")]),
  periodNote: Type.String({ minLength: 1 }),
});

const DataQualitySchema = Type.Object({
  status: Type.Literal("available"),
  totalStudents: Type.Number({ minimum: 0 }),
  cleanRecords: Type.Number({ minimum: 0 }),
  recordsWithRequiredIssues: Type.Number({ minimum: 0 }),
  recordsWithOptionalIssues: Type.Number({ minimum: 0 }),
});

export const ClassOverviewResponseSchema = Type.Object({
  class: ClassSchema,
  scope: ScopeSchema,
  roster: RosterSchema,
  attendance: Type.Union([AttendanceSchema, Unavailable]),
  academic: Type.Union([AcademicSchema, Unavailable]),
  dataQuality: Type.Union([DataQualitySchema, Unavailable]),
  links: Type.Object({
    attendance: Type.String({ minLength: 1 }),
    academic: Type.String({ minLength: 1 }),
    dataQuality: Type.String({ minLength: 1 }),
  }),
});

export type ClassOverviewQuery = Static<typeof ClassOverviewQuerySchema>;
export type ClassOverviewResponse = Static<typeof ClassOverviewResponseSchema>;
