import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  bulkEnrollStudents: vi.fn(),
  changeEnrollmentLifecycle: vi.fn(),
  deleteEnrollment: vi.fn(),
  fetchEnrollmentCandidates: vi.fn(),
  fetchEnrollmentSourceClasses: vi.fn(),
  fetchEnrollments: vi.fn(),
  fetchJenjangs: vi.fn(),
  fetchAcademicClasses: vi.fn(),
  fetchAcademicGrades: vi.fn(),
  fetchAcademicPrograms: vi.fn(),
  fetchAcademicYears: vi.fn(),
}));

vi.mock("../../api/enrollment", () => api);
vi.mock("../../api/grades", () => ({ fetchAcademicYears: api.fetchAcademicYears }));

import { EnrollmentPanel } from "./EnrollmentPanel";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const row = (id: number, state: string, overrides = {}) => ({
  enrollment_id: id,
  student_id: id,
  student_name: `Student ${id}`,
  jenjang: "Primary",
  student_class_name: "1A",
  academic_year_id: 1,
  jenjang_id: 1,
  class_name: "1A",
  class_assigned: state === "ACTIVE",
  student_master_id: `master-${id}`,
  lifecycle_state: state,
  device_linked: true,
  effective_from: "2026-07-01",
  effective_to: state === "ACTIVE" ? null : "2026-09-01",
  class_history: [{ id, class_name: "1A", effective_from: "2026-07-01", effective_to: state === "ACTIVE" ? null : "2026-09-01", source: "test" }],
  deletion: { can_hard_delete: false, code: "ENROLLMENT_HAS_HISTORY", message: "History preserved", dependencies: ["CLASS_HISTORY"] },
  ...overrides,
});

async function renderPanel() {
  api.fetchAcademicYears.mockResolvedValue([{ id: 1, label: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30", status: "active", is_default: true }]);
  api.fetchJenjangs.mockResolvedValue([{ id: 1, name: "Primary" }]);
  api.fetchAcademicClasses.mockResolvedValue([{ id: 1, academic_year_id: 1, grade_id: 1, class_name: "1A", section_code: "A", active: true }]);
  api.fetchAcademicGrades.mockResolvedValue([{ id: 1, jenjang_id: 1, program_id: 1, name: "Grade 1", sequence_number: 1, active: true }]);
  api.fetchAcademicPrograms.mockResolvedValue([{ id: 1, jenjang_id: 1, name: "General", active: true }]);
  api.fetchEnrollmentCandidates.mockResolvedValue([{ id: "unlinked", student_id: null, name: "Academic Only", jenjang: null, class_name: null, device_linked: false }]);
  api.fetchEnrollmentSourceClasses.mockResolvedValue([]);
  api.fetchEnrollments.mockResolvedValue([
    row(1, "ACTIVE"), row(2, "ENDED"), row(3, "WITHDRAWN"), row(4, "GRADUATED"),
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<EnrollmentPanel showHero={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("EnrollmentPanel ledger lifecycle", () => {
  it("shows lifecycle states, class history, and separate device readiness", async () => {
    const view = await renderPanel();
    for (const state of ["ACTIVE", "ENDED", "WITHDRAWN", "GRADUATED"]) expect(view.textContent).toContain(state);
    expect(view.textContent).toContain("Class history (1)");
    expect(view.textContent).toContain("device not linked");
  });

  it("offers explicit lifecycle actions and suppresses destructive deletion", async () => {
    const view = await renderPanel();
    expect(view.textContent).toContain("End");
    expect(view.textContent).toContain("Withdraw");
    expect(view.textContent).toContain("Graduate");
    expect(view.textContent).toContain("Reactivate");
    expect(view.textContent).toContain("Delete unavailable: history is preserved.");
    expect([...view.querySelectorAll("button")].some((button) => button.textContent?.includes("Delete draft"))).toBe(false);
  });

  it("opens an accessible effective-dated confirmation without losing the selected row", async () => {
    const view = await renderPanel();
    const withdraw = [...view.querySelectorAll("button")].find((button) => button.textContent === "Withdraw") as HTMLButtonElement;
    await act(async () => withdraw.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("#enrollment-lifecycle-date")).not.toBeNull();
    expect(document.querySelector("#enrollment-lifecycle-reason")).not.toBeNull();
    expect(view.textContent).toContain("Student 1");
  });
});
