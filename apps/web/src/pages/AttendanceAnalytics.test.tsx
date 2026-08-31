import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceAnalytics from "./AttendanceAnalytics";
import * as analyticsApi from "../api/analytics";
import * as attendanceApi from "../api/attendanceAnalytics";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("react-chartjs-2", () => ({ Bar: () => <div data-testid="attendance-chart" /> }));
vi.mock("../api/analytics", () => ({ fetchAnalyticsFilters: vi.fn() }));
vi.mock("../api/attendanceAnalytics", () => ({
  fetchAttendanceAnalyticsOptions: vi.fn(),
  fetchAttendanceClasses: vi.fn(),
  fetchAttendanceDaily: vi.fn(),
  fetchAttendanceJenjang: vi.fn(),
  fetchAttendanceOverview: vi.fn(),
  fetchAttendanceStudents: vi.fn(),
  downloadAttendanceAnalytics: vi.fn(),
}));

const auth: AuthContextValue = {
  user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_attendance"] },
  loading: false,
  authenticated: true,
  can: (capability) => capability === "view_attendance",
  login: vi.fn(), logout: vi.fn(),
};
const counts = { present: 3, late: 1, incomplete: 1, absent: 0, sakit: 1, izin: 1, alfa: 1, unrecorded: 0 };
const scope = { dateFrom: "2026-08-01", dateTo: "2026-08-31", academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: null, classId: null, totalApplicableRecords: 8 };
const overview = { scope, totalRecords: 8, students: 2, classes: 1, counts, attendanceRate: 62.5, tardinessRate: 25, unexcusedAbsenceRate: 12.5, overriddenRecords: 1, overridePercentage: 12.5, hebTotal: 20, generatedAt: "2026-08-30T00:00:00Z" };
const row = { counts, attendanceRate: 62.5, tardinessRate: 25, unexcusedAbsenceRate: 12.5 };

let container: HTMLDivElement;
let root: Root;

describe("AttendanceAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockResolvedValue({ academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [], class_names: [], subjects: [] });
    vi.mocked(attendanceApi.fetchAttendanceAnalyticsOptions).mockResolvedValue({ academicYears: [{ id: 1, label: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isDefault: true }], jenjangs: [{ id: 1, name: "SD" }], classes: [{ id: 1, name: "1A", jenjangId: 1 }] });
    vi.mocked(attendanceApi.fetchAttendanceOverview).mockResolvedValue(overview as never);
    vi.mocked(attendanceApi.fetchAttendanceClasses).mockResolvedValue({ scope, rows: [{ ...row, classId: 1, className: "1A", students: 2 }], generatedAt: overview.generatedAt } as never);
    vi.mocked(attendanceApi.fetchAttendanceJenjang).mockResolvedValue({ scope, rows: [{ ...row, jenjangId: 1, jenjang: "SD", students: 2 }], generatedAt: overview.generatedAt } as never);
    vi.mocked(attendanceApi.fetchAttendanceDaily).mockResolvedValue({ scope, rows: [{ ...row, date: "2026-08-01", records: 8 }], generatedAt: overview.generatedAt } as never);
    vi.mocked(attendanceApi.fetchAttendanceStudents).mockResolvedValue({ scope, total: 1, page: 1, pageSize: 25, rows: [{ ...row, studentId: 10, studentName: "A Student", className: "1A" }], generatedAt: overview.generatedAt } as never);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  it("renders server-computed attendance sections and filters", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={auth}><AttendanceAnalytics /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Attendance Analytics"), { timeout: 3000 });
    expect(container.textContent).toContain("Attendance Analytics");
    expect(container.textContent).toContain("62.50%");
    expect(container.textContent).toContain("By Class");
    expect(container.textContent).toContain("By Jenjang");
    expect(container.textContent).toContain("A Student");
    expect(container.querySelector("#attendance-year")).not.toBeNull();
    expect(container.querySelector('[data-testid="attendance-chart"]')).not.toBeNull();
    expect(attendanceApi.fetchAttendanceOverview).toHaveBeenCalledWith({ academic_year_id: 1, date_from: "2026-07-01", date_to: "2027-06-30", jenjang_id: null, class_id: null });
  });
});
