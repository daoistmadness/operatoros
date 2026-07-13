import {
  createAcademicInterventionFromAlert,
  fetchAcademicInterventions,
  updateAcademicIntervention,
} from "./academicInterventions";
import { apiRequest } from "../lib/api/client";

vi.mock("../lib/api/client", () => ({
  API_BASE_URL: "http://localhost:8000",
  apiRequest: vi.fn(),
}));

describe("academic interventions API", () => {
  beforeEach(() => {
    apiRequest.mockResolvedValue({ data: {}, status: 200, headers: {} });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("creates an intervention from a Below-KKM alert through the canonical route", async () => {
    const payload = {
      student_id: 11,
      enrollment_id: 21,
      academic_year_id: 7,
      jenjang_id: 2,
      subject_id: 9,
      assessment_type: "sumatif",
      term: "term_2",
      class_name: "P3A",
      student_name: "Export Student",
      subject_name: "Math",
      effective_threshold: 85,
      threshold_source: "legacy-fallback",
      current_average: 74,
      status: "open",
      priority: "high",
      planned_action: "Schedule remediation",
    };

    await createAcademicInterventionFromAlert(payload);

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-interventions/from-alert",
      method: "POST",
      body: payload,
    });
  });

  it("updates intervention workflow fields", async () => {
    await updateAcademicIntervention(5, {
      status: "monitoring",
      priority: "medium",
      owner_name: "Academic Lead",
      follow_up_date: "2025-11-15",
    });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-interventions/5",
      method: "PATCH",
      body: {
        status: "monitoring",
        priority: "medium",
        owner_name: "Academic Lead",
        follow_up_date: "2025-11-15",
      },
    });
  });

  it("lists interventions with analytics-aligned filters", async () => {
    await fetchAcademicInterventions({
      academic_year_id: 7,
      jenjang_id: 2,
      class_name: "P3A",
      subject_id: 9,
      term: "term_2",
      status: "open",
      priority: "urgent",
    });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/academic-interventions",
      method: "GET",
      params: {
        academic_year_id: 7,
        jenjang_id: 2,
        class_name: "P3A",
        subject_id: 9,
        term: "term_2",
        status: "open",
        priority: "urgent",
      },
    });
  });
});
