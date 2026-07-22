import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/client";

const api = vi.hoisted(() => ({
  fetchAcademicYears: vi.fn(), fetchAcademicClasses: vi.fn(), fetchAcademicGrades: vi.fn(), fetchAcademicPrograms: vi.fn(), fetchJenjangs: vi.fn(),
  createProgressionPreview: vi.fn(), patchProgressionRow: vi.fn(), revalidateProgressionPreview: vi.fn(), commitProgressionPreview: vi.fn(),
}));

vi.mock("../../api/grades", () => ({ fetchAcademicYears: api.fetchAcademicYears }));
vi.mock("../../api/enrollment", () => ({
  fetchAcademicClasses: api.fetchAcademicClasses, fetchAcademicGrades: api.fetchAcademicGrades,
  fetchAcademicPrograms: api.fetchAcademicPrograms, fetchJenjangs: api.fetchJenjangs,
}));
vi.mock("../../api/progression", () => ({
  createProgressionPreview: api.createProgressionPreview, patchProgressionRow: api.patchProgressionRow,
  revalidateProgressionPreview: api.revalidateProgressionPreview, commitProgressionPreview: api.commitProgressionPreview,
}));

import { ProgressionPanel } from "./ProgressionPanel";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const row = (id: number, outcome: string, overrides = {}) => ({
  preview_row_id: id, source_enrollment_id: id, student_master_id: `master-${id}`, student_name: `Student ${id}`,
  source_jenjang_id: 1, source_program_id: 1, source_grade_id: outcome === "GRADUATE" ? 2 : 1,
  source_class_id: outcome === "GRADUATE" ? 2 : 1, source_class_name: outcome === "GRADUATE" ? "2A" : "1A",
  proposed_outcome: outcome, destination_jenjang_id: outcome === "CROSS_JENJANG" ? 2 : 1,
  destination_program_id: outcome === "CROSS_JENJANG" ? 2 : 1,
  destination_grade_id: outcome === "RETAIN" ? 1 : 2, destination_class_id: outcome === "GRADUATE" ? null : 3,
  mapping_source: outcome === "CROSS_JENJANG" ? "OPERATOR_OVERRIDE" : "GRADE_SEQUENCE",
  operator_override: outcome === "CROSS_JENJANG", reason_code: outcome === "RETAIN" ? "RETENTION_APPROVED" : null,
  reason: outcome === "RETAIN" ? "Support plan" : null, warning_codes: [], conflict_codes: [], validation_result: "VALID",
  device_linked: id !== 2, ...overrides,
});

function batch(rows = [row(1, "PROMOTE"), row(2, "RETAIN"), row(3, "GRADUATE"), row(4, "CROSS_JENJANG")]) {
  return {
    batch_id: "batch-1", source_academic_year_id: 1, destination_academic_year_id: 2, status: "PREVIEW", preview_version: 1,
    snapshot_checksum: "a".repeat(64), rows, result: null,
    summary: {
      total: rows.length, valid: rows.filter((item) => item.validation_result === "VALID").length,
      conflict: rows.filter((item) => item.validation_result === "CONFLICT").length,
      manual_review: rows.filter((item) => item.validation_result === "MANUAL_REVIEW").length,
      outcomes: Object.fromEntries(rows.map((item) => [item.proposed_outcome, 1])),
      conflicts_by_code: Object.fromEntries(rows.flatMap((item) => item.conflict_codes).map((code) => [code, 1])),
    },
  };
}

async function renderPanel(preview = batch()) {
  api.fetchAcademicYears.mockResolvedValue([
    { id: 1, label: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30", status: "active", is_default: true },
    { id: 2, label: "2027/2028", start_date: "2027-07-01", end_date: "2028-06-30", status: "upcoming", is_default: false },
  ]);
  api.fetchJenjangs.mockResolvedValue([{ id: 1, name: "Primary" }, { id: 2, name: "Secondary" }]);
  api.fetchAcademicPrograms.mockResolvedValue([{ id: 1, jenjang_id: 1, name: "Primary", active: true }, { id: 2, jenjang_id: 2, name: "Secondary", active: true }]);
  api.fetchAcademicGrades.mockResolvedValue([
    { id: 1, jenjang_id: 1, program_id: 1, name: "Grade 1", sequence_number: 1, active: true },
    { id: 2, jenjang_id: 1, program_id: 1, name: "Grade 2", sequence_number: 2, active: true },
  ]);
  api.fetchAcademicClasses.mockResolvedValue([
    { id: 1, academic_year_id: 1, grade_id: 1, class_name: "1A", section_code: "A", active: true },
    { id: 2, academic_year_id: 1, grade_id: 2, class_name: "2A", section_code: "A", active: true },
    { id: 3, academic_year_id: 2, grade_id: 2, class_name: "Next 2A", section_code: "A", active: true },
  ]);
  api.createProgressionPreview.mockResolvedValue(preview);
  api.patchProgressionRow.mockResolvedValue({ ...preview, preview_version: 2 });
  api.revalidateProgressionPreview.mockResolvedValue({ ...preview, preview_version: 2 });
  api.commitProgressionPreview.mockResolvedValue({ status: "COMMITTED", batch_id: "batch-1", preview_version: 1, applied: preview.rows.length, destination_enrollments_created: 3, graduated: 1, retained: 1, cross_jenjang: 1, withdrawn: 0, excluded: 0, skipped: 0 });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root?.render(<ProgressionPanel />); await new Promise((resolve) => setTimeout(resolve, 20)); });
  const generate = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Generate Preview")) as HTMLButtonElement;
  await act(async () => { generate.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove(); root = null; container = null; vi.clearAllMocks();
});

