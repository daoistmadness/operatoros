import {
  createReportTemplate,
  deleteReportTemplate,
  downloadReportBuilderExcel,
  downloadReportBuilderPdf,
  fetchReportTemplates,
  previewReportBuilder,
  reportBuilderApiPath,
  updateReportBranding,
} from "./reportBuilder";

vi.mock("../lib/api/client", () => ({
  API_BASE_URL: "http://localhost:8000",
  API_BLOB_TYPES: {
    excel: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    pdf: ["application/pdf"],
  },
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../lib/api/client";

describe("report builder API wrappers", () => {
  beforeEach(() => {
    apiRequest.mockResolvedValue({
      data: new Blob(["report"]),
      status: 200,
      headers: {},
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("builds the canonical API path", () => {
    expect(reportBuilderApiPath("/templates")).toBe("/api/report-builder/templates");
  });

  it("requests report templates and preview payloads through the builder endpoint", async () => {
    await fetchReportTemplates();
    await previewReportBuilder({
      template_id: 4,
      filters: { academic_year_id: 7, class_name: "P3A" },
      include_trends: true,
      include_forecast: true,
      forecast_method: "linear_trend",
      granularity: "term",
    });

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/templates",
        method: "GET",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/preview",
        method: "POST",
      })
    );
  });

  it("sends builder export requests and template CRUD payloads", async () => {
    await downloadReportBuilderPdf({
      template_id: 4,
      filters: { academic_year_id: 7, class_name: "P3A" },
      include_trends: true,
      include_forecast: true,
      forecast_method: "linear_trend",
      granularity: "term",
    });
    await downloadReportBuilderExcel({
      template_id: 4,
      filters: { academic_year_id: 7, class_name: "P3A" },
      include_trends: true,
      include_forecast: true,
      forecast_method: "linear_trend",
      granularity: "term",
      mode: "editable",
    });
    await createReportTemplate({
      name: "Template",
      description: null,
      template_type: "management_summary",
      output_format: "both",
      is_default: false,
      is_active: true,
      page_order_json: ["executive_summary"],
      section_visibility_json: { executive_summary: true },
      chart_visibility_json: { executive_summary: true },
      excel_sheet_visibility_json: { README: true },
      default_filters_json: {},
      export_options_json: {},
    });
    await updateReportBranding(2, {
      school_name: "School",
      report_header_title: "Header",
      report_subtitle: "Subtitle",
      primary_color: "#1E3A8A",
      secondary_color: "#0F172A",
      accent_color: "#F97316",
      footer_text: "Footer",
      prepared_by: "Tester",
    });
    await deleteReportTemplate(3);

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/export/pdf",
        method: "POST",
        responseType: "blob",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/export/excel",
        method: "POST",
        responseType: "blob",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/templates",
        method: "POST",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/branding/2",
        method: "PATCH",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/report-builder/templates/3",
        method: "DELETE",
      })
    );
  });
});

