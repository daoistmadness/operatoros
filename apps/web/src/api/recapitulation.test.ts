import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../lib/api/client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import { downloadStaffRecapExcel, downloadStudentRecapExcel, fetchStaffRecap, fetchStudentRecap } from "./recapitulation";

describe("recapitulation API adapter", () => {
  beforeEach(() => apiRequest.mockReset());

  it("fetches the student recap with filters", async () => {
    apiRequest.mockResolvedValue({ data: { total: 4 } });
    const result = await fetchStudentRecap({ dimension: "gender", status: "ACTIVE" });
    expect(result).toEqual({ total: 4 });
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/recapitulation/students",
      params: { dimension: "gender", status: "ACTIVE" },
    });
  });

  it("fetches the staff recap with filters", async () => {
    apiRequest.mockResolvedValue({ data: { total: 3 } });
    const result = await fetchStaffRecap({ dimension: "education", employment_status: "ACTIVE" });
    expect(result).toEqual({ total: 3 });
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/recapitulation/staff",
      params: { dimension: "education", employment_status: "ACTIVE" },
    });
  });

  it("downloads the student workbook as an Excel blob", async () => {
    const blob = new Blob(["wb"]);
    apiRequest.mockResolvedValue({ data: blob });
    const result = await downloadStudentRecapExcel({ status: "ACTIVE" });
    expect(result).toBe(blob);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/analytics/recapitulation/students/export-excel",
      responseType: "blob",
      expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    }));
  });

  it("downloads the staff workbook as an Excel blob", async () => {
    const blob = new Blob(["wb"]);
    apiRequest.mockResolvedValue({ data: blob });
    const result = await downloadStaffRecapExcel({ employment_status: "FORMER" });
    expect(result).toBe(blob);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/analytics/recapitulation/staff/export-excel",
      params: { employment_status: "FORMER" },
    }));
  });
});
