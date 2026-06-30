// analytics.management.test.js
// Phase 17: Frontend QA - Management Analytics API and Summary Shape
// Validates: fetch summary params, export filters, Executive Insights shape, Below-KKM shape, intervention metadata

import { fetchInterventionImpact, fetchManagementSummary, downloadManagementSummaryExcel, downloadManagementSummaryPdf } from "./analytics";
import { API_BASE_URL, API_BLOB_TYPES, apiRequest } from "../lib/api/client";

jest.mock("../lib/api/client", () => ({
  // Portless local mode: base ends with /api -> analyticsApiPath prepends /api/api/
  API_BASE_URL: "http://localhost:3000/api",
  API_BLOB_TYPES: {
    excel: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    pdf: ["application/pdf"],
  },
  apiRequest: jest.fn(),
}));

// In portless mode: analyticsApiPath("/management-summary") => "/api/api/analytics/management-summary"
const SUMMARY_PATH = "/api/api/analytics/management-summary";
const IMPACT_PATH = "/api/api/analytics/intervention-impact";
const EXCEL_PATH = "/api/api/analytics/management-summary/export/excel";
const PDF_PATH = "/api/api/analytics/management-summary/export/pdf";

describe("fetchManagementSummary", () => {
  afterEach(() => jest.clearAllMocks());

  it("passes all active filters to the canonical JSON endpoint", async () => {
    apiRequest.mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await fetchManagementSummary({ academic_year_id: 3, jenjang_id: 2, class_name: "P1A", subject_id: 5, term: "term_2" });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: SUMMARY_PATH,
        method: "GET",
        params: expect.objectContaining({ academic_year_id: 3, jenjang_id: 2, class_name: "P1A", subject_id: 5, term: "term_2" }),
      })
    );
  });

  it("omits null filters - does not pass undefined to params", async () => {
    apiRequest.mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await fetchManagementSummary({ academic_year_id: 3, jenjang_id: null, class_name: null, subject_id: null, term: null });
    const call = apiRequest.mock.calls[0][0];
    expect(call.params.jenjang_id).toBeUndefined();
    expect(call.params.class_name).toBeUndefined();
    expect(call.params.subject_id).toBeUndefined();
    expect(call.params.term).toBeUndefined();
  });

  it("returns the data payload from the response", async () => {
    const mockData = { attendance_summary: { status_counts: { hadir: 42 } } };
    apiRequest.mockResolvedValueOnce({ data: mockData, status: 200, headers: {} });
    const result = await fetchManagementSummary({ academic_year_id: 1, jenjang_id: null, class_name: null, subject_id: null, term: null });
    expect(result.attendance_summary.status_counts.hadir).toBe(42);
  });
});

describe("fetchInterventionImpact", () => {
  afterEach(() => jest.clearAllMocks());

  it("passes drilldown filters to the canonical impact endpoint", async () => {
    apiRequest.mockResolvedValueOnce({ data: { impact_rows: [] }, status: 200, headers: {} });
    await fetchInterventionImpact({
      academic_year_id: 3,
      jenjang_id: 2,
      class_name: "P3",
      subject_id: 5,
      term: "term_3",
      status: "open",
      priority: "high",
      owner_name: "Teacher A",
      risk_level: "critical",
    });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: IMPACT_PATH,
        method: "GET",
        params: expect.objectContaining({
          academic_year_id: 3,
          jenjang_id: 2,
          class_name: "P3",
          subject_id: 5,
          term: "term_3",
          status: "open",
          priority: "high",
          owner_name: "Teacher A",
          risk_level: "critical",
        }),
      })
    );
  });
});

