import type {
  StaffMonthlyActivityGenerateResponseDto,
  StaffMonthlyActivityHistoryResponseDto,
  StaffMonthlyActivityItemDto,
  StaffMonthlyActivityListResponseDto,
  StaffMonthlyActivityStatusDto,
  StaffMonthlyActivityTrendResponseDto,
} from "@operatoros/contracts/staff";
import { apiRequest } from "../lib/api/client";

export type StaffMonthlyActivityFilters = { month: string; school_unit_id?: number; status?: StaffMonthlyActivityStatusDto };
export type StaffMonthlyActivitySummaryFilters = { from_month: string; to_month: string; school_unit_id?: number };
export type StaffMonthlyActivityUpdate = {
  expected_version: number;
  status?: StaffMonthlyActivityStatusDto;
  confirmation_date?: string;
  processing_notes?: string | null;
  reason?: string;
};

export async function fetchStaffMonthlyActivities(filters: StaffMonthlyActivityFilters): Promise<StaffMonthlyActivityListResponseDto> {
  return (await apiRequest<StaffMonthlyActivityListResponseDto>({ path: "/api/staff/monthly-activities", params: filters })).data;
}

export async function fetchStaffMonthlyActivitySummary(filters: StaffMonthlyActivitySummaryFilters): Promise<StaffMonthlyActivityTrendResponseDto> {
  return (await apiRequest<StaffMonthlyActivityTrendResponseDto>({ path: "/api/staff/monthly-activities/summary", params: filters })).data;
}

export async function generateStaffMonthlyActivities(month: string): Promise<StaffMonthlyActivityGenerateResponseDto> {
  return (await apiRequest<StaffMonthlyActivityGenerateResponseDto>({ path: "/api/staff/monthly-activities/generate", method: "POST", body: { month } })).data;
}

export async function updateStaffMonthlyActivity(activityId: number, body: StaffMonthlyActivityUpdate): Promise<StaffMonthlyActivityItemDto> {
  return (await apiRequest<StaffMonthlyActivityItemDto>({ path: `/api/staff/monthly-activities/${activityId}`, method: "PATCH", body })).data;
}

export async function fetchStaffMonthlyActivityHistory(activityId: number): Promise<StaffMonthlyActivityHistoryResponseDto> {
  return (await apiRequest<StaffMonthlyActivityHistoryResponseDto>({ path: `/api/staff/monthly-activities/${activityId}/history` })).data;
}

export async function downloadStaffMonthlyActivities(filters: StaffMonthlyActivityFilters & { format: "xlsx" | "pdf" }): Promise<Blob> {
  const mimeType = filters.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
  return (await apiRequest({ path: "/api/staff/monthly-activities/export", params: filters, responseType: "blob", timeout: 60000, expectedBlobTypes: [mimeType] })).data;
}
