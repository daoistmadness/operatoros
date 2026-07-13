import {
  downloadManagementSummaryExcel,
  downloadManagementSummaryPdf,
} from "./analytics";
import { API_BLOB_TYPES, apiRequest } from "../lib/api/client";

vi.mock("../lib/api/client", () => ({
  API_BASE_URL: "http://localhost:8000",
  API_BLOB_TYPES: {
    excel: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    pdf: ["application/pdf"],
  },
  apiRequest: vi.fn(),
}));

describe("management analytics exports", () => {
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

  it("includes active filters when downloading the PDF export", async () => {
    await downloadManagementSummaryPdf({
      academic_year_id: 7,
      jenjang_id: 2,
      class_name: "P3A",
      subject_id: 4,
      term: "term_2",
    });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/management-summary/export/pdf",
      method: "GET",
      params: {
        academic_year_id: 7,
        jenjang_id: 2,
        class_name: "P3A",
        subject_id: 4,
        term: "term_2",
      },
      responseType: "blob",
      expectedBlobTypes: API_BLOB_TYPES.pdf,
    });
  });

  it("includes active filters when downloading the Excel export", async () => {
    await downloadManagementSummaryExcel({
      academic_year_id: 7,
      jenjang_id: null,
      class_name: null,
      subject_id: null,
      term: null,
    });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/analytics/management-summary/export/excel",
      method: "GET",
      params: {
        academic_year_id: 7,
        jenjang_id: undefined,
        class_name: undefined,
        subject_id: undefined,
        term: undefined,
      },
      responseType: "blob",
      expectedBlobTypes: API_BLOB_TYPES.excel,
    });
  });
});
