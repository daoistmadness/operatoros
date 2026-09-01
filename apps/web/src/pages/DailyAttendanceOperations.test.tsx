import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DailyAttendanceOperations from "./DailyAttendanceOperations";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import * as attendanceHooks from "../hooks/useAttendanceAnalyticsQueries";
import * as dailyHooks from "../hooks/useDailyAttendanceQuery";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));
vi.mock("../hooks/useAttendanceAnalyticsQueries", () => ({ useAttendanceAnalyticsOptionsQuery: vi.fn() }));
vi.mock("../hooks/useDailyAttendanceQuery", () => ({ useDailyAttendanceQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_attendance", "enter_assigned_class_attendance"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }], class_names: [], subjects: [] };
const row = (classId: number, className: string, state: "PARTIAL" | "EMPTY_CLASS") => ({ classId, className, jenjang: "SMP", academicYearId: 1, academicYearLabel: "2026/2027", expectedStudentCount: state === "PARTIAL" ? 2 : 0, recordedStudentCount: state === "PARTIAL" ? 1 : 0, unrecordedStudentCount: state === "PARTIAL" ? 1 : 0, coverageState: state, coveragePercent: state === "PARTIAL" ? 50 : null, counts: { present: state === "PARTIAL" ? 1 : 0, late: 0, sakit: 0, izin: 0, alfa: 0, absent: 0, incomplete: 0 }, periodFinalized: false, attendanceExpectation: { status: "UNKNOWN", reason: null, source: "NONE" } });
const response = { scope: { date: "2026-08-03", academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: null, classId: null, schoolDayAuthority: "AVAILABLE" }, totals: { classes: 2, expectedStudents: 2, recordedStudents: 1, unrecordedStudents: 1, completeClasses: 0, partialClasses: 1, noRecordClasses: 0, emptyClasses: 1, expectedClasses: 0, notExpectedClasses: 0, unknownClasses: 2 }, classes: [row(1, "7A", "PARTIAL"), row(2, "7B", "EMPTY_CLASS")] };
const mocked = (value: unknown) => value as { mockReturnValue: (result: unknown) => void };

describe("DailyAttendanceOperations", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null });
    mocked(attendanceHooks.useAttendanceAnalyticsOptionsQuery).mockReturnValue({ data: { classes: [{ id: 1, name: "7A", jenjangId: 1 }, { id: 2, name: "7B", jenjangId: 1 }] }, isPending: false, error: null });
    mocked(dailyHooks.useDailyAttendanceQuery).mockReturnValue({ data: response, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("renders server coverage values and neutral wording", async () => {
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><DailyAttendanceOperations /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("Daily Attendance");
    expect(container.textContent).toContain("Recorded / expected");
    expect(container.textContent).toContain("Empty class");
    expect(container.textContent).toContain("do not establish a submission deadline");
    expect(container.querySelector('a[href="/attendance/class-entry?class_id=1&date=2026-08-03"]')?.textContent).toContain("Continue attendance");
    expect(container.querySelector('a[href="/classes/1?attendance_date_from=2026-08-03&attendance_date_to=2026-08-03"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/risk|alert|intervention/i);
  });
});
