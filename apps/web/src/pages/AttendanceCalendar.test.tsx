import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceCalendar from "./AttendanceCalendar";
import * as gradesApi from "../api/grades";
import * as calendarApi from "../api/attendanceCalendar";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../api/grades", () => ({ fetchAcademicYears: vi.fn() }));
vi.mock("../api/attendanceCalendar", () => ({ fetchAttendanceCalendar: vi.fn(), saveAttendanceCalendarWeekday: vi.fn(), saveAttendanceCalendarException: vi.fn(), deleteAttendanceCalendarException: vi.fn(), saveAttendanceSubmissionDeadline: vi.fn(), previewAttendanceCalendarPeriod: vi.fn(), applyAttendanceCalendarPeriod: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: [] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const overview = {
  scope: { academicYearId: 1, academicYearLabel: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30" },
  jenjangs: [{ id: 1, name: "SMP", weekdays: Array.from({ length: 7 }, (_, weekday) => ({ weekday, expectation: weekday === 1 ? "EXPECTED" : null })), exceptions: [{ id: 5, date: "2026-08-17", expectation: "NOT_EXPECTED", reason: "HOLIDAY" }], submissionDeadlineLocalTime: "08:00" }],
};

let container: HTMLDivElement;
let root: Root;

describe("AttendanceCalendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gradesApi.fetchAcademicYears).mockResolvedValue([{ id: 1, label: "2026/2027", is_default: true }] as never);
    vi.mocked(calendarApi.fetchAttendanceCalendar).mockResolvedValue(overview as never);
    vi.mocked(calendarApi.saveAttendanceCalendarWeekday).mockResolvedValue(undefined);
    vi.mocked(calendarApi.saveAttendanceCalendarException).mockResolvedValue(undefined);
    vi.mocked(calendarApi.deleteAttendanceCalendarException).mockResolvedValue(undefined);
    vi.mocked(calendarApi.previewAttendanceCalendarPeriod).mockResolvedValue({} as never);
    vi.mocked(calendarApi.applyAttendanceCalendarPeriod).mockResolvedValue({} as never);
  });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders neutral server-provided calendar rules and exceptions", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={auth}><AttendanceCalendar /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Attendance Calendar"), { timeout: 3000 });
    expect(container.textContent).toContain("Not configured resolves to UNKNOWN");
    expect(container.textContent).toContain("Holiday");
    expect(container.textContent).toContain("Submission deadline");
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("keeps calendar configuration read-only for attendance viewers", async () => {
    const viewer: AuthContextValue = { ...auth, user: { ...auth.user!, role: "staff" }, can: (capability) => capability === "view_attendance" };
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={viewer}><AttendanceCalendar /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Attendance Calendar"), { timeout: 3000 });
    expect((container.querySelector("#weekday-1") as HTMLSelectElement).disabled).toBe(true);
    expect((container.querySelector("#submission-deadline") as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector("button[type=submit]:not([disabled])")).toBeNull();
    expect(container.textContent).toContain("read-only");
  });

  it("previews a range and requires explicit confirmation before applying it", async () => {
    vi.mocked(calendarApi.previewAttendanceCalendarPeriod).mockResolvedValue({
      request: { academic_year_id: 1, jenjang_id: 1, start_date: "2026-08-07", end_date: "2026-08-09", expectation: "NOT_EXPECTED", reason: "SCHOOL_BREAK" },
      summary: { totalDates: 3, creates: 2, noops: 1, conflicts: 0 },
      rows: ["2026-08-07", "2026-08-08", "2026-08-09"].map((date, index) => ({ date, classification: index === 1 ? "NOOP_SAME" : "CREATE", existingExpectation: index === 1 ? "NOT_EXPECTED" : null, existingReason: index === 1 ? "SCHOOL_BREAK" : null })),
      previewDigest: "a".repeat(64),
    } as never);
    vi.mocked(calendarApi.applyAttendanceCalendarPeriod).mockResolvedValue({ status: "applied", summary: { created: 2, noops: 1, conflicts: 0 } } as never);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={auth}><AttendanceCalendar /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Attendance Calendar"), { timeout: 3000 });
    const start = container.querySelector("#period-start") as HTMLInputElement;
    const end = container.querySelector("#period-end") as HTMLInputElement;
    await act(async () => { start.value = "2026-08-07"; start.dispatchEvent(new Event("input", { bubbles: true })); end.value = "2026-08-09"; end.dispatchEvent(new Event("input", { bubbles: true })); container.querySelector("#period-start")?.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(calendarApi.previewAttendanceCalendarPeriod).toHaveBeenCalled());
    expect(container.textContent).toContain("Period preview");
    const applyButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create 2 date exceptions")) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    await act(async () => { (container.querySelector("#period-confirmation") as HTMLInputElement).click(); });
    expect(applyButton.disabled).toBe(false);
    await act(async () => { applyButton.click(); });
    await vi.waitFor(() => expect(calendarApi.applyAttendanceCalendarPeriod).toHaveBeenCalled());
    expect(container.textContent).toContain("Period applied: 2 created");
  });
});
