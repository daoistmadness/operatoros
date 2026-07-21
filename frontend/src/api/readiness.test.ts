import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { getReadiness } from "./readiness";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

describe("readiness API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the authenticated canonical read-only route", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { overall_status: "FIRST_RUN", steps: [] } } as never);
    await expect(getReadiness()).resolves.toEqual({ overall_status: "FIRST_RUN", steps: [] });
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/readiness" });
  });
});
