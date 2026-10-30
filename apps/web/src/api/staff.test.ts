import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { fetchSensitiveStaff, fetchStaffDetail } from "./staff";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

describe("staff read cancellation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards cancellation to staff and sensitive staff reads", async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ data: {} as never, status: 200, headers: {} })
      .mockResolvedValueOnce({ data: {} as never, status: 200, headers: {} });

    await fetchStaffDetail("staff-1", signal);
    await fetchSensitiveStaff("staff-1", signal);

    expect(apiRequest).toHaveBeenNthCalledWith(1, { path: "/api/staff/staff-1", signal });
    expect(apiRequest).toHaveBeenNthCalledWith(2, { path: "/api/staff/staff-1/sensitive", signal });
  });
});
