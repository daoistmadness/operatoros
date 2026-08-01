import { apiRequest } from "../lib/api/client";

export type StaffSummary = {
  id: string;
  source_staff_id: string | null;
  full_name: string;
  employment_status: string;
  job_title: string | null;
  birth_place: string | null;
  birth_date: string | null;
  employment_start_date: string | null;
  dapodik_status: string;
};

export type StaffListResponse = { items: StaffSummary[]; total: number; page: number; page_size: number; total_pages: number };

export async function fetchStaff(params: { search?: string; status?: string; page?: number; page_size?: number }): Promise<StaffListResponse> {
  return (await apiRequest<StaffListResponse>({ path: "/api/staff", params })).data;
}
