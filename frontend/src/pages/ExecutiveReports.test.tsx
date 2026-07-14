import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AcademicSection, AnnualTrendsSection, AttendanceSection, DataQualityPanel,
  DEFAULT_REPORT_SCOPE, DEFAULT_REPORT_TYPE, displayValue, ExecutiveSummaryCards,
  ReportFeedback, selectFilterDefaults, staleReport, StudentDistributionSection,
} from "./ExecutiveReports";
import type { ExecutiveReport, ReportFiltersResponse } from "../api/reports";
import appSource from "../App.js?raw";

vi.mock("react-chartjs-2", () => ({
  Bar: ({ data }: { data: { labels: string[] } }) => <div data-chart="bar">{data.labels.join("|")}</div>,
  Line: ({ data }: { data: { labels: string[] } }) => <div data-chart="line">{data.labels.join("|")}</div>,
}));
vi.mock("chart.js", () => ({
  Chart: { register: vi.fn() }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, Tooltip: {}, Legend: {},
}));

const summary = { present: 18, sakit: 2, izin: 1, alfa: 1, incomplete: 3, late_days: 4, late_minutes: 27, attendance_rate: 81.82, late_rate: 18.18 };
const report: ExecutiveReport = {
  meta: { report_type: "annual", scope: "combined", academic_year: { id: 2, name: "2025/2026" }, period: { start: "2025-07-01", end: "2026-06-30" }, generated_at: "2026-07-13T00:00:00Z" },
  executive_summary: { total_students: 25, male_students: 0, female_students: 0, attendance_rate: 81.82, late_rate: null, late_minutes: 27, below_kkm_count: 6, data_completeness_rate: 88.5 },
  student_distribution: { by_level: [{ name: "Primary", count: 25, percentage: 100 }], by_class: [{ name: "P1A", count: 25, percentage: 100 }], by_gender: [], by_religion: [], by_domicile: [] },
  attendance_summary: summary,
  attendance_by_level: [{ level: "Primary", ...summary }],
  academic_summary: { availability: false, reason: "No valid grade rows for this selection.", sumatif_average: null, formatif_average: null, below_kkm_count: 0, by_subject: [] },
  trends: [
    { month: "2025-09", label: "September 2025", ...summary, attendance_denominator: 22, sumatif_average: null, formatif_average: null, below_kkm_count: 0 },
    { month: "2025-07", label: "July 2025", ...summary, attendance_denominator: 22, sumatif_average: null, formatif_average: null, below_kkm_count: 0 },
    { month: "2025-08", label: "August 2025", ...summary, attendance_denominator: 22, sumatif_average: null, formatif_average: null, below_kkm_count: 0 },
  ],
  comparisons: { highest_attendance_month: { name: "September 2025", attendance_rate: 90, attendance_denominator: 20 }, lowest_attendance_month: null, highest_attendance_level: { name: "Primary", attendance_rate: 82, attendance_denominator: 22 }, lowest_attendance_level: null },
  data_quality: { missing_gender: 25, missing_religion: 25, missing_domicile: 25, incomplete_attendance: 3, empty_grade_cells: 7, unmapped_levels: ["Legacy X"], warnings: ["Demographic fields are unavailable.", "Population is an academic-year enrollment snapshot.", "Monthly academic trends are unavailable."] },
};

const markup = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("Executive Reports presentation", () => {
  it("allows the application main area to shrink at narrow viewports", () => {
    expect(appSource).toContain('className="app-main min-w-0 flex-1 ml-64 p-8"');
  });
  it("defines Monthly as the default report type", () => expect(DEFAULT_REPORT_TYPE).toBe("monthly"));
  it("defines Combined as the default scope", () => expect(DEFAULT_REPORT_SCOPE).toBe("combined"));

  it("selects the backend default academic year and first valid month", () => {
    const filters = { default_academic_year_id: 2, academic_years: [{ id: 1 }, { id: 2 }], months: [{ value: "2025-07" }] } as ReportFiltersResponse;
    expect(selectFilterDefaults(filters)).toEqual({ academicYearId: 2, month: "2025-07" });
  });

  it("clears stale report data", () => expect(staleReport()).toBeNull());

  it("renders a loading state", () => expect(markup(<ReportFeedback loading error={null} />)).toContain("Loading report"));
  it("renders an API error state", () => expect(markup(<ReportFeedback loading={false} error="Request failed" />)).toContain("Request failed"));
  it("renders the explicit empty state", () => expect(markup(<ReportFeedback loading={false} error={null} />)).toContain("Generate an executive report"));

  it("maps KPI values without recomputing them", () => {
    const html = markup(<ExecutiveSummaryCards report={report} />);
    expect(html).toContain("Total Students"); expect(html).toContain(">25<"); expect(html).toContain("81.82%"); expect(html).toContain("88.5%");
  });

  it("renders null KPI values as unavailable", () => {
    expect(displayValue(null, "%")).toBe("Not Available");
    expect(markup(<ExecutiveSummaryCards report={report} />)).toContain("Not Available");
  });

  it("maps attendance values to an auditable level table", () => {
    const html = markup(<AttendanceSection report={report} />);
    expect(html).toContain("Attendance by Level chart"); expect(html).toContain("Primary"); expect(html).toContain(">18<"); expect(html).toContain("27");
  });

  it("renders the backend academic unavailable reason", () => {
    expect(markup(<AcademicSection report={report} />)).toContain("No valid grade rows for this selection.");
  });

  it("discloses unavailable demographics without empty charts", () => {
    const html = markup(<StudentDistributionSection report={report} />);
    expect(html).toContain("Gender, religion, and domicile distributions are unavailable");
    expect(html).not.toContain("Gender chart");
  });

  it("shows all backend data-quality warnings and unmapped levels", () => {
    const html = markup(<DataQualityPanel report={report} />);
    expect(html).toContain("Legacy X"); expect(html).toContain("Demographic fields are unavailable."); expect(html).toContain("academic-year enrollment snapshot"); expect(html).toContain("Monthly academic trends are unavailable.");
  });

  it("preserves the chronological order supplied by the backend", () => {
    const html = markup(<AnnualTrendsSection report={report} />);
    expect(html.indexOf("September 2025")).toBeLessThan(html.indexOf("July 2025"));
    expect(html.indexOf("July 2025")).toBeLessThan(html.indexOf("August 2025"));
  });

  it("renders null annual comparisons as unavailable", () => {
    const html = markup(<AnnualTrendsSection report={report} />);
    expect(html).toContain("Lowest Attendance Month"); expect(html).toContain("Not Available");
  });
});
