import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManagementAnalytics from "./ManagementAnalytics";
import * as analyticsApi from "../api/analytics";
import * as overviewApi from "../api/managementOverview";
import * as academicApi from "../api/academicAnalytics";
import * as attendanceApi from "../api/attendanceAnalytics";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("react-chartjs-2", () => ({ Bar: () => <div data-testid="bar-chart" /> }));
vi.mock("../api/analytics", () => ({ fetchAnalyticsFilters: vi.fn() }));
vi.mock("../api/managementOverview", () => ({ fetchManagementOverview: vi.fn() }));
vi.mock("../api/academicAnalytics", () => ({ fetchAcademicAnalyticsOptions: vi.fn() }));
vi.mock("../api/attendanceAnalytics", () => ({ fetchAttendanceAnalyticsOptions: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student", "view_staff", "view_attendance"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 10, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SD", code: "SD" }], class_names: ["1A"], subjects: [] };
const overview = {
  scope: { academicYearId: 10, academicYearLabel: "2026/2027", jenjangId: null, classId: null, attendanceDateFrom: "2026-07-01", attendanceDateTo: "2027-06-30" },
  school: { students: { status: "available", activeStudents: 24, jenjangCount: 2, classCount: 4, byJenjang: [{ label: "SD", count: 24, percentage: 100 }] }, staff: { status: "available", activeStaff: 8, issueCount: 1 } },
  attendance: { status: "available", totalRecords: 100, attendanceRate: 92.5, present: 80, late: 10, alfa: 5, sakit: 3, izin: 2, overriddenRecords: 1, byJenjang: [{ label: "SD", attendanceRate: 92.5, totalRecords: 100 }] },
  academic: { status: "available", average: 84.5, students: 20, assessments: 6, participationPercentage: 88, byJenjang: [{ label: "SD", average: 84.5, students: 20 }] },
  dataQuality: { students: { status: "available", total: 24, issueCount: 2, completenessPercentage: 91.7 }, staff: { status: "available", total: 8, issueCount: 1, completenessPercentage: 87.5 } },
  links: { recapitulation: "/analytics/recapitulation", attendance: "/analytics/attendance", academic: "/analytics/academic", dataQuality: "/analytics/data-quality" },
};

let container: HTMLDivElement;
let root: Root;

async function renderPage(currentAuth = auth) {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={currentAuth}><ManagementAnalytics /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
  return container;
}

describe("ManagementAnalytics overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockResolvedValue(filters);
    vi.mocked(overviewApi.fetchManagementOverview).mockResolvedValue(overview as never);
    vi.mocked(academicApi.fetchAcademicAnalyticsOptions).mockResolvedValue({ academicYears: [], jenjangs: [], classes: [{ id: 7, name: "1A", jenjangId: 1 }], subjects: [], assessmentTypes: [] } as never);
    vi.mocked(attendanceApi.fetchAttendanceAnalyticsOptions).mockResolvedValue({ academicYears: [], jenjangs: [], classes: [] } as never);
  });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders server values and canonical drill-through links", async () => {
    const view = await renderPage();
    await vi.waitFor(() => expect(view.textContent).toContain("Management Overview"));
    expect(view.textContent).toContain("24");
    expect(view.textContent).toContain("92.5%");
    expect(view.textContent).toContain("84.5");
    expect(view.querySelector('a[href="/analytics/attendance?academic_year_id=10"]')).toBeTruthy();
    expect(view.querySelector('a[href="/analytics/academic?academic_year_id=10"]')).toBeTruthy();
    expect(overviewApi.fetchManagementOverview).toHaveBeenCalledWith({ academic_year_id: 10, jenjang_id: null, class_id: null });
  });

  it("shows section-level authorization without exposing unavailable metrics", async () => {
    vi.mocked(overviewApi.fetchManagementOverview).mockResolvedValue({ ...overview, school: { ...overview.school, staff: { status: "unavailable", reason: "unauthorized" } }, dataQuality: { ...overview.dataQuality, staff: { status: "unavailable", reason: "unauthorized" } } } as never);
    const view = await renderPage({ ...auth, user: { ...auth.user!, capabilities: ["view_student"] }, can: (capability) => capability === "view_student" });
    await vi.waitFor(() => expect(view.textContent).toContain("Management Overview"));
    expect(view.textContent).toContain("Staff snapshot is not available for this account.");
    expect(view.textContent).toContain("Staff quality is not available for this account.");
  });

  it("keeps the restricted state when the account has no analytics capability", async () => {
    const restricted = { ...auth, user: { ...auth.user!, capabilities: [] }, can: () => false };
    const view = await renderPage(restricted);
    expect(view.textContent).toContain("Access restricted");
    expect(overviewApi.fetchManagementOverview).not.toHaveBeenCalled();
  });
});
