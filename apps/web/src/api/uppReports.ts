import type {
  UppReportDetailResponseDto,
  UppReportListResponseDto,
  UppReportStatusChangeRequestDto,
  UppReportSummaryDto,
} from "@operatoros/contracts/upp-reports";
import { apiRequest } from "../lib/api/client";

export async function fetchUppReports(month: string): Promise<UppReportListResponseDto> {
  return (await apiRequest<UppReportListResponseDto>({ path: "/api/upp-reports", params: { month } })).data;
}

export async function fetchUppReport(reportId: number): Promise<UppReportDetailResponseDto> {
  return (await apiRequest<UppReportDetailResponseDto>({ path: `/api/upp-reports/${reportId}` })).data;
}

function uploadBody(file: File, values: Record<string, string>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(values)) body.set(name, value);
  body.set("file", file);
  return body;
}

export async function uploadUppReport(schoolUnitId: number, month: string, file: File, notes: string): Promise<UppReportSummaryDto> {
  const body = uploadBody(file, { school_unit_id: String(schoolUnitId), month, ...(notes.trim() ? { notes: notes.trim() } : {}) });
  return (await apiRequest<UppReportSummaryDto>({ path: "/api/upp-reports", method: "POST", body })).data;
}

export async function replaceUppReport(reportId: number, expectedUpdatedAt: string, file: File, notes: string): Promise<UppReportSummaryDto> {
  const body = uploadBody(file, { expected_updated_at: expectedUpdatedAt, ...(notes.trim() ? { notes: notes.trim() } : {}) });
  return (await apiRequest<UppReportSummaryDto>({ path: `/api/upp-reports/${reportId}/versions`, method: "POST", body })).data;
}

export async function changeUppReportStatus(reportId: number, request: UppReportStatusChangeRequestDto, evidence?: File): Promise<UppReportSummaryDto> {
  const body = new FormData();
  for (const [name, value] of Object.entries(request)) if (value !== undefined && value !== null) body.set(name, String(value));
  if (evidence) body.set("evidence", evidence);
  return (await apiRequest<UppReportSummaryDto>({ path: `/api/upp-reports/${reportId}/status`, method: "PATCH", body })).data;
}

export async function downloadUppReport(reportId: number, versionId?: number): Promise<Blob> {
  const suffix = versionId === undefined ? `/api/upp-reports/${reportId}/download` : `/api/upp-reports/${reportId}/versions/${versionId}/download`;
  return (await apiRequest({ path: suffix, responseType: "blob", expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] })).data;
}

export async function downloadUppEvidence(reportId: number, evidenceId: number): Promise<Blob> {
  return (await apiRequest({ path: `/api/upp-reports/${reportId}/evidence/${evidenceId}/download`, responseType: "blob", expectedBlobTypes: ["application/octet-stream"] })).data;
}
