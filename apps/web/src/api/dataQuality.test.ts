import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../lib/api/client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import { downloadStudentQualityExcel, fetchStudentQuality, fetchStudentQualityIssues } from "./dataQuality";

describe("data quality API adapter", () => {
  beforeEach(() => apiRequest.mockReset());

  it("fetches the student quality overview with scope filters", async () => {
    apiRequest.mockResolvedValue({ data: { totalStudents: 3 } });
    const result = await fetchStudentQuality({ status: "ACTIVE" });
    expect(result).toEqual({ totalStudents: 3 });
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/data-quality/students",
      params: { status: "ACTIVE" },
    });
  });

  it("fetches student issues with field/type/pagination filters", async () => {
    apiRequest.mockResolvedValue({ data: { total: 1, page: 2, pageSize: 10, items: [] } });
    const result = await fetchStudentQualityIssues({ status: "ACTIVE", field: "birth_date", page: 2, page_size: 10 });
    expect(result.page).toBe(2);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/data-quality/students/issues",
      params: { status: "ACTIVE", field: "birth_date", page: 2, page_size: 10 },
    });
  });

  it("downloads the student quality workbook as an Excel blob", async () => {
    const blob = new Blob(["wb"]);
    apiRequest.mockResolvedValue({ data: blob });
    const result = await downloadStudentQualityExcel({ status: "ACTIVE" });
    expect(result).toBe(blob);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/analytics/data-quality/students/export-excel",
      responseType: "blob",
      expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    }));
  });
});
