import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { AUTH_UNAUTHORIZED_EVENT, apiRequest } from "../lib/api/client";
import { getCurrentUser } from "../api/auth";
import { createAuthSessionSync } from "../lib/auth/sessionSync";
import { createTestQueryClient } from "../lib/query/queryClient";

const mock = vi.hoisted(() => {
  const admin = { id: 1, username: "admin", role: "admin" as const, capabilities: ["view_student", "manage_staff"] };
  const downgraded = { id: 1, username: "admin", role: "staff" as const, capabilities: ["view_student"] };
  const checker = { id: 2, username: "checker", role: "admin" as const, capabilities: ["view_student"] };
  type TestUser = typeof admin | typeof downgraded | typeof checker;
  return { admin, downgraded, checker, session: { current: null as TestUser | null }, nextUserResponse: null as Promise<TestUser> | null, logoutError: null as Error | null };
});

vi.mock("../api/auth", () => ({
  getCurrentUser: vi.fn(async () => {
    if (mock.nextUserResponse) return mock.nextUserResponse;
    if (!mock.session.current) throw new Error("unauthorized");
    return mock.session.current;
  }),
  login: vi.fn(async (username: string) => {
    mock.session.current = username === "checker" ? mock.checker : mock.admin;
    return mock.session.current;
  }),
  logout: vi.fn(async () => {
    if (mock.logoutError) throw mock.logoutError;
    mock.session.current = null;
  }),
}));

type MockUser = NonNullable<typeof mock.session.current>;

const STUDENT_KEY = ["students", "list", "synthetic"] as const;
const LATE_STUDENT_KEY = ["students", "late", "synthetic"] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

type Tab = { client: QueryClient; container: HTMLDivElement; root: Root };
type Snapshot = { username: string | null; hasStudent: boolean };

const snapshots: Record<string, Snapshot[]> = {};
const containers: HTMLDivElement[] = [];
const roots: Root[] = [];

