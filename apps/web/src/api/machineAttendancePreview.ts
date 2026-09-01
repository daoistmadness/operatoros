import type { MachineImportApplyResponse, MachineImportPreviewResponse } from "@operatoros/contracts/attendance";
import { apiRequest } from "../lib/api/client";

export async function previewMachineAttendance(file: File, academicYearId: number, jenjangId: number, page = 1): Promise<MachineImportPreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("academic_year_id", String(academicYearId));
  form.append("jenjang_id", String(jenjangId));
  form.append("page", String(page));
  form.append("page_size", "50");
  return (await apiRequest<MachineImportPreviewResponse>({ path: "/api/attendance/machine-import/preview", method: "POST", body: form })).data;
}

export async function applyMachineAttendance(file: File, academicYearId: number, jenjangId: number, expectedPreviewDigest: string): Promise<MachineImportApplyResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("academic_year_id", String(academicYearId));
  form.append("jenjang_id", String(jenjangId));
  form.append("expected_preview_digest", expectedPreviewDigest);
  form.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
  return (await apiRequest<MachineImportApplyResponse>({ path: "/api/attendance/machine-import/apply", method: "POST", body: form })).data;
}
