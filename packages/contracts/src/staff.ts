import { Type, type Static } from "@sinclair/typebox";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const StaffStatus = Type.Union([
  Type.Literal("ACTIVE"), Type.Literal("FORMER"), Type.Literal("UNKNOWN"), Type.Literal("REVIEW_REQUIRED"),
]);
export const StaffPositionCategory = Type.Union([
  Type.Literal("LEADERSHIP"), Type.Literal("TEACHING"), Type.Literal("TEACHING_SUPPORT"),
  Type.Literal("ADMINISTRATION"), Type.Literal("FINANCE"), Type.Literal("HR"), Type.Literal("MARKETING"),
  Type.Literal("IT"), Type.Literal("FACILITIES"), Type.Literal("SECURITY"),
  Type.Literal("GENERAL_SUPPORT"), Type.Literal("OTHER"),
]);

export const StaffCreateRequest = Type.Object({
  full_name: Type.String({ minLength: 1, maxLength: 255 }),
  source_staff_id: Type.Optional(NullableString),
  employment_status: Type.Optional(Type.Union([Type.Literal("ACTIVE"), Type.Literal("FORMER")])),
  birth_place: Type.Optional(NullableString),
  birth_date: Type.Optional(NullableString),
  job_title_raw: Type.Optional(NullableString),
  employment_start_date: Type.Optional(NullableString),
  employment_end_date: Type.Optional(NullableString),
  dapodik_status_raw: Type.Optional(NullableString),
  nip: Type.Optional(NullableString),
  nuptk: Type.Optional(NullableString),
  nik: Type.Optional(NullableString),
  email: Type.Optional(NullableString),
  phone: Type.Optional(NullableString),
  address: Type.Optional(NullableString),
}, { additionalProperties: false });
export type StaffCreateRequestDto = Static<typeof StaffCreateRequest>;

const StaffUpdateFields = Type.Omit(StaffCreateRequest, ["employment_status"]);
export const StaffUpdateRequest = Type.Partial(Type.Object({ ...StaffUpdateFields.properties, expected_updated_at: Type.String() }, { additionalProperties: false }));
export type StaffUpdateRequestDto = Static<typeof StaffUpdateRequest>;

export const StaffStatusChangeRequest = Type.Object({
  employment_status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("FORMER")]),
  effective_date: Type.String({ minLength: 10, maxLength: 10 }),
}, { additionalProperties: false });
export const StaffStatusChangeResponse = Type.Object({ staff_id: Type.String(), employment_status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("FORMER")]), employment_end_date: NullableString, effective_date: Type.String() });

export const StaffJenjang = Type.Object({ id: Type.Number(), name: Type.String(), code: NullableString, level: NullableString, active: Type.Boolean() });
export const StaffEducationRecord = Type.Object({
  id: Type.Number(), education_level: Type.String(), institution_name: Type.String(), major: NullableString,
  graduation_year: Type.Union([Type.Number(), Type.Null()]), notes: NullableString, created_at: Type.Optional(Type.String()), updated_at: Type.Optional(Type.String()),
});
export const StaffProfileResponse = Type.Object({
  id: Type.String(), source_staff_id: NullableString, full_name: Type.String(), employment_status: Type.String(), job_title: NullableString,
  job_title_raw: NullableString,
  employment_start_date: NullableString, employment_end_date: NullableString, dapodik_status: Type.String(), updated_at: Type.String(),
  dapodik_status_raw: NullableString,
  has_nuptk: Type.Boolean(), identifiers: Type.Array(Type.Object({ identifier_type: Type.String(), normalized_value: NullableString, verification_status: Type.String() })),
  jenjangs: Type.Array(StaffJenjang), education_history: Type.Array(StaffEducationRecord),
  service_years: Type.Union([Type.Number(), Type.Null()]), service_months: Type.Union([Type.Number(), Type.Null()]),
  highest_education_level: NullableString, highest_education_institution: NullableString,
});
export const StaffListQuery = Type.Object({
  search: Type.Optional(Type.String()), status: Type.Optional(Type.String()), employment_status: Type.Optional(Type.String()),
  page: Type.Optional(Type.String()), page_size: Type.Optional(Type.String()), job_title: Type.Optional(Type.String()),
  position_id: Type.Optional(Type.String()), joined_from: Type.Optional(Type.String()), joined_to: Type.Optional(Type.String()),
  dapodik_status: Type.Optional(Type.String()), jenjang_id: Type.Optional(Type.String()), has_nuptk: Type.Optional(Type.String()),
  sort_by: Type.Optional(Type.String()), sort_direction: Type.Optional(Type.String()),
});
export const StaffListResponse = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String(), source_staff_id: NullableString, full_name: Type.String(), employment_status: Type.String(), job_title: NullableString,
    employment_start_date: NullableString, employment_end_date: NullableString, dapodik_status: Type.String(), nip: NullableString,
    has_nuptk: Type.Boolean(), jenjangs: Type.Array(StaffJenjang), service_years: Type.Union([Type.Number(), Type.Null()]), service_months: Type.Union([Type.Number(), Type.Null()]),
    highest_education_level: NullableString, highest_education_institution: NullableString,
  })),
  total: Type.Number(), page: Type.Number(), page_size: Type.Number(), total_pages: Type.Number(),
  counts: Type.Object({ ACTIVE: Type.Number(), FORMER: Type.Number(), ALL: Type.Number() }),
});
export const StaffSensitiveResponse = Type.Object({
  birth_place: NullableString, birth_date: NullableString,
  identifiers: Type.Array(Type.Object({ type: Type.String(), normalized_value: NullableString, verification_status: Type.String() })),
  contact: Type.Union([Type.Object({ email: NullableString, phone: NullableString, address: NullableString }), Type.Null()]),
});
export const StaffPositionMappingResponse = Type.Object({ id: Type.Number(), raw_title: Type.String(), normalized_title: Type.String(), position_category: Type.Union([StaffPositionCategory, Type.Null()]), is_teaching_role: Type.Union([Type.Boolean(), Type.Null()]), status: Type.Union([Type.Literal("PENDING"), Type.Literal("APPROVED")]), employee_count: Type.Optional(Type.Number()) });