function TabProbe({ id }: { id: string }) {
  const auth = useAuth();
  const [logoutError, setLogoutError] = useState("");
  const student = useQuery({
    queryKey: STUDENT_KEY,
    queryFn: async () => "network",
    enabled: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    const list = snapshots[id] ?? [];
    list.push({ username: auth.user?.username ?? null, hasStudent: student.data !== undefined });
    snapshots[id] = list;
  });

  return (
    <div>
      <span data-testid={`${id}-auth`}>{auth.loading ? "loading" : auth.user?.username ?? "anonymous"}</span>
      <span data-testid={`${id}-role`}>{auth.user?.role ?? "anonymous"}</span>
      <span data-testid={`${id}-manage`}>{auth.can("manage_staff") ? "yes" : "no"}</span>
      <span data-testid={`${id}-verification`}>{auth.sessionVerification ?? "idle"}</span>
      <span data-testid={`${id}-student`}>{student.data ?? "empty"}</span>
      <button data-testid={`${id}-login-checker`} onClick={() => void auth.login("checker", "secret")}>login checker</button>
      <button data-testid={`${id}-logout`} onClick={() => { setLogoutError(""); void auth.logout().catch(() => setLogoutError("logout failed")); }}>logout</button>
      {auth.sessionVerification === "unavailable" && <button data-testid={`${id}-retry-session`} onClick={() => void auth.retrySessionVerification?.()}>retry session</button>}
      <span data-testid={`${id}-logout-error`}>{logoutError}</span>
    </div>
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

function text(tab: Tab, id: string) {
  return tab.container.querySelector(`[data-testid="${id}-auth"]`)?.textContent ?? "";
}

function role(tab: Tab, id: string) {
  return tab.container.querySelector(`[data-testid="${id}-role"]`)?.textContent ?? "";
}

function canManageStaff(tab: Tab, id: string) {
  return tab.container.querySelector(`[data-testid="${id}-manage"]`)?.textContent ?? "";
}

function click(tab: Tab, id: string) {
  const button = tab.container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`Missing button ${id}`);
  button.click();
}

async function renderTab(id: string) {
  const client = createTestQueryClient();
  client.setQueryData(STUDENT_KEY, `student-of-${id}`);
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TabProbe id={id} />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  const tab = { client, container, root };
  await waitFor(() => expect(text(tab, id)).toBe("admin"));
  return tab;
}

function expectNoNewSessionWithOldData(id: string, username: string) {
  expect(snapshots[id]?.some((snapshot) => snapshot.username === username && snapshot.hasStudent)).toBe(false);
}

describe("AuthProvider cross-tab session isolation", () => {
  beforeEach(() => {
    mock.session.current = mock.admin;
    mock.nextUserResponse = null;
    mock.logoutError = null;
    vi.clearAllMocks();
    for (const key of Object.keys(snapshots)) delete snapshots[key];
  });

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    for (const container of containers.splice(0)) container.remove();
  });

  it("clears cached protected data in another tab when an account switch occurs", async () => {
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");

    await act(async () => click(tab2, "tab2-login-checker"));
    await waitFor(() => expect(text(tab2, "tab2")).toBe("checker"));
    await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
    await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expect(tab2.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expectNoNewSessionWithOldData("tab1", "checker");
    expectNoNewSessionWithOldData("tab2", "checker");
  });

  it("ignores a delayed 401 from before a cross-tab account switch", async () => {
    const pendingResponse = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingResponse.promise);
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");
    const pendingRequest = apiRequest({ path: "/api/students" });

    await act(async () => click(tab2, "tab2-login-checker"));
    await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
    tab1.client.setQueryData(STUDENT_KEY, "student-of-checker");

    pendingResponse.resolve(new Response(null, { status: 401 }));
    await expect(pendingRequest).rejects.toMatchObject({ status: 401 });

    expect(text(tab1, "tab1")).toBe("checker");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-checker");
    fetchMock.mockRestore();
  });

  it("clears cached protected data in another tab when the session logs out", async () => {
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");

    await act(async () => click(tab2, "tab2-logout"));
    await waitFor(() => expect(text(tab2, "tab2")).toBe("anonymous"));
    await waitFor(() => expect(text(tab1, "tab1")).toBe("anonymous"));
    await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expect(tab2.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expectNoNewSessionWithOldData("tab1", "checker");
  });

  it("keeps both tabs authenticated when logout is not confirmed, then clears both on retry", async () => {
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");
    mock.logoutError = new Error("network");

    await act(async () => click(tab2, "tab2-logout"));
    await waitFor(() => expect(tab2.container.querySelector('[data-testid="tab2-logout-error"]')?.textContent).toBe("logout failed"));

    expect(text(tab1, "tab1")).toBe("admin");
    expect(text(tab2, "tab2")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
    expect(tab2.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab2");

    mock.logoutError = null;
    await act(async () => click(tab2, "tab2-logout"));
    await waitFor(() => expect(text(tab2, "tab2")).toBe("anonymous"));
    await waitFor(() => expect(text(tab1, "tab1")).toBe("anonymous"));

    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expect(tab2.client.getQueryData(STUDENT_KEY)).toBeUndefined();
  });

  it("revalidates on focus when BroadcastChannel is unavailable", async () => {
    const saved = globalThis.BroadcastChannel;
    // Simulate a browser without the cross-tab channel API.
    delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    try {
      const tab1 = await renderTab("tab1");
      const tab2 = await renderTab("tab2");

      await act(async () => click(tab2, "tab2-login-checker"));
      await waitFor(() => expect(text(tab2, "tab2")).toBe("checker"));
      expect(text(tab1, "tab1")).toBe("admin");
      expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
      await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

      expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
      expectNoNewSessionWithOldData("tab1", "checker");
    } finally {
      (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = saved;
    }
  });

  it("covers the current session while checking a missed cross-tab signal", async () => {
    const tab1 = await renderTab("tab1");
    await renderTab("tab2");

    // Simulate a suspended tab that missed a change signal.
    mock.session.current = mock.checker;
    let resolveCurrentUser = (_user: MockUser) => {};
    mock.nextUserResponse = new Promise((resolve) => { resolveCurrentUser = resolve; });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(text(tab1, "tab1")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
    expect(tab1.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("checking");

    await act(async () => {
      resolveCurrentUser(mock.checker);
      await Promise.resolve();
    });
    await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));

    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expectNoNewSessionWithOldData("tab1", "checker");
  });

  it("clears cached protected data on a global 401 event", async () => {
    const tab1 = await renderTab("tab1");

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    });
    await waitFor(() => expect(text(tab1, "tab1")).toBe("anonymous"));

    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty");
  });

  it("clears same-user protected data immediately while a deferred 403 revalidates permissions", async () => {
    const pendingResponse = deferred<Response>();
    const pendingUser = deferred<MockUser>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingResponse.promise);
    try {
      const tab = await renderTab("tab1");
      mock.session.current = mock.downgraded;
      mock.nextUserResponse = pendingUser.promise;
      const request = apiRequest({ path: "/api/admin/operations" });
      pendingResponse.resolve(new Response(JSON.stringify({ detail: "Insufficient permissions" }), { status: 403 }));

      await expect(request).rejects.toMatchObject({ status: 403 });
      await waitFor(() => expect(tab.client.getQueryData(STUDENT_KEY)).toBeUndefined());
      expect(role(tab, "tab1")).toBe("admin");

      pendingUser.resolve(mock.downgraded);
      await waitFor(() => expect(role(tab, "tab1")).toBe("staff"));

      expect(text(tab, "tab1")).toBe("admin");
      expect(canManageStaff(tab, "tab1")).toBe("no");
      expect(tab.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("clears protected data across tabs when a non-sensitive permission-change signal arrives", async () => {
    const pendingUser = deferred<MockUser>();
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");
    const notifier = createAuthSessionSync();
    const closeNotifier = notifier.subscribe(() => {});
    mock.session.current = mock.downgraded;
    mock.nextUserResponse = pendingUser.promise;

    notifier.notifyAuthorizationChange();
    await waitFor(() => expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined());
    await waitFor(() => expect(tab2.client.getQueryData(STUDENT_KEY)).toBeUndefined());
    expect(role(tab1, "tab1")).toBe("admin");
    expect(role(tab2, "tab2")).toBe("admin");

    pendingUser.resolve(mock.downgraded);
    await waitFor(() => expect(role(tab1, "tab1")).toBe("staff"));
    await waitFor(() => expect(role(tab2, "tab2")).toBe("staff"));
    expect(canManageStaff(tab1, "tab1")).toBe("no");
    expect(canManageStaff(tab2, "tab2")).toBe("no");
    closeNotifier();
  });

  it("keeps the authenticated session when a 403 does not reflect a permission change", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "Insufficient permissions" }), { status: 403 }));
    try {
      const tab = await renderTab("tab1");
      await expect(apiRequest({ path: "/api/staff/private-record" })).rejects.toMatchObject({ status: 403 });
      await flush();

      expect(role(tab, "tab1")).toBe("admin");
      expect(text(tab, "tab1")).toBe("admin");
      expect(tab.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("revalidates same-user permissions on focus and ignores a late protected response", async () => {
    let resolveLate: ((value: string) => void) | null = null;
    const tab = await renderTab("tab1");
    await act(async () => {
      void tab.client.fetchQuery({
        queryKey: LATE_STUDENT_KEY,
        staleTime: Infinity,
        queryFn: ({ signal }) => new Promise<string>((resolve, reject) => {
          resolveLate = resolve;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      }).catch(() => undefined);
      await Promise.resolve();
    });

    mock.session.current = mock.downgraded;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => expect(role(tab, "tab1")).toBe("staff"));
    expect(tab.client.getQueryData(STUDENT_KEY)).toBeUndefined();

    await act(async () => {
      resolveLate?.("late-admin-data");
      await flush();
    });
    expect(tab.client.getQueryData(LATE_STUDENT_KEY)).toBeUndefined();
  });

  it("keeps protected data covered while same-user focus verification is pending", async () => {
    const tab1 = await renderTab("tab1");
    const pendingUser = deferred<MockUser>();
    mock.nextUserResponse = pendingUser.promise;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(text(tab1, "tab1")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
    expect(tab1.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("checking");

    await act(async () => pendingUser.resolve(mock.admin));
    await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("idle"));
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
  });

  it("keeps the session covered after a failed check and reveals it after a successful retry", async () => {
    const tab = await renderTab("tab1");
    const pendingCheck = deferred<MockUser>();
    mock.nextUserResponse = pendingCheck.promise;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(2));
    await act(async () => pendingCheck.reject(new Error("network unavailable")));
    await waitFor(() => expect(tab.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("unavailable"));

    expect(text(tab, "tab1")).toBe("admin");
    expect(tab.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");

    mock.nextUserResponse = Promise.resolve(mock.admin);
    await act(async () => click(tab, "tab1-retry-session"));
    await waitFor(() => expect(tab.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("idle"));
    expect(tab.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
  });

  it("coalesces paired focus and visibility events into one session check", async () => {
    const tab = await renderTab("tab1");
    vi.mocked(getCurrentUser).mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await flush();

    expect(getCurrentUser).toHaveBeenCalledOnce();
    expect(tab.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
  });

  it.each(["confirmed logout", "session expiry"] as const)("ignores a late successful session check after %s", async (transition) => {
    const pendingUser = deferred<MockUser>();
    const tab = await renderTab("tab1");
    mock.nextUserResponse = pendingUser.promise;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(2));

    if (transition === "confirmed logout") {
      await act(async () => click(tab, "tab1-logout"));
      await waitFor(() => expect(text(tab, "tab1")).toBe("anonymous"));
    } else {
      await act(async () => window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT)));
      await waitFor(() => expect(text(tab, "tab1")).toBe("anonymous"));
    }

    pendingUser.resolve(mock.admin);
    await flush();

    expect(text(tab, "tab1")).toBe("anonymous");
    expect(tab.client.getQueryData(["auth", "me"])).toBeNull();
  });

  it("ignores a late successful session check after a same-tab account switch", async () => {
    const pendingUser = deferred<MockUser>();
    const tab = await renderTab("tab1");
    mock.nextUserResponse = pendingUser.promise;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(2));

    await act(async () => click(tab, "tab1-login-checker"));
    await waitFor(() => expect(text(tab, "tab1")).toBe("checker"));
    pendingUser.resolve(mock.admin);
    await flush();

    expect(text(tab, "tab1")).toBe("checker");
    expect(tab.client.getQueryData(["auth", "me"])).toEqual(mock.checker);
    expect(tab.client.getQueryData(STUDENT_KEY)).toBeUndefined();
  });

  it("clears protected data before applying the changed session", async () => {
    const saved = globalThis.BroadcastChannel;
    delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    let resolveCurrentUser = (_user: MockUser) => {};
    try {
      const tab1 = await renderTab("tab1");
      mock.session.current = mock.checker;
      mock.nextUserResponse = new Promise((resolve) => { resolveCurrentUser = resolve; });

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(text(tab1, "tab1")).toBe("admin");
      expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
      expect(tab1.container.querySelector('[data-testid="tab1-verification"]')?.textContent).toBe("checking");

      await act(async () => {
        resolveCurrentUser(mock.checker);
        await Promise.resolve();
      });
      await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
      await waitFor(() => expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined());
      expectNoNewSessionWithOldData("tab1", "checker");
    } finally {
      resolveCurrentUser(mock.checker);
      (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = saved;
    }
  });

  it("cancels a late response from the previous session", async () => {
    const tab1 = await renderTab("tab1");
    const tab2 = await renderTab("tab2");
    let resolveLate: ((value: string) => void) | null = null;

    await act(async () => {
      void tab1.client.fetchQuery({
        queryKey: LATE_STUDENT_KEY,
        staleTime: Infinity,
        queryFn: ({ signal }) => new Promise<string>((resolve, reject) => {
          resolveLate = resolve;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      }).catch(() => undefined);
      await Promise.resolve();
    });

    await act(async () => click(tab2, "tab2-login-checker"));
    await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
    await act(async () => {
      resolveLate?.("late-data-from-admin");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(tab1.client.getQueryData(LATE_STUDENT_KEY)).toBeUndefined();
  });
});
