import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, login, logout } from "../api/auth";
import { AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { AuthProvider, useAuth } from "./AuthContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../api/auth", () => ({ getCurrentUser: vi.fn(), login: vi.fn(), logout: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const admin = { id: 1, username: "admin", role: "admin" as const };
let container: HTMLDivElement;
let root: Root;

function Probe() {
  const auth = useAuth();
  return <div><span data-testid="state">{auth.loading ? "loading" : auth.authenticated ? `${auth.user?.username}:${auth.user?.role}` : "anonymous"}</span><button onClick={() => void auth.login("admin", "secret")}>login</button><button onClick={() => void auth.logout()}>logout</button></div>;
}

async function renderProvider() {
  const client = createTestQueryClient();
  await act(async () => { root.render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
}

async function waitForText(expected: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(expected)) return;
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
  }
  expect(container.textContent).toContain(expected);
}

describe("AuthProvider", () => {
  beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("bootstraps the authenticated session once", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(admin);
    await renderProvider();
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("admin:admin");
  });

  it("settles as anonymous when no session exists", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error("unauthorized"));
    await renderProvider();
    expect(container.textContent).toContain("anonymous");
  });

  it("updates state after login and clears it after logout", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error("unauthorized"));
    vi.mocked(login).mockResolvedValue(admin);
    vi.mocked(logout).mockResolvedValue(undefined);
    await renderProvider();
    await act(async () => { (container.querySelectorAll("button")[0] as HTMLButtonElement).click(); });
    await waitForText("admin:admin");
    await act(async () => { (container.querySelectorAll("button")[1] as HTMLButtonElement).click(); });
    await waitForText("anonymous");
  });

  it("clears authenticated state on a global 401 event", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(admin);
    await renderProvider();
    await act(async () => { window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT)); await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("anonymous");
  });
});
