// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "../test/TestRouter";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api", () => ({ default: api }));

import AttendanceReview from "./AttendanceReview";

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

async function renderReview(capabilities: string[]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: createTestQueryClient() },
      createElement(MemoryRouter, null,
        createElement(AuthContext.Provider, { value: authFor(capabilities) }, createElement(AttendanceReview)),
      ),
    ));
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  api.get.mockImplementation(async (path: string) => {
    if (path === "/api/academic-masters/academic-years") return { data: [{ id: 1, label: "2026/2027", is_default: true }] };
    if (path === "/api/review/classes") return { data: { classes: [{ id: 2, name: "Class 1" }] } };
    if (path === "/api/review/attendance") return { data: { items: [{ attendance_id: 5, student_name: "Synthetic Student", original_status: "late", effective_status: "late" }] } };
    return { data: { items: [] } };
  });
  api.post.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("attendance review permissions", () => {
  it("shows records and history to a read-only actor without exposing override controls", async () => {
    await renderReview([]);

    expect(host.textContent).toContain("Synthetic Student");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("History"))).toBe(true);
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("Override"))).toBe(false);
  });

  it("lets an actor with attendance management permission open the override form", async () => {
    await renderReview(["manage_attendance"]);

    const override = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Override"));
    expect(override).toBeDefined();
    await act(async () => override?.click());

    expect(document.body.textContent).toContain("Save Override");
    expect(api.post).not.toHaveBeenCalled();
  });
});
