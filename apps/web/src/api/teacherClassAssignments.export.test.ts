import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../lib/api/client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import { exportAssignedClassAttendanceExcel } from "./teacherClassAssignments";

describe("assigned class attendance export endpoint", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("requests the class-month export as an Excel blob", async () => {
    const blob = new Blob(["workbook"]);
    apiRequest.mockResolvedValue({ data: blob });
    const result = await exportAssignedClassAttendanceExcel({ classId: 7, month: 8, year: 2026 });
    expect(result).toBe(blob);
    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/attendance/classes/7/attendance/export-excel",
      params: { month: 8, year: 2026 },
      responseType: "blob",
      timeout: 60000,
      expectedBlobTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    });
  });
});
