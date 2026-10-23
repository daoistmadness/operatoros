import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { createTestQueryClient } from "../lib/query/queryClient";

const mock = vi.hoisted(() => {
  const admin = { id: 1, username: "admin", role: "admin" as const, capabilities: ["view_student"] };
  const checker = { id: 2, username: "checker", role: "admin" as const, capabilities: ["view_student"] };
  return { admin, checker, session: { current: null as typeof admin | null } };
});

vi.mock("../api/auth", () => ({
  getCurrentUser: vi.fn(async () => {
    if (!mock.session.current) throw new Error("unauthorized");
    return mock.session.current;
  }),
  login: vi.fn(async (username: string) => {
    mock.session.current = username === "checker" ? mock.checker : mock.admin;
    return mock.session.current;
  }),
  logout: vi.fn(async () => {
    mock.session.current = null;
  }),
}));

const STUDENT_KEY = ["students", "list", "synthetic"] as const;
const LATE_STUDENT_KEY = ["students", "late", "synthetic"] as const;

type Tab = { client: QueryClient; container: HTMLDivElement; root: Root };
type Snapshot = { username: string | null; hasStudent: boolean };

const snapshots: Record<string, Snapshot[]> = {};
const containers: HTMLDivElement[] = [];
const roots: Root[] = [];

function TabProbe({ id }: { id: string }) {
  const auth = useAuth();
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
      <button data-testid={`${id}-logout`} onClick={() => void auth.logout()}>logout</button>
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
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(text(tab1, "tab1")).toBe("checker"));
    await waitFor(() => expect(tab1.container.querySelector('[data-testid="tab1-student"]')?.textContent).toBe("empty"));

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

  it("keeps the cached data when focus revalidation finds the same session", async () => {
    const tab1 = await renderTab("tab1");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(text(tab1, "tab1")).toBe("admin");
    expect(tab1.client.getQueryData(STUDENT_KEY)).toBe("student-of-tab1");
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
