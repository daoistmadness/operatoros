import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../../lib/api/client";
import { getReadiness } from "./readiness";

vi.mock("../../../lib/api/client", () => ({ apiRequest: vi.fn() }));

const response = {
  overall: { state: "ACTION_REQUIRED" as const, summary: "Setup needs attention." },
  foundation: [],
  operational: [],
  features: [],
  overall_status: "FIRST_RUN" as const,
  steps: [],
};

describe("readiness API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the authenticated canonical read-only route", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: response } as never);
    await expect(getReadiness()).resolves.toBe(response);
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/readiness" });
  });

  it("forwards cancellation without changing the route", async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockResolvedValue({ data: response } as never);
    await getReadiness(signal);
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/readiness", signal });
  });

  it("consumes the shared public readiness shape instead of a Web-local DTO", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { ...response, foundation: [{ key: "jenjang", label: "Programs / Jenjang", state: "ACTION_REQUIRED", summary: "Configure it.", actions: [] }] } } as never);
    await expect(getReadiness()).resolves.toMatchObject({ foundation: [{ key: "jenjang" }] });
  });
});
