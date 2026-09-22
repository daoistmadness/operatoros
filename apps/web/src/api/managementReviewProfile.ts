import type { ManagementReviewProfileResponse } from "@operatoros/contracts/analytics";
import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";

export type ManagementReviewProfileFilters = {
  academic_year_id: number; term_id: number; jenjang_id?: number | null; class_id?: number | null;
  residence_group_by?: "kelurahan" | "kecamatan" | "city_regency" | "province"; residence_top_n?: 5 | 10 | "all";
};
const params = (value: ManagementReviewProfileFilters) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => [key, String(item)]));
export async function fetchManagementReviewProfile(filters: ManagementReviewProfileFilters) { return (await apiRequest<ManagementReviewProfileResponse>({ path: "/api/analytics/management-review/student-profile", params: params(filters) })).data; }
export async function exportManagementReviewProfile(format: "pdf" | "xlsx", filters: ManagementReviewProfileFilters) { return (await apiRequest<Blob>({ path: `/api/analytics/management-review/student-profile/export.${format}`, params: params(filters), responseType: "blob", expectedBlobTypes: format === "pdf" ? API_BLOB_TYPES.pdf : API_BLOB_TYPES.excel })).data; }
export async function fetchConfiguredTerms(academicYearId: number) { return (await apiRequest<Array<{ id: number; academic_year_id: number; term_number: number; label: string; start_date: string; end_date: string }>>({ path: "/api/academic-config/terms", params: { academic_year_id: academicYearId } })).data; }
