import { Type, type Static } from "@sinclair/typebox";

const DateString = Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$" });
const Id = Type.String({ pattern: "^[1-9]\\d*$" });

export const ManagementOverviewQuerySchema = Type.Object({
  academic_year_id: Id,
  jenjang_id: Type.Optional(Id),
  class_id: Type.Optional(Id),
  attendance_date_from: Type.Optional(DateString),
  attendance_date_to: Type.Optional(DateString),
});

const ScopeSchema = Type.Object({
  academicYearId: Type.Number({ minimum: 1 }),
  academicYearLabel: Type.String({ minLength: 1 }),
  jenjangId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  classId: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  attendanceDateFrom: DateString,
  attendanceDateTo: DateString,
});

const UnavailableSchema = Type.Object({ status: Type.Literal("unavailable"), reason: Type.Literal("unauthorized") });
const StudentSnapshotSchema = Type.Object({
  status: Type.Literal("available"),
  activeStudents: Type.Number({ minimum: 0 }),
  jenjangCount: Type.Number({ minimum: 0 }),
  classCount: Type.Number({ minimum: 0 }),
  byJenjang: Type.Array(Type.Object({ label: Type.String({ minLength: 1 }), count: Type.Number({ minimum: 0 }), percentage: Type.Number({ minimum: 0, maximum: 100 }) })),
});
const StaffSnapshotSchema = Type.Object({
  status: Type.Literal("available"),
  activeStaff: Type.Number({ minimum: 0 }),
  issueCount: Type.Number({ minimum: 0 }),
});

const AttendanceSchema = Type.Object({
  status: Type.Literal("available"),
  totalRecords: Type.Number({ minimum: 0 }),
  attendanceRate: Type.Number({ minimum: 0, maximum: 100 }),
  present: Type.Number({ minimum: 0 }),
  late: Type.Number({ minimum: 0 }),
  alfa: Type.Number({ minimum: 0 }),
  sakit: Type.Number({ minimum: 0 }),
  izin: Type.Number({ minimum: 0 }),
  overriddenRecords: Type.Number({ minimum: 0 }),
  byJenjang: Type.Array(Type.Object({ label: Type.String({ minLength: 1 }), attendanceRate: Type.Number({ minimum: 0, maximum: 100 }), totalRecords: Type.Number({ minimum: 0 }) })),
});

const AcademicSchema = Type.Object({
  status: Type.Literal("available"),
  average: Type.Union([Type.Number(), Type.Null()]),
  students: Type.Number({ minimum: 0 }),
  assessments: Type.Number({ minimum: 0 }),
  participationPercentage: Type.Number({ minimum: 0, maximum: 100 }),
  byJenjang: Type.Array(Type.Object({ label: Type.String({ minLength: 1 }), average: Type.Union([Type.Number(), Type.Null()]), students: Type.Number({ minimum: 0 }) })),
});

const DataQualitySchema = Type.Object({
  status: Type.Literal("available"),
  total: Type.Number({ minimum: 0 }),
  issueCount: Type.Number({ minimum: 0 }),
  completenessPercentage: Type.Number({ minimum: 0, maximum: 100 }),
});

export const ManagementOverviewResponseSchema = Type.Object({
  scope: ScopeSchema,
  school: Type.Object({
    students: Type.Union([StudentSnapshotSchema, UnavailableSchema]),
    staff: Type.Union([StaffSnapshotSchema, UnavailableSchema]),
  }),
  attendance: Type.Union([AttendanceSchema, UnavailableSchema]),
  academic: Type.Union([AcademicSchema, UnavailableSchema]),
  dataQuality: Type.Object({
    students: Type.Union([DataQualitySchema, UnavailableSchema]),
    staff: Type.Union([DataQualitySchema, UnavailableSchema]),
  }),
  links: Type.Object({
    recapitulation: Type.Literal("/analytics/recapitulation"),
    attendance: Type.Literal("/analytics/attendance"),
    academic: Type.Literal("/analytics/academic"),
    dataQuality: Type.Literal("/analytics/data-quality"),
  }),
});

export type ManagementOverviewQuery = Static<typeof ManagementOverviewQuerySchema>;
export type ManagementOverviewResponse = Static<typeof ManagementOverviewResponseSchema>;
