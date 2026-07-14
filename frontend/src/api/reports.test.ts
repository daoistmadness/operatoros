import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import {
  exportAnnualReport, exportMonthlyReport, getAnnualReport, getMonthlyReport, getReportFilters,
  reportsApiPath,
} from "./reports";

vi.mock("../lib/api/client", () => ({
  API_BLOB_TYPES: { pdf: ["application/pdf"], excel: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  apiRequest: vi.fn(), createDownloadUrl: vi.fn(), revokeDownloadUrl: vi.fn(),
}));

const query = { academic_year_id: 4, scope: "combined" as const, month: "2026-01", class_name: "P1A", subject_id: 7 };

describe("reports API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds canonical report paths", () => expect(reportsApiPath("/monthly")).toBe("/api/reports/monthly"));

  it("loads filters through the canonical endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { scopes: [] }, status: 200, headers: {} });
    await getReportFilters({ academic_year_id: 4, scope: "combined" });
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/reports/filters", method: "GET" }));
  });

  it("generates a monthly report with every filter", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await getMonthlyReport(query);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/reports/monthly", params: query }));
  });

  it("generates an annual report without an incompatible month", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await getAnnualReport(query);
    const request = vi.mocked(apiRequest).mock.calls[0][0];
    expect(request.path).toBe("/api/reports/annual");
    expect(request.params).not.toHaveProperty("month");
    expect(request.params).toMatchObject({ academic_year_id: 4, scope: "combined", class_name: "P1A", subject_id: 7 });
  });

  it("uses the monthly PDF export endpoint and preserves filters", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: new Blob(), status: 200, headers: { "content-disposition": "attachment; filename=monthly.pdf" } });
    const file = await exportMonthlyReport("pdf", query);
    const request = vi.mocked(apiRequest).mock.calls[0][0];
    expect(request).toMatchObject({ path: "/api/reports/monthly/export", responseType: "blob" });
    expect(request.params).toMatchObject({ ...query, format: "pdf" });
    expect(file.filename).toBe("monthly.pdf");
  });

  it("uses the annual Excel export endpoint without month", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: new Blob(), status: 200, headers: {} });
    await exportAnnualReport("xlsx", query);
    const request = vi.mocked(apiRequest).mock.calls[0][0];
    expect(request.path).toBe("/api/reports/annual/export");
    expect(request.params).toMatchObject({ academic_year_id: 4, scope: "combined", class_name: "P1A", subject_id: 7, format: "xlsx" });
    expect(request.params).not.toHaveProperty("month");
  });

  it("never creates a double API prefix", () => {
    ["/filters", "/monthly", "/annual", "/monthly/export", "/annual/export"].forEach((path) => {
      expect(reportsApiPath(path)).not.toContain("/api/api/");
    });
  });
});
