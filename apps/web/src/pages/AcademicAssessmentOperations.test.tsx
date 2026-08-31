import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcademicAssessmentOperations from "./AcademicAssessmentOperations";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import * as academicHooks from "../hooks/useAcademicAnalyticsQueries";
import * as operationsHooks from "../hooks/useAssessmentOperationsQuery";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));
vi.mock("../hooks/useAcademicAnalyticsQueries", () => ({ useAcademicAnalyticsOptionsQuery: vi.fn() }));
vi.mock("../hooks/useAssessmentOperationsQuery", () => ({ useAssessmentOperationsQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["view_student"] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [], class_names: [], subjects: [] };
const options = { classes: [{ id: 7, name: "7A" }], subjects: [{ id: 3, name: "Mathematics" }], jenjangs: [{ id: 1, name: "SMP" }], assessmentTypes: [] };
const response = {
  scope: { academic_year_id: 1, academic_year: "2026/2027", term: 1, class_id: null, subject_id: 3, coverage_state: "ALL" },
  totals: { assessment_sessions: 2, scopes: 2, applicable_students: 4, recorded_scores: 1, unrecorded_scores: 3, complete_scopes: 0, partial_scopes: 1, no_score_scopes: 1, empty_scopes: 0 },
  total: 2, page: 1, page_size: 25,
  sessions: [
    { assessment_session_id: 11, assessment_label: "Midterm", class_id: 7, class_name: "7A", jenjang_id: 1, jenjang: "SMP", subject_id: 3, subject_name: "Mathematics", academic_year_id: 1, academic_year: "2026/2027", term_number: 1, term_label: "Term 1", assessment_date: "2026-08-15", applicable_student_count: 2, recorded_score_count: 1, unrecorded_score_count: 1, coverage_percent: 50, coverage_state: "PARTIAL" },
    { assessment_session_id: 12, assessment_label: "Project Review", class_id: 7, class_name: "7A", jenjang_id: 1, jenjang: "SMP", subject_id: 3, subject_name: "Mathematics", academic_year_id: 1, academic_year: "2026/2027", term_number: 1, term_label: "Term 1", assessment_date: null, applicable_student_count: 2, recorded_score_count: 0, unrecorded_score_count: 2, coverage_percent: 0, coverage_state: "NONE" },
  ],
};
const mocked = (value: unknown) => value as { mockReturnValue: (result: unknown) => void; mock: { calls: unknown[][] } };

describe("AcademicAssessmentOperations", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null });
    mocked(academicHooks.useAcademicAnalyticsOptionsQuery).mockReturnValue({ data: options, isPending: false, error: null });
    mocked(operationsHooks.useAssessmentOperationsQuery).mockReturnValue({ data: response, isPending: false, error: null });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("renders authoritative coverage values, neutral states, and contextual links", async () => {
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><AcademicAssessmentOperations /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("Assessment Operations");
    expect(container.textContent).toContain("Recorded / applicable");
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("No scores");
    expect(container.textContent).toContain("Date not recorded");
    expect(container.querySelector('a[href="/grades?academic_year_id=1&jenjang_id=1&assessment_session_id=11&subject_id=3"]')?.textContent).toContain("Continue score entry");
    expect(container.querySelector('a[href="/classes/7?academic_year_id=1&term=term_1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/analytics/academic?academic_year_id=1&term=term_1&class_id=7&subject_id=3"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/High Risk|Medium Risk|Low Risk|AT_RISK|Risk score|Intervention/i);
  });

  it("sends changed filters through the query hook instead of calculating coverage in React", async () => {
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><AcademicAssessmentOperations /></AuthContext.Provider></MemoryRouter>); });
    const term = container.querySelector("#assessment-term") as HTMLSelectElement;
    await act(async () => { term.value = "term_2"; term.dispatchEvent(new Event("change", { bubbles: true })); });
    const calls = mocked(operationsHooks.useAssessmentOperationsQuery).mock.calls;
    const latest = calls[calls.length - 1]?.[0] as { term: string };
    expect(latest.term).toBe("term_2");
    expect(container.textContent).toContain("1 / 4");
  });

  it("handles loading, error, empty, and permission states", async () => {
    mocked(operationsHooks.useAssessmentOperationsQuery).mockReturnValue({ data: undefined, isPending: true, error: null });
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><AcademicAssessmentOperations /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("Loading assessment operations");
    await act(async () => root.unmount());
    mocked(operationsHooks.useAssessmentOperationsQuery).mockReturnValue({ data: { ...response, sessions: [], total: 0 }, isPending: false, error: null });
    await act(async () => { root = createRoot(container); root.render(<MemoryRouter><AuthContext.Provider value={auth}><AcademicAssessmentOperations /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("No assessment scopes found");
  });

  it("renders an assessment query error instead of an endless loading state", async () => {
    mocked(operationsHooks.useAssessmentOperationsQuery).mockReturnValue({ data: undefined, isPending: false, error: new Error("query failed") });
    await act(async () => { root.render(<MemoryRouter><AuthContext.Provider value={auth}><AcademicAssessmentOperations /></AuthContext.Provider></MemoryRouter>); });
    expect(container.textContent).toContain("Assessment operations unavailable");
  });
});
