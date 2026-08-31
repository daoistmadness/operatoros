import { Type, type Static } from "@sinclair/typebox";
import { AttendanceAnalyticsStatusCountsSchema } from "../analytics/attendance-expansion";
import { DataQualityIssueEntrySchema } from "../analytics/data-quality";
import { StudentTrendMetricSchema, StudentTrendWindowSchema } from "../analytics/student-trends";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const SectionStatus = Type.Union([
  Type.Literal("available"), Type.Literal("no_data"), Type.Literal("unauthorized"),
  Type.Literal("insufficient_data"), Type.Literal("not_applicable"),
]);

export const StudentOverviewResponseSchema = Type.Object({
  student: Type.Object({
    id: Type.String({ minLength: 1 }), fullName: Type.String({ minLength: 1 }), preferredName: NullableString,
    status: Type.String({ minLength: 1 }), gender: NullableString, religion: NullableString,
    birthDate: NullableString, ageYears: NullableNumber,
  }),
  enrollment: Type.Union([Type.Object({
    id: Type.Number({ minimum: 1 }), academicYearId: Type.Number({ minimum: 1 }), academicYear: Type.String({ minLength: 1 }),
    academicYearStart: Type.String({ minLength: 1 }), academicYearEnd: Type.String({ minLength: 1 }),
    jenjangId: Type.Number({ minimum: 1 }), jenjang: Type.String({ minLength: 1 }),
    classId: NullableNumber, className: NullableString, program: NullableString, grade: NullableString,
  }), Type.Null()]),
  attendance: Type.Object({
    status: SectionStatus,
    period: Type.Union([Type.Object({ start: Type.String(), end: Type.String(), label: Type.String() }), Type.Null()]),
    counts: Type.Union([AttendanceAnalyticsStatusCountsSchema, Type.Null()]),
    attendanceRate: NullableNumber, tardinessRate: NullableNumber, alfaRate: NullableNumber,
    recent: Type.Array(Type.Object({ date: Type.String(), status: Type.String(), checkIn: NullableString, checkOut: NullableString, corrected: Type.Boolean() })),
  }),
  academic: Type.Object({
    status: SectionStatus, average: NullableNumber, participation: NullableNumber,
    scoredResults: Type.Number({ minimum: 0 }), expectedResults: Type.Number({ minimum: 0 }),
    temporalTrend: Type.Literal("unavailable_no_time_axis"),
  }),
  trends: Type.Object({
    status: SectionStatus, window: Type.Union([StudentTrendWindowSchema, Type.Null()]),
    attendance: Type.Union([StudentTrendMetricSchema, Type.Null()]),
    tardiness: Type.Union([StudentTrendMetricSchema, Type.Null()]),
    alfa: Type.Union([StudentTrendMetricSchema, Type.Null()]),
  }),
  dataCompleteness: Type.Object({ status: SectionStatus, issues: Type.Array(DataQualityIssueEntrySchema) }),
  availability: Type.Object({ attendance: SectionStatus, academic: SectionStatus, trendComparison: SectionStatus }),
  links: Type.Object({
    attendanceDetails: NullableString, attendanceAnalytics: NullableString, attendanceExport: NullableString,
    academicAnalytics: NullableString, trends: NullableString, indicators: NullableString, dataQuality: NullableString,
  }),
});

export type StudentOverviewResponse = Static<typeof StudentOverviewResponseSchema>;
