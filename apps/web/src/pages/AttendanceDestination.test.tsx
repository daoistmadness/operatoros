import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import AttendanceDestination from "./AttendanceDestination";

vi.mock("./AttendanceAnalytics", () => ({ default: () => <div data-view="overview">Overview content</div> }));
vi.mock("./AttendanceReport", () => ({ default: () => <div data-view="report">Report content</div> }));
vi.mock("./RekapAbsensi", () => ({ default: () => <div data-view="recap">Recap content</div> }));
vi.mock("./TardinessReport", () => ({ default: () => <div data-view="tardiness">Tardiness content</div> }));

const admin: AuthContextValue = {
  user: { id: 1, username: "admin", role: "admin", capabilities: [] },
  loading: false,
  authenticated: true,
  can: () => true,
  login: vi.fn(),
  logout: vi.fn(),
};

describe("AttendanceDestination", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("renders only the selected view and preserves compatible URL filters when switching", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <MemoryRouter initialEntries={["/analytics/attendance?view=recap&academic_year_id=7&class_id=12"]}>
        <AuthContext.Provider value={admin}><AttendanceDestination /></AuthContext.Provider>
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container?.querySelector('[data-view="recap"]')).not.toBeNull());
    expect(container.querySelectorAll("[data-view]")).toHaveLength(1);
    const reportTab = container.querySelector('a[role="tab"][href*="view=report"]') as HTMLAnchorElement;
    expect(reportTab.href).toContain("academic_year_id=7");
    expect(reportTab.href).toContain("class_id=12");
    await act(async () => reportTab.click());
    await vi.waitFor(() => expect(container?.querySelector('[data-view="report"]')).not.toBeNull());
    expect(container.querySelectorAll("[data-view]")).toHaveLength(1);
    expect(container.querySelector('a[role="tab"][aria-selected="true"]')?.textContent).toContain("Report");
    expect(container.querySelector('a[href*="view=report"]')?.getAttribute("href")).toContain("academic_year_id=7");
  });
});
