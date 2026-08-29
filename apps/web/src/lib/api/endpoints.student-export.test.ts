import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
const client = vi.hoisted(() => ({
  API_BLOB_TYPES: { excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  createDownloadUrl: vi.fn(() => "blob:download-url"),
  revokeDownloadUrl: vi.fn(),
}));

vi.mock("./client", () => ({ ...client }));

import { downloadStudentAttendanceHistoryExcel } from "./endpoints";

describe("student attendance history export endpoint", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    client.createDownloadUrl.mockClear();
    client.revokeDownloadUrl.mockClear();
  });

  it("requests the per-student export as an Excel blob with month filters", async () => {
    const blob = new Blob(["workbook"]);
    apiRequest.mockResolvedValue({ data: blob });
    const result = await downloadStudentAttendanceHistoryExcel({ studentMasterId: "abc-123", month: 8, year: 2026 });
    expect(result).toBe(blob);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/student-masters/abc-123/attendance-history/export-excel",
      params: { month: 8, year: 2026 },
      responseType: "blob",
      timeout: 60000,
      expectedBlobTypes: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("omits month filters when the full history is exported", async () => {
    apiRequest.mockResolvedValue({ data: new Blob(["workbook"]) });
    await downloadStudentAttendanceHistoryExcel({ studentMasterId: "abc-123" });
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/student-masters/abc-123/attendance-history/export-excel",
      params: { month: undefined, year: undefined },
    }));
  });
});
