import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentInsights, { StudentTrendsCompatibilityRedirect } from "./StudentInsights";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import * as attendanceHooks from "../hooks/useAttendanceAnalyticsQueries";
import * as academicHooks from "../hooks/useAcademicAnalyticsQueries";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn(), useStudentTrendInsightsQuery: vi.fn(), useStudentIndicatorInsightsQuery: vi.fn() }));
vi.mock("../hooks/useAttendanceAnalyticsQueries", () => ({ useAttendanceAnalyticsOptionsQuery: vi.fn() }));
vi.mock("../hooks/useAcademicAnalyticsQueries", () => ({ useAcademicAnalyticsOptionsQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student", "view_attendance"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 2, name: "SMP" }], class_names: [], subjects: [] };
const trendResponse = {
  scope: { academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: 2, classId: 7 },
  window: { kind: "term" as const, anchorDate: "2026-03-15", currentStart: "2026-02-16", currentEnd: "2026-03-15", previousStart: "2026-01-19", previousEnd: "2026-02-15", currentEligibleDays: 28, previousEligibleDays: 28, comparison: "comparable" as const },
  totalStudents: 0, page: 1, pageSize: 25, rows: [], limitations: [],
};
const mocked = (value: unknown) => value as { mockReturnValue: (result: unknown) => void };
let container: HTMLDivElement;
let root: Root;

function Location() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}</output>;
}

describe("Student Insights shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() });
    mocked(analyticsHooks.useStudentTrendInsightsQuery).mockReturnValue({ data: trendResponse, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
    mocked(analyticsHooks.useStudentIndicatorInsightsQuery).mockReturnValue({ data: null, isPending: true, isFetching: false, error: null, refetch: vi.fn() });
    mocked(attendanceHooks.useAttendanceAnalyticsOptionsQuery).mockReturnValue({ data: { classes: [{ id: 7, name: "7A", jenjangId: 2 }], jenjangs: [], academicYears: [] }, isPending: false, error: null, refetch: vi.fn() });
    mocked(academicHooks.useAcademicAnalyticsOptionsQuery).mockReturnValue({ data: { classes: [{ id: 7, name: "7A", jenjangId: 2 }], jenjangs: [] }, isPending: false, error: null, refetch: vi.fn() });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("switches views while preserving shared filters and student deep-link scope", async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/analytics/student-insights?academic_year_id=1&jenjang_id=2&class_id=7&window=term&search=Ada&student_id=student-a&view=trends"]}><AuthContext.Provider value={auth}><StudentInsights /><Location /></AuthContext.Provider></MemoryRouter>));
    expect(container.querySelector("h1")?.textContent).toBe("Student Insights");
    expect((container.querySelector('[aria-label="Academic year"]') as HTMLSelectElement).value).toBe("1");
    expect((container.querySelector('[aria-label="Jenjang"]') as HTMLSelectElement).value).toBe("2");
    expect((container.querySelector('[aria-label="Class"]') as HTMLSelectElement).value).toBe("7");
    expect((container.querySelector('[aria-label="Comparison window"]') as HTMLSelectElement).value).toBe("term");
    expect((container.querySelector('[aria-label="Student search"]') as HTMLInputElement).value).toBe("Ada");
    const indicatorTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Indicators") as HTMLButtonElement;
    await act(async () => { indicatorTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect((container.querySelector('[aria-label="Academic year"]') as HTMLSelectElement).value).toBe("1");
    expect((container.querySelector('[aria-label="Class"]') as HTMLSelectElement).value).toBe("7");
    expect((container.querySelector('[aria-label="Comparison window"]') as HTMLSelectElement).value).toBe("term");
    expect((container.querySelector('[aria-label="Student search"]') as HTMLInputElement).value).toBe("Ada");
    expect(container.querySelector('[aria-label="Current location"]')?.textContent).toContain("/analytics/student-insights?academic_year_id=1&jenjang_id=2&class_id=7&window=term&search=Ada&student_id=student-a&view=indicators");
    expect(analyticsHooks.useAnalyticsFiltersQuery).toHaveBeenCalled();
    expect(attendanceHooks.useAttendanceAnalyticsOptionsQuery).toHaveBeenCalled();
    expect(academicHooks.useAcademicAnalyticsOptionsQuery).toHaveBeenCalled();
  });

  it("preserves old trend bookmarks and adds the Trends view", async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/analytics/trends?academic_year_id=1&class_id=7&window=term&student_id=student-a"]}><AuthContext.Provider value={auth}><StudentTrendsCompatibilityRedirect /><Location /></AuthContext.Provider></MemoryRouter>));
    expect(container.querySelector('[aria-label="Current location"]')?.textContent).toBe("/analytics/student-insights?academic_year_id=1&class_id=7&window=term&student_id=student-a&view=trends");
  });
});
