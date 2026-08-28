import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManagementAnalytics from "./ManagementAnalytics";
import * as analyticsApi from "../api/analytics";
import * as academicConfigApi from "../api/academicConfig";
import * as reportBuilderApi from "../api/reportBuilder";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Doughnut: () => <div data-testid="doughnut-chart" />,
  Line: () => <div data-testid="line-chart" />,
}));

vi.mock("../api/analytics", () => ({
  fetchAnalyticsCohorts: vi.fn(),
  fetchAnalyticsOverview: vi.fn(),
  fetchAnalyticsTrends: vi.fn(),
  fetchAnalyticsFilters: vi.fn(),
  fetchManagementSummary: vi.fn(),
  fetchHistoricalTrends: vi.fn(),
  fetchInterventionImpact: vi.fn(),
  downloadManagementSummaryPdf: vi.fn(),
  downloadManagementSummaryExcel: vi.fn(),
}));
vi.mock("../api/academicConfig", () => ({ fetchEffectiveTerms: vi.fn() }));
vi.mock("../api/reportBuilder", () => ({
  fetchReportTemplates: vi.fn(),
  previewReportBuilder: vi.fn(),
  downloadReportBuilderPdf: vi.fn(),
  downloadReportBuilderExcel: vi.fn(),
}));

const adminAuth: AuthContextValue = {
  user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student", "import_student_roster"] },
  loading: false,
  authenticated: true,
  can: () => true,
  login: vi.fn(),
  logout: vi.fn(),
};

const restrictedAuth: AuthContextValue = {
  ...adminAuth,
  user: { id: 2, username: "Staff", role: "staff", capabilities: [] },
  can: () => false,
};

const filters = {
  academic_years: [{ id: 10, label: "2025/2026", is_default: true }],
  jenjangs: [{ id: 1, name: "SD", code: "SD" }],
  class_names: ["1A"],
  subjects: [{ id: 101, name: "Matematika", jenjang_id: 1 }],
};

let container: HTMLDivElement;
let root: Root;

async function renderPage(auth: AuthContextValue = adminAuth) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={createTestQueryClient()}>
          <AuthContext.Provider value={auth}>
            <ManagementAnalytics />
          </AuthContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

describe("ManagementAnalytics state handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockResolvedValue(filters);
    vi.mocked(analyticsApi.fetchAnalyticsCohorts).mockResolvedValue({ contract_version: "analytics.v1", filters: {} as never, metric_definitions: [], dimension: "class", cohorts: [] });
    vi.mocked(analyticsApi.fetchAnalyticsOverview).mockResolvedValue({} as never);
    vi.mocked(analyticsApi.fetchAnalyticsTrends).mockResolvedValue({} as never);
    vi.mocked(academicConfigApi.fetchEffectiveTerms).mockResolvedValue([]);
    vi.mocked(reportBuilderApi.fetchReportTemplates).mockResolvedValue([]);
    vi.mocked(analyticsApi.fetchHistoricalTrends).mockResolvedValue({} as never);
    vi.mocked(analyticsApi.fetchInterventionImpact).mockResolvedValue({} as never);
    vi.mocked(analyticsApi.fetchManagementSummary).mockReturnValue(new Promise(() => {}));
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  it("gives capability denial precedence without making analytics requests", async () => {
    const view = await renderPage(restrictedAuth);
    expect(view.textContent).toContain("Akses Terbatas");
    expect(analyticsApi.fetchAnalyticsFilters).not.toHaveBeenCalled();
    expect(analyticsApi.fetchManagementSummary).not.toHaveBeenCalled();
    expect(reportBuilderApi.fetchReportTemplates).not.toHaveBeenCalled();
  });

  it("shows setup guidance when no academic year exists", async () => {
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockResolvedValue({ ...filters, academic_years: [] });
    const view = await renderPage();
    expect(view.textContent).toContain("Konfigurasi Akademik Diperlukan");
    expect(view.textContent).toContain("Buka Pengaturan Akademik");
  });

  it("shows an accessible initial loading state", async () => {
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockReturnValue(new Promise(() => {}));
    const view = await renderPage();
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Memuat data analisis");
  });

  it("does not render raw backend error details", async () => {
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockRejectedValue(new Error("SQLSTATE secret internal detail"));
    const view = await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(view.textContent).toContain("Gagal Memuat Analisis Manajemen");
    expect(view.textContent).not.toContain("SQLSTATE");
  });
});
