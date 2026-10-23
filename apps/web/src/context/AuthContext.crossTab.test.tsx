import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { AUTH_UNAUTHORIZED_EVENT, apiRequest } from "../lib/api/client";
import { createTestQueryClient } from "../lib/query/queryClient";

const mock = vi.hoisted(() => {
  const admin = { id: 1, username: "admin", role: "admin" as const, capabilities: ["view_student"] };
  const checker = { id: 2, username: "checker", role: "admin" as const, capabilities: ["view_student"] };
  return { admin, checker, session: { current: null as typeof admin | null }, nextUserResponse: null as Promise<typeof admin> | null, logoutError: null as Error | null };
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

const STUDENT_KEY = ["students", "list", "synthetic"] as const;
const LATE_STUDENT_KEY = ["students", "late", "synthetic"] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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
      <span data-testid={`${id}-student`}>{student.data ?? "empty"}</span>
      <button data-testid={`${id}-login-checker`} onClick={() => void auth.login("checker", "secret")}>login checker</button>
      <button data-testid={`${id}-logout`} onClick={() => { setLogoutError(""); void auth.logout().catch(() => setLogoutError("logout failed")); }}>logout</button>
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

  it("revalidates on visibility change when a cross-tab signal was missed", async () => {
    const tab1 = await renderTab("tab1");
    await renderTab("tab2");

    // Simulate a suspended tab that missed a change signal.
    mock.session.current = mock.checker;
    let resolveCurrentUser = (_user: typeof mock.checker) => {};
    mock.nextUserResponse = new Promise((resolve) => { resolveCurrentUser = resolve; });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(text(tab1, "tab1")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

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

  it("keeps the session and clears protected cache while focus revalidation runs", async () => {
    const tab1 = await renderTab("tab1");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(text(tab1, "tab1")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
    expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty");
  });

  it("clears protected data before focus revalidation resolves a changed session", async () => {
    const saved = globalThis.BroadcastChannel;
    delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    let resolveCurrentUser = (_user: typeof mock.checker) => {};
    try {
      const tab1 = await renderTab("tab1");
      mock.session.current = mock.checker;
      mock.nextUserResponse = new Promise((resolve) => { resolveCurrentUser = resolve; });

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(text(tab1, "tab1")).toBe("admin");
      expect(tab1.client.getQueryData(STUDENT_KEY)).toBeUndefined();
      await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

      await act(async () => {
        resolveCurrentUser(mock.checker);
        await Promise.resolve();
      });
      await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
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
