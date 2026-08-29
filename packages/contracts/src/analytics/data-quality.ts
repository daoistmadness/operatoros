import { Type, type Static } from "@sinclair/typebox";

export const StudentQualityFieldSchema = Type.Union([
  Type.Literal("gender"),
  Type.Literal("religion"),
  Type.Literal("birth_date"),
  Type.Literal("class_assignment"),
]);

export const StaffQualityFieldSchema = Type.Union([
  Type.Literal("education"),
  Type.Literal("jenjang_assignment"),
  Type.Literal("job_title"),
]);

export const DataQualityIssueTypeSchema = Type.Union([
  Type.Literal("MISSING_OPTIONAL_FIELD"),
  Type.Literal("MISSING_CLASS_ASSIGNMENT"),
  Type.Literal("MISSING_ENROLLMENT"),
  Type.Literal("MISSING_STAFF_EDUCATION"),
  Type.Literal("MISSING_STAFF_ASSIGNMENT"),
  Type.Literal("UNMAPPED_JOB_TITLE"),
  Type.Literal("UNKNOWN_CATEGORY_VALUE"),
]);

export const DataQualityFieldMetricSchema = Type.Object({
  field: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  applicability: Type.Union([
    Type.Literal("OPTIONAL_BUT_TRACKED"),
    Type.Literal("CONDITIONALLY_REQUIRED"),
  ]),
  applicable: Type.Number({ minimum: 0 }),
  complete: Type.Number({ minimum: 0 }),
  missing: Type.Number({ minimum: 0 }),
  unknown: Type.Number({ minimum: 0 }),
  unmapped: Type.Number({ minimum: 0 }),
  completenessPercentage: Type.Number({ minimum: 0, maximum: 100 }),
});

export const StudentDataQualityResponseSchema = Type.Object({
  scope: Type.Object({
    academicYearLabel: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
    jenjangId: Type.Union([Type.Number(), Type.Null()]),
    classId: Type.Union([Type.Number(), Type.Null()]),
  }),
  totalStudents: Type.Number({ minimum: 0 }),
  cleanRecords: Type.Number({ minimum: 0 }),
  recordsWithRequiredIssues: Type.Number({ minimum: 0 }),
  recordsWithOptionalIssues: Type.Number({ minimum: 0 }),
  missingEnrollmentCount: Type.Number({ minimum: 0 }),
  fieldCompleteness: Type.Array(DataQualityFieldMetricSchema),
  classBreakdown: Type.Array(Type.Object({
    class: Type.String({ minLength: 1 }),
    students: Type.Number({ minimum: 0 }),
    fullyComplete: Type.Number({ minimum: 0 }),
    withRequiredIssues: Type.Number({ minimum: 0 }),
    missingOptionalFields: Type.Number({ minimum: 0 }),
    completenessPercentage: Type.Number({ minimum: 0, maximum: 100 }),
  })),
  generatedAt: Type.String(),
});

export const StaffDataQualityResponseSchema = Type.Object({
  scope: Type.Object({
    employmentStatus: Type.String(),
    jenjangId: Type.Union([Type.Number(), Type.Null()]),
  }),
  totalStaff: Type.Number({ minimum: 0 }),
  cleanRecords: Type.Number({ minimum: 0 }),
  recordsWithIssues: Type.Number({ minimum: 0 }),
  fieldCompleteness: Type.Array(DataQualityFieldMetricSchema),
  generatedAt: Type.String(),
});

export const DataQualityIssueEntrySchema = Type.Object({
  field: Type.String({ minLength: 1 }),
  type: DataQualityIssueTypeSchema,
  label: Type.String({ minLength: 1 }),
});

export type DataQualityIssueEntry = Static<typeof DataQualityIssueEntrySchema>;

export const DataQualityIssueSchema = Type.Object({
  entityId: Type.String({ minLength: 1 }),
  entityName: Type.String({ minLength: 1 }),
  context: Type.String({ minLength: 1 }),
  issues: Type.Array(DataQualityIssueEntrySchema),
});

export const DataQualityIssuesResponseSchema = Type.Object({
  total: Type.Number({ minimum: 0 }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1 }),
  items: Type.Array(DataQualityIssueSchema),
});

export type DataQualityIssueType = Static<typeof DataQualityIssueTypeSchema>;
export type DataQualityFieldMetric = Static<typeof DataQualityFieldMetricSchema>;
export type StudentDataQualityResponse = Static<typeof StudentDataQualityResponseSchema>;
export type StaffDataQualityResponse = Static<typeof StaffDataQualityResponseSchema>;
export type DataQualityIssue = Static<typeof DataQualityIssueSchema>;
export type DataQualityIssuesResponse = Static<typeof DataQualityIssuesResponseSchema>;