describe("ProgressionPanel", () => {
  it("shows all workflow steps, summary, outcomes, device readiness, and source/destination context", async () => {
    const view = await renderPanel();
    for (const label of ["Select source year", "Generate preview", "Resolve conflicts", "Assign classes", "Confirm", "View result"]) expect(view.textContent).toContain(label);
    for (const outcome of ["PROMOTE", "RETAIN", "GRADUATE", "CROSS_JENJANG"]) expect(view.textContent).toContain(outcome);
    expect(view.textContent).toContain("Device unlinked");
    expect(view.textContent).toContain("2026/2027 · 1A");
    expect(view.textContent).toContain("2027/2028");
  });

  it("renders outcome/conflict/class filters, bulk assignment, and per-row overrides", async () => {
    const conflict = row(5, "MANUAL_REVIEW", { validation_result: "CONFLICT", conflict_codes: ["DESTINATION_CLASS_REQUIRED"], destination_class_id: null });
    const view = await renderPanel(batch([row(1, "PROMOTE"), conflict]));
    expect(view.querySelector("#progression-outcome-filter")).not.toBeNull();
    expect(view.querySelector("#progression-conflict-filter")).not.toBeNull();
    expect(view.querySelector("#progression-grade-filter")).not.toBeNull();
    expect(view.querySelector("#progression-class-filter")).not.toBeNull();
    expect(view.textContent).toContain("Bulk destination class for filtered rows");
    expect(view.textContent).toContain("DESTINATION_CLASS_REQUIRED");
    expect([...view.querySelectorAll("button")].filter((button) => button.textContent === "Apply row")).toHaveLength(2);
    const confirm = [...view.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm & Apply")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("opens an accessible confirmation summary and prevents duplicate commit submission", async () => {
    const view = await renderPanel(batch([row(1, "PROMOTE")]));
    const confirm = [...view.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm & Apply")) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Apply progression batch?");
    const cancel = [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel") as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    confirm.focus();
    await act(async () => confirm.click());
    const apply = [...document.querySelectorAll("button")].find((button) => button.textContent === "Apply entire batch") as HTMLButtonElement;
    let resolveCommit: (value: unknown) => void = () => undefined;
    api.commitProgressionPreview.mockReturnValue(new Promise((resolve) => { resolveCommit = resolve; }));
    await act(async () => apply.click());
    expect((document.querySelector('[role="dialog"] button:last-of-type') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveCommit({ status: "COMMITTED", batch_id: "batch-1", preview_version: 1, applied: 1, destination_enrollments_created: 1, graduated: 0, retained: 0, cross_jenjang: 0, withdrawn: 0, excluded: 0, skipped: 0 }));
    expect(api.commitProgressionPreview).toHaveBeenCalledTimes(1);
  });

  it("shows an actionable stale-preview state without exposing backend internals", async () => {
    const view = await renderPanel(batch([row(1, "PROMOTE")]));
    api.revalidateProgressionPreview.mockRejectedValueOnce(new ApiError("database revision leaked", {
      status: 409,
      data: { detail: { code: "PROGRESSION_PREVIEW_STALE", message: "The preview changed; reload before revalidation." } },
    }));
    const revalidate = [...view.querySelectorAll("button")].find((button) => button.textContent?.includes("Revalidate")) as HTMLButtonElement;
    await act(async () => { revalidate.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(view.textContent).toContain("The preview changed; reload before revalidation.");
    expect(view.textContent).not.toContain("database revision leaked");
  });

  it("shows a safe permission-restricted state without raw backend details", async () => {
    api.createProgressionPreview.mockRejectedValueOnce(Object.assign(new Error("raw sql failure"), { status: 403, data: { detail: "raw sql failure" } }));
    const view = await renderPanel();
    expect(view.textContent).toContain("Progression action blocked");
    expect(view.textContent).not.toContain("raw sql failure");
  });
});
