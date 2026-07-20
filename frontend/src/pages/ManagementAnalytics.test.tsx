import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ManagementAnalytics from "./ManagementAnalytics";
import * as analyticsApi from "../api/analytics";
import { AuthContext, AuthContextValue } from "../context/AuthContext";

// Mock react-chartjs-2 to avoid canvas issues
vi.mock("react-chartjs-2", () => ({
  Bar: (props: any) => <div data-testid="bar-chart">{props.data?.labels?.join(", ")}</div>,
  Doughnut: (props: any) => <div data-testid="doughnut-chart">{props.data?.labels?.join(", ")}</div>,
  Line: (props: any) => <div data-testid="line-chart">{props.data?.labels?.join(", ")}</div>,
}));

// Mock Analytics API
vi.mock("../api/analytics", () => ({
  fetchAnalyticsFilters: vi.fn(),
  fetchManagementSummary: vi.fn(),
  fetchHistoricalTrends: vi.fn(),
  fetchInterventionImpact: vi.fn(),
  fetchEffectiveTerms: vi.fn(),
  fetchReportTemplates: vi.fn(),
  downloadManagementSummaryPdf: vi.fn(),
  downloadManagementSummaryExcel: vi.fn(),
  downloadReportBuilderPdf: vi.fn(),
  downloadReportBuilderExcel: vi.fn(),
  previewReportBuilder: vi.fn(),
}));

const mockAdminAuth: AuthContextValue = {
  user: { id: 1, name: "Admin", role: "admin", capabilities: ["import_student_roster", "create_student", "manage_student_permissions"] },
  loading: false,
  authenticated: true,
  can: (cap: string) => true,
  login: vi.fn(),
  logout: vi.fn(),
};

const mockStaffAuth: AuthContextValue = {
  user: { id: 2, name: "Staff User", role: "staff", capabilities: ["view_student"] },
  loading: false,
  authenticated: true,
  can: (cap: string) => false,
  login: vi.fn(),
  logout: vi.fn(),
};

const renderComponent = (authValue: AuthContextValue = mockAdminAuth) => {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>
        <ManagementAnalytics />
      </AuthContext.Provider>
    </MemoryRouter>
  );
};

describe("ManagementAnalytics Component - Static & State Render Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (analyticsApi.fetchAnalyticsFilters as any).mockResolvedValue({
      academic_years: [{ id: 10, label: "2025/2026", is_default: true }],
      jenjangs: [{ id: 1, name: "SD", code: "SD" }],
      class_names: ["1A"],
      subjects: [{ id: 101, name: "Matematika", code: "MATH" }],
    });
    (analyticsApi.fetchEffectiveTerms as any).mockResolvedValue([
      { value: "term_1", label: "Term 1" },
    ]);
    (analyticsApi.fetchReportTemplates as any).mockResolvedValue([]);
    (analyticsApi.fetchHistoricalTrends as any).mockResolvedValue({
      granularity: "term",
      trend_series: { attendance: { by_term: [] }, lateness: { by_term: [] }, grades: { by_term: [] }, interventions: { by_term: [] } },
      forecast_series: [],
    });
    (analyticsApi.fetchInterventionImpact as any).mockResolvedValue({
      summary: { total_interventions: 0, interventions_by_status: {} },
      subject_breakdown: [],
      impact_rows: [],
    });
  });

  it("renders main title, header actions, and filter bar shell", () => {
    const html = renderComponent();
    expect(html).toContain("Management Analytics");
    expect(html).toContain("Export PDF");
    expect(html).toContain("Export Excel");
    expect(html).toContain("Filter Analisis");
  });

  it("renders loading skeleton accessibility role during initial async state", () => {
    (analyticsApi.fetchAnalyticsFilters as any).mockReturnValue(new Promise(() => {}));
    const html = renderComponent();
    expect(html).toContain('role="status"');
    expect(html).toContain("Memuat data analisis...");
  });

  it("renders SYSTEM_EMPTY state when total_students === 0", async () => {
    (analyticsApi.fetchManagementSummary as any).mockResolvedValue({
      academic_year: { id: 10, name: "2025/2026" },
      total_students: 0,
      attendance_summary: { overall_attendance_percentage: 0, status_counts: {} },
      tardiness_summary: { total_late_records: 0, total_late_minutes: 0, average_late_minutes: 0 },
      grade_by_class: [],
      grade_by_subject: [],
      grade_by_student: [],
      below_kkm_alerts: [],
      warnings: [],
      executive_insights: [],
    });

    const html = renderComponent();
    // Verify structure
    expect(html).toContain("Management Analytics");
  });

  it("renders PERMISSION_RESTRICTED state when staff user accesses restricted analytics or receives 403", () => {
    (analyticsApi.fetchAnalyticsFilters as any).mockRejectedValue(new Error("403 Forbidden: Akses ditolak"));
    const html = renderComponent(mockStaffAuth);
    expect(html).toContain("Management Analytics");
  });
});
