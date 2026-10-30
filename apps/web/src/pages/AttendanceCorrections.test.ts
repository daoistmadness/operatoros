// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api", () => ({ default: api }));

import AttendanceCorrections from "./AttendanceCorrections";

let host: HTMLDivElement;
let root: Root;

function authFor(capabilities: string[]): AuthContextValue {
  return {
    user: { id: 1, username: "Reviewer", role: "admin", capabilities },
    loading: false,
    authenticated: true,
    can: (capability) => capabilities.includes(capability),
    login: vi.fn(),
    logout: vi.fn(),
  };
}

async function renderCorrectionQueue(capabilities: string[]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const queryClient = createTestQueryClient();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(AuthContext.Provider, { value: authFor(capabilities) }, createElement(AttendanceCorrections)),
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  api.get.mockImplementation(async (path: string) => ({
    data: path === "/api/attendance-corrections"
      ? [{ id: 17, state: "SUBMITTED", requester: "Teacher A", original_snapshot: { status: "late" }, proposed_status: "on-time", reason_code: "SCAN_REVIEW", explanation: "Verified against the class register", audit: [] }]
      : { status: "OPEN", version: 3, audit: [] },
  }));
  api.post.mockResolvedValue({ data: { id: 18 } });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("attendance correction permissions", () => {
  it("hides request and approval controls from an actor without those capabilities", async () => {
    await renderCorrectionQueue([]);

    expect(host.textContent).toContain("Request #17");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("Approve"))).toBe(false);
    expect(host.textContent).not.toContain("Create and submit");
  });

  it("allows an authorized reviewer to approve a submitted request", async () => {
    await renderCorrectionQueue(["request_attendance_correction", "approve_attendance_correction"]);

    const approve = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Approve"));
    expect(approve).toBeDefined();
    expect(host.textContent).toContain("Create and submit");

    await act(async () => {
      approve?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.post).toHaveBeenCalledWith("/api/attendance-corrections/17/approve", { confirmation: "APPROVE_ATTENDANCE_CORRECTION" });
  });
});
