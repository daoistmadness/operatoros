import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentTrendInsights from "./StudentTrendInsights";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import * as attendanceHooks from "../hooks/useAttendanceAnalyticsQueries";
import * as academicHooks from "../hooks/useAcademicAnalyticsQueries";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn(), useStudentTrendInsightsQuery: vi.fn() }));
vi.mock("../hooks/useAttendanceAnalyticsQueries", () => ({ useAttendanceAnalyticsOptionsQuery: vi.fn() }));
vi.mock("../hooks/useAcademicAnalyticsQueries", () => ({ useAcademicAnalyticsOptionsQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student", "view_attendance"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }], class_names: [], subjects: [] };
const response = {
  scope: { academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: null, classId: null },
  window: { kind: "rolling_4w", anchorDate: "2026-03-15", currentStart: "2026-02-16", currentEnd: "2026-03-15", previousStart: "2026-01-19", previousEnd: "2026-02-15", currentEligibleDays: 28, previousEligibleDays: 28, comparison: "comparable" },
  totalStudents: 1, page: 1, pageSize: 25,
  rows: [{ studentId: "student-a", studentName: "Alya", className: "7A", jenjang: "SMP", attendance: { unit: "percent", current: 66.67, previous: 50, delta: 16.67, direction: "up", currentSampleSize: 3, previousSampleSize: 2 }, academic: { unit: "score", current: null, previous: null, delta: null, direction: "insufficient_data", currentSampleSize: 0, previousSampleSize: 0 }, tardiness: null, alfa: null }],
  limitations: [],
};

let container: HTMLDivElement;
let root: Root;
const mocked = (value: unknown) => value as { mockReturnValue: (result: unknown) => void };

describe("StudentTrendInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null });
    mocked(analyticsHooks.useStudentTrendInsightsQuery).mockReturnValue({ data: response, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
    mocked(attendanceHooks.useAttendanceAnalyticsOptionsQuery).mockReturnValue({ data: { classes: [{ id: 1, name: "7A", jenjangId: 1 }], jenjangs: [], academicYears: [] }, isPending: false, error: null });
    mocked(academicHooks.useAcademicAnalyticsOptionsQuery).mockReturnValue({ data: { classes: [], jenjangs: [] }, isPending: false, error: null });
  });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders server values and neutral insufficient-data text", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><StudentTrendInsights /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("Student Trends");
    expect(container.textContent).toContain("50.00% → 66.67% (+16.67 pp)");
    expect(container.textContent).toContain("Insufficient comparison data");
    expect(container.textContent).not.toMatch(/at.?risk|alert|intervention|warning severity/i);
  });
});