export const StaffPositionMappingUpdate = Type.Object({
  normalized_title: Type.String({ minLength: 1, maxLength: 255 }),
  position_category: Type.Union([StaffPositionCategory, Type.Null()]),
  is_teaching_role: Type.Union([Type.Boolean(), Type.Null()]),
  status: Type.Union([Type.Literal("PENDING"), Type.Literal("APPROVED")]),
}, { additionalProperties: false });

export const StaffImportValidationIssue = Type.Object({
  field: Type.String(), code: Type.String(), severity: Type.Union([Type.Literal("INFO"), Type.Literal("WARNING"), Type.Literal("ERROR")]), message: Type.String(),
});
export const StaffImportPreviewResponse = Type.Object({
  batch_id: Type.String(), file_sha256: Type.String(), source_filename: Type.String(), source_sheet: Type.String(),
  column_mapping: Type.Record(Type.String(), Type.String()),
  summary: Type.Object({ total: Type.Number(), valid: Type.Number(), new: Type.Number(), matched: Type.Number(), updates: Type.Number(), unchanged: Type.Number(), warnings: Type.Number(), invalid: Type.Number(), conflicts: Type.Number(), duplicates: Type.Number() }),
  rows: Type.Array(Type.Object({ row_number: Type.Number(), state: Type.String(), full_name: Type.String(), employee_code_masked: NullableString, issues: Type.Array(StaffImportValidationIssue) })),
});
export const StaffImportBatchHistoryResponse = Type.Object({ items: Type.Array(Type.Object({
  id: Type.String(), source_filename: Type.String(), source_sheet: Type.String(), file_sha256: Type.String(), imported_at: Type.String(), actor: Type.String(),
  total_rows: Type.Number(), active_count: Type.Number(), former_count: Type.Number(), review_count: Type.Number(), issue_count: Type.Number(), status: Type.String(),
})) });
export const StaffImportBatchResponse = Type.Object({
  id: Type.String(), source_filename: Type.String(), source_sheet: Type.String(), file_sha256: Type.String(), imported_at: Type.String(), status: Type.String(),
  total_rows: Type.Number(), active_count: Type.Number(), former_count: Type.Number(), review_count: Type.Number(), issue_count: Type.Number(), issue_counts: Type.Record(Type.String(), Type.Number()),
});
export const StaffImportCommitRequest = Type.Object({ batch_id: Type.String({ minLength: 1 }), row_numbers: Type.Array(Type.Number({ minimum: 2 }), { maxItems: 10000 }) });
export const StaffImportCommitResponse = Type.Object({ batch_id: Type.String(), status: Type.String(), summary: Type.Object({ inserted: Type.Number(), updated: Type.Number(), unchanged: Type.Number(), rejected: Type.Number(), failed: Type.Number() }), failed_rows: Type.Array(Type.Object({ row_number: Type.Number(), code: Type.String() })) });

export const StaffHistoryResponse = Type.Array(Type.Object({ id: Type.String(), action: Type.String(), effective_date: NullableString, changed_fields: Type.Array(Type.String()), metadata: Type.Record(Type.String(), Type.Unknown()), actor: Type.String(), created_at: Type.String() }));

const Metric = Type.Object({ count: Type.Number(), percentage: Type.Union([Type.Number(), Type.Null()]) });
const Distribution = Type.Array(Type.Object({ label: Type.String(), count: Type.Number(), percentage: Type.Union([Type.Number(), Type.Null()]) }));
export const StaffAnalyticsSummary = Type.Object({
  as_of_date: Type.String(), workforce: Type.Object({ total: Type.Number(), active: Type.Number(), former: Type.Number(), unknown_status: Type.Number(), status_coverage: Metric, teaching: Type.Union([Type.Number(), Type.Null()]), non_teaching: Type.Union([Type.Number(), Type.Null()]), unclassified_positions: Type.Number() }),
  age: Type.Object({ average_years: Type.Union([Type.Number(), Type.Null()]), coverage: Metric, distribution: Distribution }),
  tenure: Type.Object({ average_years: Type.Union([Type.Number(), Type.Null()]), median_years: Type.Union([Type.Number(), Type.Null()]), coverage: Metric, distribution: Distribution }),
  dapodik: Type.Object({ coverage: Metric, distribution: Distribution }),
  nuptk: Type.Object({ with_nuptk: Type.Number(), without_nuptk: Type.Number(), coverage: Metric }),
  data_quality: Type.Object({
    fields: Type.Array(Type.Object({ field: Type.String(), present: Type.Number(), missing: Type.Number(), coverage: Type.Union([Type.Number(), Type.Null()]) })),
    duplicate_identity_count: Type.Number(), invalid_identifier_count: Type.Number(), unmapped_position_count: Type.Number(), unresolved_import_conflict_count: Type.Number(),
  }),
  positions: Type.Array(Type.Object({ label: Type.String(), count: Type.Number(), active_count: Type.Number(), percentage: Type.Union([Type.Number(), Type.Null()]) })),
  joining: Distribution,
});
export type StaffAnalyticsSummaryDto = Static<typeof StaffAnalyticsSummary>;
