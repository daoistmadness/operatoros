import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Student360Overview } from "./Student360Overview";

const overview = {
  student: { id: "student-a", fullName: "Alya", preferredName: null, status: "active", gender: "F", religion: null, birthDate: "2013-01-01", ageYears: 13 },
  enrollment: { id: 1, academicYearId: 1, academicYear: "2026/2027", academicYearStart: "2026-01-01", academicYearEnd: "2026-03-31", jenjangId: 1, jenjang: "SMP", classId: 1, className: "7A", program: "Regular", grade: "7" },
  attendance: { status: "available", period: { start: "2026-01-01", end: "2026-03-31", label: "2026/2027" }, counts: { present: 2, late: 0, incomplete: 0, absent: 0, sakit: 0, izin: 0, alfa: 1, unrecorded: 0 }, attendanceRate: 66.67, tardinessRate: 0, alfaRate: 33.33, recent: [{ date: "2026-03-10", status: "on-time", checkIn: "07:00", checkOut: "14:00", corrected: false }] },
  academic: { status: "available", average: 75, participation: 100, scoredResults: 2, expectedResults: 2, temporalTrend: "unavailable_no_time_axis" },
  trends: { status: "available", window: { kind: "rolling_4w", anchorDate: "2026-03-31", currentStart: "2026-03-04", currentEnd: "2026-03-31", previousStart: "2026-02-04", previousEnd: "2026-03-03", currentEligibleDays: 28, previousEligibleDays: 28, comparison: "comparable" }, attendance: { unit: "percent", current: 66.67, previous: 50, delta: 16.67, direction: "up", currentSampleSize: 3, previousSampleSize: 2 }, tardiness: null, alfa: null },
  dataCompleteness: { status: "available", issues: [{ field: "religion", type: "MISSING_OPTIONAL_FIELD", label: "Missing religion" }] },
  availability: { attendance: "available", academic: "available", trendComparison: "available" },
  links: { attendanceDetails: "/attendance/students/1", attendanceAnalytics: "/analytics/attendance?academic_year_id=1", attendanceExport: "/api/student-masters/student-a/attendance-history/export-excel", academicAnalytics: "/analytics/academic?academic_year_id=1", trends: "/analytics/trends?academic_year_id=1", indicators: "/analytics/indicators?academic_year_id=1", dataQuality: "/analytics/data-quality?academic_year_id=1" },
} as never;

describe("Student360Overview", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); });

  it("renders canonical sections, neutral insufficient states, and drill-through links", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root?.render(<MemoryRouter><Student360Overview overview={overview} exporting={false} exportError={null} onExport={() => undefined} /></MemoryRouter>); });
    expect(container.textContent).toContain("Current student context");
    expect(container.textContent).toContain("Attendance");
    expect(container.textContent).toContain("Academic");
    expect(container.textContent).toContain("Attendance trends");
    expect(container.textContent).toContain("Data completeness");
    expect(container.textContent).toContain("Insufficient comparison data");
    expect(container.querySelector('a[href="/attendance/students/1"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/at.?risk|high risk|medium risk|low risk|risk score|alert|intervention|prediction/i);
  });
});
