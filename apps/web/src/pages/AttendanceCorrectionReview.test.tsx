import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceCorrectionReview from "./AttendanceCorrectionReview";
import * as classesApi from "../api/teacherClassAssignments";
import * as reviewHook from "../hooks/useAttendanceCorrectionReviewQuery";
import * as analyticsHook from "../hooks/useAnalyticsQueries";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../api/teacherClassAssignments", () => ({ fetchAssignedClasses: vi.fn() }));
vi.mock("../hooks/useAttendanceCorrectionReviewQuery", () => ({ useAttendanceCorrectionReviewQuery: vi.fn() }));
vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_attendance_corrections", "manage_attendance"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const response = {
  scope: { academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: null, classId: null, dateFrom: "2026-07-01", dateTo: "2027-06-30" },
  summary: { corrections: 1 }, total: 1, page: 1, pageSize: 25,
  items: [{ attendanceId: 7, studentId: 11, studentMasterId: "master-11", studentName: "Alpha Student", classId: 3, className: "7A", jenjang: "SMP", academicYearId: 1, date: "2026-08-04", baseStatus: "late", effectiveStatus: "on-time", correction: { id: 4, note: "Device missed scan", reviewedBy: "Admin", reviewedAt: "2026-08-04T10:00:00Z", overrideCheckIn: null, overrideCheckOut: null, active: true }, canEdit: true, links: { correctionReview: "/attendance/override-review?academic_year_id=1", editCorrection: "/attendance-review?academic_year_id=1", student360: "/students/master-11", class360: "/classes/3", dailyAttendance: "/attendance/daily?date=2026-08-04" } }],
};

let container: HTMLDivElement;
let root: Root;

describe("AttendanceCorrectionReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classesApi.fetchAssignedClasses).mockResolvedValue([{ id: 3, class_name: "7A", academic_year_id: 1 }] as never);
    vi.mocked(analyticsHook.useAnalyticsFiltersQuery).mockReturnValue({ data: { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }] }, isPending: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(reviewHook.useAttendanceCorrectionReviewQuery).mockReturnValue({ data: response, isPending: false, error: null, refetch: vi.fn() } as never);
  });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders canonical original/effective status and controlled context links", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={auth}><AttendanceCorrectionReview /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Correction Review"));
    expect(container.textContent).toContain("Original");
    expect(container.textContent).toContain("Effective");
    expect(container.textContent).toContain("Device missed scan");
    expect(container.querySelector('a[href="/attendance-review?academic_year_id=1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/students/master-11"]')).not.toBeNull();
    expect(container.querySelector('a[href="/classes/3"]')).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("keeps correction mutation actions out of a view-only response", async () => {
    vi.mocked(reviewHook.useAttendanceCorrectionReviewQuery).mockReturnValue({ data: { ...response, items: [{ ...response.items[0], canEdit: false, links: { ...response.items[0].links, editCorrection: null } }] }, isPending: false, error: null, refetch: vi.fn() } as never);
    const viewer: AuthContextValue = { ...auth, user: { ...auth.user!, role: "staff", capabilities: ["view_attendance_corrections"] }, can: (capability) => capability === "view_attendance_corrections" };
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={viewer}><AttendanceCorrectionReview /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("View context only"));
    expect(container.textContent).not.toContain("Edit correction");
  });
});
