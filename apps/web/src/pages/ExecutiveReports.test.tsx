import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutiveReport, ReportFiltersResponse } from "../api/reports";
import ExecutiveReports from "./ExecutiveReports";

const mocks = vi.hoisted(() => ({ report: null as unknown, refetch: vi.fn() }));
vi.mock("../hooks/useReportQueries", () => ({
  useReportFilters: () => ({ data: { default_academic_year_id: 2, academic_years: [{ id: 2, name: "2025/2026", start_date: "2025-07-01", end_date: "2026-06-30", is_default: true }], months: [], scopes: [{ value: "combined", label: "Combined" }], classes: [], class_options: [], subjects: [] } as ReportFiltersResponse, isPending: false, error: null, refetch: vi.fn() }),
  useAnnualReport: (query: unknown) => ({ data: query ? mocks.report : undefined, isPending: false, isFetching: false, error: null, refetch: mocks.refetch }),
}));
vi.mock("../api/reports", () => ({ downloadReportBlob: vi.fn(), exportAnnualReport: vi.fn() }));
vi.mock("react-chartjs-2", () => ({ Line: () => <div data-chart="annual-trends" /> }));
vi.mock("chart.js", () => ({ Chart: { register: vi.fn() }, CategoryScale: {}, LinearScale: {}, LineElement: {}, PointElement: {}, Tooltip: {}, Legend: {} }));

const report = {
  meta: { report_type: "annual", scope: "combined", academic_year: { id: 2, name: "2025/2026" }, period: { start: "2025-07-01", end: "2026-06-30" }, generated_at: "2026-06-30T00:00:00Z" },
  report_period: { selected_month: "", academic_year_id: 2, academic_year_label: "2025/2026", sections: { attendance: { basis: "attendance_basis_resolver_by_class_month", month_bound: false, label: "Academic Year 2025/2026" }, population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: "Academic Year 2025/2026" }, academics: { basis: "academic_year_records_without_assessment_dates", month_bound: false, label: "Academic Year Records 2025/2026" } } },
  executive_summary: { total_students: 2, attendance_rate: 100, late_rate: 50, late_event_rate: 10, late_minutes: 5, below_kkm_count: 0, data_completeness_rate: null },
  student_distribution: { by_level: [], by_class: [], by_gender: [], by_religion: [], by_domicile: [] },
  attendance_summary: { present: 20, sakit: 0, izin: 0, alfa: 0, incomplete: 0, late_days: 2, late_minutes: 5, attendance_rate: 100, coverage_rate: 100, expected_student_days: 20, recorded_student_days: 20, unrecorded_student_days: 0, late_event_rate: 10, late_among_present: 50, lateness_availability: "AVAILABLE", lateness_coverage_rate: 100, late_unknown_duration_events: 0, basis_counts: { observed: 2, declared: 1, not_reported: 1 }, conflict_count: 1 },
  attendance_by_level: [{ level: "Primary", present: 20, sakit: 0, izin: 0, alfa: 0, incomplete: 0, attendance_denominator: 20, attendance_rate: 100, recorded_student_days: 20, unrecorded_student_days: 0, coverage_rate: 100, observed_class_months: 2, declared_class_months: 1, not_reported_class_months: 1, late_events: 2, late_event_rate: 10, lateness_availability: "AVAILABLE", lateness_coverage_rate: 100, late_minutes: 5, unknown_duration_events: 0, conflict_count: 1 }],
  academic_summary: { availability: false, reason: "No academic rows", sumatif_average: null, formatif_average: null, below_kkm_count: 0, by_subject: [] },
  trends: [{ month: "2025-07", label: "July 2025", present: 20, sakit: 0, izin: 0, alfa: 0, incomplete: 0, attendance_denominator: 20, attendance_rate: 100, recorded_student_days: 20, unrecorded_student_days: 0, coverage_rate: 100, basis_counts: { observed: 2, declared: 1, not_reported: 1 }, conflict_count: 1, late_days: 2, late_event_rate: 10, lateness_availability: "AVAILABLE", lateness_coverage_rate: 100, late_minutes: 5, unknown_duration_events: 0, late_rate: 50, sumatif_average: null, formatif_average: null, below_kkm_count: 0 }],
  comparisons: { highest_attendance_month: null, lowest_attendance_month: null, highest_attendance_level: null, lowest_attendance_level: null },
  data_quality: { not_reported_class_months: 1, partial_observed_class_months: 0, unresolved_conflicts: 1, empty_grade_cells: 0, unmapped_levels: [], warnings: ["Annual attendance rates and coverage summarize OBSERVED class-months."] },
} as unknown as ExecutiveReport;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; container = undefined; mocks.report = null; vi.clearAllMocks(); });

describe("Annual report view", () => {
  it("keeps its Academic Year scope explicit and shows basis and coverage", async () => {
    mocks.report = report;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<MemoryRouter><ExecutiveReports /></MemoryRouter>));
    await vi.waitFor(() => expect(container?.querySelector("#annual-report-year")?.textContent).toContain("2025/2026"));
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Generate Report"));
    await act(async () => button?.click());
    await vi.waitFor(() => expect(container?.textContent).toContain("Academic-Year Attendance"));
    expect(container.textContent).toContain("Academic Year 2025/2026");
    expect(container.textContent).toContain("Observed Class-Months");
    expect(container.textContent).toContain("Not Reported");
    expect(container.textContent).toContain("Coverage");
    expect(container.querySelectorAll("[data-chart='annual-trends']")).toHaveLength(1);
  });
});
