import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { fetchManagementOverview } from "./managementOverview";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

describe("fetchManagementOverview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards cancellation to the authenticated API request", async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockResolvedValue({ data: {} as never, status: 200, headers: {} });

    await fetchManagementOverview({ academic_year_id: 10, jenjang_id: 2, class_id: 7 }, signal);

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/management-overview",
      params: {
        academic_year_id: "10",
        jenjang_id: "2",
        class_id: "7",
        attendance_date_from: undefined,
        attendance_date_to: undefined,
      },
      signal,
    });
  });
});
