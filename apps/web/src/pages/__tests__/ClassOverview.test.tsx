import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/query/queryClient";
import ClassOverview from "../ClassOverview";

const data = {
  class: { id: 7, name: "7A", jenjang: "SMP", grade: "Grade 7", academicYearId: 1, academicYearLabel: "2026/2027", active: true },
  scope: { academicYearId: 1, academicYearLabel: "2026/2027", term: null, attendanceDateFrom: "2026-07-01", attendanceDateTo: "2027-06-30" },
  roster: { total: 1, rows: [{ studentId: "student-1", studentName: "Student One", enrollmentStatus: "ACTIVE", dataQualityIssueCount: 1, student360Link: "/students/student-1" }] },
  attendance: { status: "available" as const, totalRecords: 2, attendanceRate: 100, tardinessRate: 0, unexcusedAbsenceRate: 0, counts: { present: 2, late: 0, incomplete: 0, absent: 0, sakit: 0, izin: 0, alfa: 0, unrecorded: 0 }, overriddenRecords: 1 },
  academic: { status: "available" as const, average: 88, students: 1, assessments: 1, participationPercentage: 100, term: null, periodStatus: "mixed" as const, periodNote: "All-period results may include legacy scores with unknown period attribution." },
  dataQuality: { status: "available" as const, totalStudents: 1, cleanRecords: 0, recordsWithRequiredIssues: 0, recordsWithOptionalIssues: 1 },
  links: { attendance: "/analytics/attendance?class_id=7", academic: "/analytics/academic?class_id=7", dataQuality: "/analytics/data-quality?class_id=7" },
};

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("../../hooks/useClassOverviewQuery", () => ({ useClassOverviewQuery: () => ({ isPending: false, error: null, data, refetch: vi.fn() }) }));

function renderPage() {
  return renderToStaticMarkup(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter initialEntries={["/classes/7"]}><Routes><Route path="/classes/:id" element={<ClassOverview />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("ClassOverview", () => {
  it("renders canonical class sections and student drill-through", () => {
    const html = renderPage();
    expect(html).toContain("7A");
    expect(html).toContain("Student One");
    expect(html).toContain("View Attendance Analytics");
    expect(html).toContain("View Academic Analytics");
    expect(html).toContain("View Data Quality");
    expect(html).toContain("unknown period attribution");
    expect(html).not.toMatch(/AT_RISK|High Risk|intervention/i);
  });
});
