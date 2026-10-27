import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { downloadStaffMonthlyActivities, fetchStaffMonthlyActivities, generateStaffMonthlyActivities, updateStaffMonthlyActivity } from "./staffMonthlyActivities";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

const mockedRequest = vi.mocked(apiRequest);

describe("staff monthly activity API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propagates list filters, generation, versioned updates, and export format", async () => {
    mockedRequest.mockResolvedValue({ data: {}, status: 200, headers: {} } as never);
    await fetchStaffMonthlyActivities({ month: "2026-10", school_unit_id: 8, status: "PENDING" });
    expect(mockedRequest).toHaveBeenLastCalledWith({ path: "/api/staff/monthly-activities", params: { month: "2026-10", school_unit_id: 8, status: "PENDING" } });

    await generateStaffMonthlyActivities("2026-10");
    expect(mockedRequest).toHaveBeenLastCalledWith({ path: "/api/staff/monthly-activities/generate", method: "POST", body: { month: "2026-10" } });

    await updateStaffMonthlyActivity(12, { expected_version: 3, status: "COMPLETED", confirmation_date: "2026-10-27" });
    expect(mockedRequest).toHaveBeenLastCalledWith({ path: "/api/staff/monthly-activities/12", method: "PATCH", body: { expected_version: 3, status: "COMPLETED", confirmation_date: "2026-10-27" } });

    await downloadStaffMonthlyActivities({ month: "2026-10", school_unit_id: 8, format: "pdf" });
    expect(mockedRequest).toHaveBeenLastCalledWith({ path: "/api/staff/monthly-activities/export", params: { month: "2026-10", school_unit_id: 8, format: "pdf" }, responseType: "blob", timeout: 60000, expectedBlobTypes: ["application/pdf"] });
  });
});
