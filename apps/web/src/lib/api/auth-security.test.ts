import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, apiRequest } from "./client";
import { login, logout } from "../../api/auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("cookie-session client boundary", () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("includes cookies without reading a legacy local token", async () => {
    localStorage.setItem("authToken", "must-not-be-sent");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    await apiRequest({ path: "/api/auth/me" });
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("Expected fetch request options.");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("signals 401 as session loss and 403 as a separate permission change hint", async () => {
    const unauthorized = vi.fn();
    const forbidden = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
    window.addEventListener(AUTH_FORBIDDEN_EVENT, forbidden);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }));
    await expect(apiRequest({ path: "/api/auth/me" })).rejects.toMatchObject({ status: 401 });
    await expect(apiRequest({ path: "/api/admin/backups" })).rejects.toMatchObject({ status: 403 });
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
    window.removeEventListener(AUTH_FORBIDDEN_EVENT, forbidden);
  });

  it("ignores a pending request's 401 after a successful login", async () => {
    const pendingResponse = deferred<Response>();
    const currentResponse = deferred<Response>();
    const listener = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pendingResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, username: "admin", role: "admin" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockReturnValueOnce(currentResponse.promise);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);

    const pendingRequest = apiRequest({ path: "/api/students" });
    await login("admin", "synthetic-password");
    pendingResponse.resolve(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }));

    await expect(pendingRequest).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();

    const currentRequest = apiRequest({ path: "/api/students/current" });
    currentResponse.resolve(new Response(null, { status: 401 }));
    await expect(currentRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });

  it("ignores an in-flight old-session 401 after confirmed logout", async () => {
    const pendingResponse = deferred<Response>();
    const listener = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pendingResponse.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);

    const pendingRequest = apiRequest({ path: "/api/students" });
    await logout();
    pendingResponse.resolve(new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }));

    await expect(pendingRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });

  it("handles one current 401 immediately and ignores concurrent responses from that invalidated epoch", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const current = deferred<Response>();
    const listener = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(current.promise);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);

    const firstRequest = apiRequest({ path: "/api/students/first" });
    const secondRequest = apiRequest({ path: "/api/students/second" });
    first.resolve(new Response(null, { status: 401 }));
    await expect(firstRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();

    second.resolve(new Response(null, { status: 401 }));
    await expect(secondRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();

    const currentRequest = apiRequest({ path: "/api/students/current" });
    current.resolve(new Response(null, { status: 401 }));
    await expect(currentRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });

  it("keeps failed logout from making an in-flight 401 obsolete", async () => {
    const pendingResponse = deferred<Response>();
    const listener = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pendingResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Server error" }), { status: 500 }));
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);

    const pendingRequest = apiRequest({ path: "/api/students" });
    await expect(logout()).rejects.toMatchObject({ status: 500 });
    pendingResponse.resolve(new Response(null, { status: 401 }));

    await expect(pendingRequest).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });
});
