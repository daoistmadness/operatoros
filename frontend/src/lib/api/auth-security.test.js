import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_UNAUTHORIZED_EVENT, apiRequest } from "./client";

describe("cookie-session client boundary", () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("includes cookies without reading a legacy local token", async () => {
    localStorage.setItem("authToken", "must-not-be-sent");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    await apiRequest({ path: "/api/auth/me" });
    const init = fetchMock.mock.calls[0][1];
    expect(init.credentials).toBe("include");
    expect(init.headers.get("Authorization")).toBeNull();
  });

  it("broadcasts 401 but not 403 as a session-loss event", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }));
    await expect(apiRequest({ path: "/api/auth/me" })).rejects.toMatchObject({ status: 401 });
    await expect(apiRequest({ path: "/api/admin/backups" })).rejects.toMatchObject({ status: 403 });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });
});
