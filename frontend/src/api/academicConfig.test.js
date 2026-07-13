import {
  createKkmThreshold,
  createTermConfig,
  deleteTermConfig,
  fetchEffectiveTerms,
  updateKkmThreshold,
} from "./academicConfig";
import { apiRequest } from "../lib/api/client";

vi.mock("../lib/api/client", () => ({
  API_BASE_URL: "http://localhost:8000",
  apiRequest: vi.fn(),
}));

describe("academic config API", () => {
  beforeEach(() => {
    apiRequest.mockResolvedValue({ data: {}, status: 200, headers: {} });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("saves a KKM threshold with the expected payload", async () => {
    await createKkmThreshold({
      academic_year_id: 7,
      jenjang_id: 2,
      subject_id: 9,
      assessment_type: "sumatif",
      threshold: 82.5,
    });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-config/kkm-thresholds",
      method: "POST",
      body: {
        academic_year_id: 7,
        jenjang_id: 2,
        subject_id: 9,
        assessment_type: "sumatif",
        threshold: 82.5,
      },
    });
  });

  it("updates a KKM threshold with a numeric range payload", async () => {
    await updateKkmThreshold(3, { threshold: 75 });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-config/kkm-thresholds/3",
      method: "PUT",
      body: { threshold: 75 },
    });
  });

  it("loads effective term mappings for the selected academic year", async () => {
    await fetchEffectiveTerms(7);

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-config/terms/effective",
      method: "GET",
      params: { academic_year_id: 7 },
    });
  });

  it("saves and restores term configuration through canonical routes", async () => {
    await createTermConfig({
      academic_year_id: 7,
      term_number: 2,
      label: "Custom Term 2",
      start_date: "2025-12-01",
      end_date: "2025-12-31",
    });
    await deleteTermConfig(12);

    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      path: "/api/academic-config/terms",
      method: "POST",
      body: {
        academic_year_id: 7,
        term_number: 2,
        label: "Custom Term 2",
        start_date: "2025-12-01",
        end_date: "2025-12-31",
      },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      path: "/api/academic-config/terms/12",
      method: "DELETE",
    });
  });
});
