import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import ReportsReviews from "./ReportsReviews";

vi.mock("./MonthlyReport", () => ({ default: () => <div data-view="monthly">Monthly body</div> }));
vi.mock("./ExecutiveReports", () => ({ default: () => <div data-view="annual">Annual body</div> }));
vi.mock("./ManagementReviewStudentProfile", () => ({ default: () => <div data-view="term-review">Term body</div> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function auth(): AuthContextValue {
  return { user: { id: 1, username: "test", role: "admin", capabilities: ["view_student"] }, loading: false, authenticated: true,
    can: (capability) => capability === "view_student", login: vi.fn(), logout: vi.fn() };
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove(); root = undefined; container = undefined;
});

describe("Reports & Reviews shell", () => {
  it.each([
    ["monthly", "monthly", "Monthly"], ["annual", "annual", "Annual"], ["term-review", "term-review", "Term Review"],
  ])("renders only the %s view", async (view, child, label) => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<MemoryRouter initialEntries={[`/reports?view=${view}`]}><AuthContext.Provider value={auth()}><ReportsReviews /></AuthContext.Provider></MemoryRouter>));
    await vi.waitFor(() => expect(container?.querySelector(`[data-view="${child}"]`)).not.toBeNull());
    expect(container.querySelectorAll("[data-view]")).toHaveLength(1);
    expect(container.querySelector(`a[aria-current="page"]`)?.textContent).toBe(label);
    expect(container.querySelectorAll("nav[aria-label='Report views'] a")).toHaveLength(3);
  });
});
