import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcademicAnalytics from "./AcademicAnalytics";
import * as analyticsApi from "../api/analytics";
import * as academicApi from "../api/academicAnalytics";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("react-chartjs-2", () => ({ Bar: () => <div data-testid="academic-chart" /> }));
vi.mock("../api/analytics", () => ({ fetchAnalyticsFilters: vi.fn() }));
vi.mock("../api/academicAnalytics", () => ({ fetchAcademicAnalyticsOptions: vi.fn(), fetchAcademicAnalyticsOverview: vi.fn(), fetchAcademicAnalyticsStudents: vi.fn(), downloadAcademicAnalytics: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student", "export_student_data"] }, loading: false, authenticated: true, can: (capability) => ["view_student", "export_student_data"].includes(capability), login: vi.fn(), logout: vi.fn() };
const scope = { academicYearId: 1, academicYearLabel: "2026/2027", term: null, jenjangId: null, classId: null, subjectId: null, assessmentType: null, includedStudentCount: 2, includedAssessmentCount: 2 };
const row = { id: 1, label: "Mathematics", students: 2, scoredStudents: 2, assessments: 1, expectedResults: 2, scoredResults: 2, missingResults: 0, participationPercentage: 100, average: 85, min: 80, max: 90, formativeAverage: 80, summativeAverage: 90 };
const overview = { scope, summary: { students: 2, assessments: 2, expectedResults: 4, scoredResults: 4, missingResults: 0, participationPercentage: 100, score: { average: 85, scoreSum: 340, scoreCount: 4, min: 80, max: 90 }, formative: { average: 80, scoreSum: 160, scoreCount: 2, min: 80, max: 80 }, summative: { average: 90, scoreSum: 180, scoreCount: 2, min: 90, max: 90 }, mastery: { available: true, evaluatedResults: 4, meetingResults: 3, belowResults: 1, meetingStudents: 1, belowStudents: 1, fallbackThreshold: 85 } }, subjects: [row], classes: [row], jenjang: [row], assessments: [{ id: 1, label: "Exam", subjectId: 1, subjectName: "Mathematics", assessmentType: "sumatif", participants: 2, scored: 2, missing: 0, average: 90, min: 90, max: 90 }], distribution: [{ bucket: "0-49", min: 0, max: 49, count: 0 }, { bucket: "50-59", min: 50, max: 59, count: 0 }, { bucket: "60-69", min: 60, max: 69, count: 0 }, { bucket: "70-79", min: 70, max: 79, count: 0 }, { bucket: "80-89", min: 80, max: 89, count: 2 }, { bucket: "90-100", min: 90, max: 100, count: 2 }], metricDefinitions: { average: "server", participation: "server", missing: "Missing scores are not zero.", rounding: "half even", mastery: "KKM", term: "no term field" }, generatedAt: "2026-08-30T00:00:00Z" };

let container: HTMLDivElement;
let root: Root;

describe("AcademicAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyticsApi.fetchAnalyticsFilters).mockResolvedValue({ academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [], class_names: [], subjects: [] });
    vi.mocked(academicApi.fetchAcademicAnalyticsOptions).mockResolvedValue({ academicYears: [{ id: 1, label: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isDefault: true }], jenjangs: [{ id: 1, name: "SD" }], classes: [{ id: 1, name: "1A", jenjangId: 1 }], subjects: [{ id: 1, name: "Mathematics", jenjangId: 1 }], assessmentTypes: [{ id: "formatif", label: "Formatif" }, { id: "sumatif", label: "Sumatif" }] });
    vi.mocked(academicApi.fetchAcademicAnalyticsOverview).mockResolvedValue(overview as never);
    vi.mocked(academicApi.fetchAcademicAnalyticsStudents).mockResolvedValue({ scope, total: 1, page: 1, pageSize: 25, rows: [{ studentId: 10, studentName: "A Student", className: "1A", subjectsIncluded: 1, assessmentsIncluded: 2, expectedAssessments: 2, missingAssessments: 0, average: 85, formativeAverage: 80, summativeAverage: 90 }], generatedAt: overview.generatedAt } as never);
  });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders server-computed academic sections and keeps filters in requests", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={createTestQueryClient()}><AuthContext.Provider value={auth}><AcademicAnalytics /></AuthContext.Provider></QueryClientProvider></MemoryRouter>); });
    await vi.waitFor(() => expect(container.textContent).toContain("Academic Analytics"), { timeout: 3000 });
    expect(container.textContent).toContain("85.0"); expect(container.textContent).toContain("By Subject"); expect(container.textContent).toContain("Assessments"); expect(container.textContent).toContain("A Student"); expect(container.querySelector('[data-testid="academic-chart"]')).not.toBeNull();
    expect(academicApi.fetchAcademicAnalyticsOverview).toHaveBeenCalledWith({ academic_year_id: 1, jenjang_id: null, class_id: null, subject_id: null, assessment_type: null });
  });
});