describe("downloadManagementSummaryExcel", () => {
  afterEach(() => jest.clearAllMocks());

  it("sends active filters to Excel export endpoint with blob response type", async () => {
    apiRequest.mockResolvedValueOnce({ data: new Blob(["xls"]), status: 200, headers: {} });
    await downloadManagementSummaryExcel({ academic_year_id: 3, jenjang_id: 2, class_name: "P1A", subject_id: 5, term: "term_3" });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: EXCEL_PATH,
        method: "GET",
        responseType: "blob",
        expectedBlobTypes: API_BLOB_TYPES.excel,
        params: expect.objectContaining({ academic_year_id: 3, jenjang_id: 2, class_name: "P1A", subject_id: 5, term: "term_3" }),
      })
    );
  });

  it("omits null filter values in Excel export params", async () => {
    apiRequest.mockResolvedValueOnce({ data: new Blob(["xls"]), status: 200, headers: {} });
    await downloadManagementSummaryExcel({ academic_year_id: 7, jenjang_id: null, class_name: null, subject_id: null, term: null });
    const call = apiRequest.mock.calls[0][0];
    expect(call.params.jenjang_id).toBeUndefined();
    expect(call.params.class_name).toBeUndefined();
  });
});

describe("downloadManagementSummaryPdf", () => {
  afterEach(() => jest.clearAllMocks());

  it("sends active filters to PDF export endpoint with blob response type", async () => {
    apiRequest.mockResolvedValueOnce({ data: new Blob(["pdf"]), status: 200, headers: {} });
    await downloadManagementSummaryPdf({ academic_year_id: 3, jenjang_id: 2, class_name: "P1B", subject_id: null, term: "term_1" });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: PDF_PATH,
        method: "GET",
        responseType: "blob",
        expectedBlobTypes: API_BLOB_TYPES.pdf,
        params: expect.objectContaining({ academic_year_id: 3, jenjang_id: 2, class_name: "P1B", term: "term_1" }),
      })
    );
  });
});

describe("Executive Insights data shape contract", () => {
  const sampleSummary = {
    executive_insights: [
      { severity: "critical", category: "below_kkm", title: "Keterlambatan Akademik", message: "5 siswa di bawah KKM", recommended_action: "Remediation" },
      { severity: "warning", category: "attendance", title: "Kehadiran Rendah", message: "Kelas P1B hanya 72%", recommended_action: "Monitor" },
      { severity: "info", category: "data_quality", title: "Laporan Tahunan Penuh", message: "Cakupan data lengkap", recommended_action: "Lanjutkan" },
    ],
    warnings: ["2 null grade entries detected for Math Formatif"],
    below_kkm_alerts: [
      { student_name: "Bob", subject_name: "Math", assessment_type: "sumatif", avg_score: 75, kkm_threshold: 80, threshold_source: "kkm_configured", intervention_status: "open", intervention_priority: "high" },
      { student_name: "Dave", subject_name: "Science", assessment_type: "sumatif", avg_score: 72, kkm_threshold: 85, threshold_source: "legacy-fallback", intervention_status: null, intervention_priority: null },
    ],

  };

  it("insights are ordered critical > warning > info", () => {
    const order = { critical: 0, warning: 1, info: 2 };
    const vals = sampleSummary.executive_insights.map((i) => order[i.severity] ?? 3);
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
  });

  it("every insight has required fields", () => {
    sampleSummary.executive_insights.forEach((i) => {
      ["severity", "category", "title", "message", "recommended_action"].forEach((k) => {
        expect(i).toHaveProperty(k);
      });
    });
  });

  it("warnings array contains null grade detection message", () => {
    expect(sampleSummary.warnings.some((w) => w.toLowerCase().includes("null"))).toBe(true);
  });

  it("below-KKM alert with open intervention has status and priority", () => {
    const withIntervention = sampleSummary.below_kkm_alerts.find((a) => a.intervention_status === "open");
    expect(withIntervention).not.toBeUndefined();
    expect(withIntervention.intervention_priority).toBe("high");
  });

  it("below-KKM alert links custom KKM source with threshold 80", () => {
    const bob = sampleSummary.below_kkm_alerts.find((a) => a.student_name === "Bob");
    expect(bob.kkm_threshold).toBe(80);
    expect(bob.threshold_source).toBe("kkm_configured");
  });

  it("below-KKM alert with no intervention has null status", () => {
    const dave = sampleSummary.below_kkm_alerts.find((a) => a.student_name === "Dave");
    expect(dave.intervention_status).toBeNull();
  });

  it("legacy KKM fallback threshold is 85", () => {
    const legacyAlerts = sampleSummary.below_kkm_alerts.filter((a) => a.threshold_source === "legacy-fallback");
    legacyAlerts.forEach((a) => expect(a.kkm_threshold).toBe(85));
  });

});
