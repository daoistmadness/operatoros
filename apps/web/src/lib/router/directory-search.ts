const oneOf = (...values: string[]) => (value: string) => values.includes(value);
const positiveInteger = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const verificationStatus = oneOf("VERIFIED", "NEEDS_CORRECTION", "UNVERIFIED");

const studentFilters = {
  status: oneOf("active", "pending_review", "inactive", "graduated"),
  nisn_status: oneOf("inputted", "not_inputted"),
  nik_verification_status: verificationStatus,
  kk_verification_status: verificationStatus,
  dapodik_status: oneOf("SYNCHRONIZED", "ENTERED", "PENDING_EXTERNAL_PROCESSING", "NEEDS_CORRECTION", "NOT_STARTED"),
  device_linked: oneOf("linked", "unlinked"),
  academic_year_id: positiveInteger,
  jenjang_id: positiveInteger,
  program_id: positiveInteger,
  grade_id: positiveInteger,
  class_id: positiveInteger,
  page: positiveInteger,
};

const staffFilters = {
  employment_status: oneOf("ACTIVE", "FORMER", "ALL"),
  dapodik_status: oneOf("ACTIVE", "NOT_REGISTERED", "SUBMITTED_OR_COMPLETED", "UNKNOWN"),
  has_nuptk: oneOf("true", "false"),
  jenjang_id: positiveInteger,
  school_unit_id: positiveInteger,
  position_id: positiveInteger,
  joined_from: date,
  joined_to: date,
  sort_by: oneOf("name", "employee_code", "start_date", "position", "status"),
  sort_direction: oneOf("asc", "desc"),
  page: positiveInteger,
};

function pickDirectoryFilters(params: URLSearchParams, filters: Record<string, (value: string) => boolean>) {
  const result = new URLSearchParams();
  for (const [key, accepts] of Object.entries(filters)) {
    const values = params.getAll(key);
    if (values.length === 1 && accepts(values[0])) result.set(key, values[0]);
  }
  return result;
}

export const studentDirectorySearch = (params: URLSearchParams) => pickDirectoryFilters(params, studentFilters);
export const staffDirectorySearch = (params: URLSearchParams) => pickDirectoryFilters(params, staffFilters);

export function directoryHref(path: string, search: URLSearchParams) {
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
