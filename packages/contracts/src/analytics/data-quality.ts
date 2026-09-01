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

export const DataQualityEntityTypeSchema = Type.Union([
  Type.Literal("STUDENT"),
  Type.Literal("STAFF"),
]);

export const DataQualityStateSchema = Type.Union([
  Type.Literal("MISSING"),
  Type.Literal("UNKNOWN"),
  Type.Literal("UNMAPPED"),
]);

export const DataQualityResolutionClassSchema = Type.Union([
  Type.Literal("EDITABLE_IN_OPERATOROS"),
  Type.Literal("VIEW_ONLY_IN_OPERATOROS"),
  Type.Literal("EXTERNAL_SOURCE_REQUIRED"),
  Type.Literal("UNSUPPORTED_CORRECTION"),
]);

export const DataQualityResolutionTargetSchema = Type.Object({
  type: Type.Union([
    Type.Literal("STUDENT_PROFILE"),
    Type.Literal("STUDENT_ENROLLMENT"),
    Type.Literal("STAFF_PROFILE"),
  ]),
  entityId: Type.String({ minLength: 1 }),
  capability: Type.String({ minLength: 1 }),
});

export const DataQualityResolutionItemSchema = Type.Object({
  issueKey: Type.String({ minLength: 1 }),
  entityType: DataQualityEntityTypeSchema,
  entityId: Type.String({ minLength: 1 }),
  entityLabel: Type.String({ minLength: 1 }),
  context: Type.String({ minLength: 1 }),
  field: Type.String({ minLength: 1 }),
  qualityState: DataQualityStateSchema,
  qualityType: DataQualityIssueTypeSchema,
  label: Type.String({ minLength: 1 }),
  currentValue: Type.Union([Type.String(), Type.Null()]),
  resolutionClass: DataQualityResolutionClassSchema,
  resolutionNote: Type.String({ minLength: 1 }),
  resolutionTarget: Type.Union([DataQualityResolutionTargetSchema, Type.Null()]),
});

export const DataQualityResolutionResponseSchema = Type.Object({
  summary: Type.Object({
    totalIssues: Type.Number({ minimum: 0 }),
    editableIssues: Type.Number({ minimum: 0 }),
    viewOnlyIssues: Type.Number({ minimum: 0 }),
    externalIssues: Type.Number({ minimum: 0 }),
    unsupportedIssues: Type.Number({ minimum: 0 }),
  }),
  page: Type.Number({ minimum: 1 }),
  pageSize: Type.Number({ minimum: 1 }),
  total: Type.Number({ minimum: 0 }),
  items: Type.Array(DataQualityResolutionItemSchema),
});

export type DataQualityIssueType = Static<typeof DataQualityIssueTypeSchema>;
export type DataQualityFieldMetric = Static<typeof DataQualityFieldMetricSchema>;
export type StudentDataQualityResponse = Static<typeof StudentDataQualityResponseSchema>;
export type StaffDataQualityResponse = Static<typeof StaffDataQualityResponseSchema>;
export type DataQualityIssue = Static<typeof DataQualityIssueSchema>;
export type DataQualityIssuesResponse = Static<typeof DataQualityIssuesResponseSchema>;
export type DataQualityEntityType = Static<typeof DataQualityEntityTypeSchema>;
export type DataQualityState = Static<typeof DataQualityStateSchema>;
export type DataQualityResolutionClass = Static<typeof DataQualityResolutionClassSchema>;
export type DataQualityResolutionTarget = Static<typeof DataQualityResolutionTargetSchema>;
export type DataQualityResolutionItem = Static<typeof DataQualityResolutionItemSchema>;
export type DataQualityResolutionResponse = Static<typeof DataQualityResolutionResponseSchema>;
