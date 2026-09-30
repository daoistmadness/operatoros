import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonthlyReportResponse, ReportFiltersResponse } from "../api/reports";
import MonthlyReport from "./MonthlyReport";

const mocks = vi.hoisted(() => ({ report: null as unknown, refetch: vi.fn() }));
vi.mock("../hooks/useReportQueries", () => ({
  useReportFilters: () => ({ data: {
    default_academic_year_id: 2,
    academic_years: [{ id: 2, name: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30", is_default: true }],
    months: [{ value: "2026-08", label: "August 2026" }, { value: "2026-09", label: "September 2026" }],
    scopes: [{ value: "combined", label: "Combined" }, { value: "primary", label: "Primary" }],
    classes: ["Alpha", "Beta", "Gamma"], class_options: [], subjects: [],
  } as ReportFiltersResponse, isPending: false, error: null, refetch: vi.fn() }),
  useMonthlyReport: (query: unknown) => ({ data: query ? mocks.report : undefined, isPending: false, isFetching: false, error: null, refetch: mocks.refetch }),
}));
vi.mock("../api/reports", () => ({ downloadReportBlob: vi.fn(), exportMonthlyReport: vi.fn() }));

const report = {
  meta: { report_type: "monthly", scope: "combined", academic_year: { id: 2, name: "2026/2027" }, period: { start: "2026-08-01", end: "2026-08-31" }, generated_at: "2026-09-30T00:00:00Z" },
  report_period: { selected_month: "2026-08", academic_year_id: 2, academic_year_label: "2026/2027", sections: {
    attendance: { basis: "attendance_basis_resolver_by_class", month_bound: true, label: "August 2026" },
    population: { basis: "academic_year_enrollment_snapshot", month_bound: false, label: "Academic Year 2026/2027" },
    academics: { basis: "academic_year_records_without_assessment_dates", month_bound: false, label: "Academic Year Records 2026/2027 (not month-bound)" },
  } },
  population: { total_students: 12, total_classes: 3 },
  attendance: { classes: [
    { class_id: 1, class_name: "Alpha", jenjang: "Primary", basis: "OBSERVED", expected_student_days: 10, recorded_student_days: 8, hadir_student_days: 7, presumed_hadir_student_days: null, sakit_student_days: 1, izin_student_days: 0, alfa_student_days: 0, unrecorded_student_days: 2, other_status_student_days: 0, attendance_rate: 70, coverage_rate: 80, lateness: { availability: "AVAILABLE", late_events: 1, late_event_rate: 10, late_minutes: 5, unknown_duration_events: 0 }, conflict: { class_id: 1, class_name: "Alpha", month: "2026-08", canonical_non_hadir_student_days: 2, declared_absence_student_days: 1, delta_student_days: -1, reason_code: "ABSENCE_TOTAL_MISMATCH" } },
    { class_id: 2, class_name: "Beta", jenjang: "Primary", basis: "DECLARED", expected_student_days: 10, recorded_student_days: null, hadir_student_days: null, presumed_hadir_student_days: 8, sakit_student_days: 1, izin_student_days: 1, alfa_student_days: 0, unrecorded_student_days: null, other_status_student_days: null, attendance_rate: null, coverage_rate: null, lateness: { availability: "UNAVAILABLE", late_events: null, late_event_rate: null, late_minutes: null, unknown_duration_events: null }, conflict: null },
    { class_id: 3, class_name: "Gamma", jenjang: "Primary", basis: "NOT_REPORTED", expected_student_days: 10, recorded_student_days: null, hadir_student_days: null, presumed_hadir_student_days: null, sakit_student_days: null, izin_student_days: null, alfa_student_days: null, unrecorded_student_days: null, other_status_student_days: null, attendance_rate: null, coverage_rate: null, lateness: { availability: "UNAVAILABLE", late_events: null, late_event_rate: null, late_minutes: null, unknown_duration_events: null }, conflict: null },
  ], summary: {
    basis_counts: { observed: 1, declared: 1, not_reported: 1 },
    observed: { class_count: 1, expected_student_days: 10, hadir_student_days: 7, sakit_student_days: 1, izin_student_days: 0, alfa_student_days: 0, recorded_student_days: 8, unrecorded_student_days: 2, other_status_student_days: 0, attendance_rate: 70, coverage_rate: 80 },
    lateness: { availability: "PARTIAL", late_events: 1, late_minutes: 5, unknown_duration_events: 0, late_event_rate: null, late_among_present: null, covered_expected_student_days: 10, available_hadir_student_days: 7, scope_expected_student_days: 30, coverage_rate: 33.3 }, conflict_count: 1,
  } },
  academic_summary: { availability: false, reason: "No academic rows", sumatif_average: null, formatif_average: null, below_kkm_count: 0, by_subject: [] },
  data_quality: { empty_grade_cells: 0, unmapped_levels: [], not_reported_classes: 1, partial_observed_classes: 1, unresolved_conflicts: 1, warnings: ["Academic values are not month-bound."] },
} as unknown as MonthlyReportResponse;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; container = undefined; mocks.report = null; vi.clearAllMocks(); });

describe("Monthly Report view", () => {
  it("shows canonical attendance basis and marks generated results stale when filters change", async () => {
    mocks.report = report;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<MemoryRouter><MonthlyReport /></MemoryRouter>));
    await vi.waitFor(() => expect(container?.querySelector("#monthly-report-month")).not.toBeNull());
    const month = container.querySelector("#monthly-report-month") as HTMLSelectElement;
    await act(async () => { month.value = "2026-08"; month.dispatchEvent(new Event("change", { bubbles: true })); });
    const generate = () => Array.from(container!.querySelectorAll("button")).find((button) => button.textContent?.includes("Generate Report"))!;
    await act(async () => generate().click());
    await vi.waitFor(() => expect(container?.querySelector("[aria-live='polite']")).not.toBeNull());
    expect(container?.textContent).toContain("Alpha");
    expect(container?.textContent).toContain("OBSERVED");
    expect(container?.textContent).toContain("Unrecorded");
    expect(container?.textContent).toContain("CONFLICT");
    expect(container?.textContent).toContain("Beta");
    expect(container?.textContent).toContain("Unavailable");
    expect(container?.textContent).toContain("Gamma");

    await act(async () => { month.value = "2026-09"; month.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container?.textContent).toContain("Report scope changed");
    expect(container?.querySelector("[aria-live='polite']")).toBeNull();
  });
});
