import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../../lib/api/client";
import { ApiError } from "../../../lib/api/errors";
import { getReadiness } from "./readiness";

vi.mock("../../../lib/api/client", () => ({ apiRequest: vi.fn() }));

describe("readiness API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the authenticated canonical read-only route", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { overall_status: "FIRST_RUN", steps: [] } } as never);
    await expect(getReadiness()).resolves.toEqual({ overall_status: "FIRST_RUN", steps: [] });
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/readiness" });
  });

  it("forwards cancellation without changing the route", async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockResolvedValue({ data: { overall_status: "FIRST_RUN", steps: [] } } as never);
    await getReadiness(signal);
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/readiness", signal });
  });

  it("retains nullable values and harmless unknown response fields", async () => {
    const data = {
      overall_status: "OPERATIONALLY_READY",
      extra: "future-compatible",
      steps: [{
        code: "attendance",
        name: "Attendance",
        status: "COMPLETE",
        requirement: "REQUIRED",
        reason: "Configured",
        destination: null,
        can_manage: true,
        responsibility: null,
        extra: 7,
      }],
    };
    vi.mocked(apiRequest).mockResolvedValue({ data } as never);
    await expect(getReadiness()).resolves.toBe(data);
  });

  it("rejects malformed runtime data as a contract error", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: { overall_status: "FIRST_RUN", steps: [{ code: "missing-fields" }] },
    } as never);
    await expect(getReadiness()).rejects.toMatchObject({
      kind: "contract",
      retryable: false,
    } satisfies Partial<ApiError>);
  });
});
