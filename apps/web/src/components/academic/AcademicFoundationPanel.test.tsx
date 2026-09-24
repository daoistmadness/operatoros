import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createAcademicClass: vi.fn(),
  createAcademicGrade: vi.fn(),
  createAcademicGrades: vi.fn(),
  createAcademicJenjang: vi.fn(),
  createAcademicProgram: vi.fn(),
  fetchAcademicMasters: vi.fn(),
}));

vi.mock("../../api/academicMasters", () => api);

import { AcademicFoundationPanel } from "./AcademicFoundationPanel";
import { createTestQueryClient } from "../../lib/query/queryClient";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function renderPanel() {
  api.fetchAcademicMasters.mockResolvedValue({
    jenjangs: [
      { id: 1, code: "PRI", name: "Primary", level: "primary", active: true },
      { id: 2, code: "SEC", name: "Secondary", level: "secondary", active: true },
      { id: 3, code: "HOM", name: "Homeschooling", level: "primary", active: true },
    ],
    programs: [
      { id: 11, jenjang_id: 1, name: "Primary Program", active: true },
      { id: 22, jenjang_id: 2, name: "Secondary Program", active: true },
      { id: 33, jenjang_id: 3, name: "Home Program", active: true },
    ],
    grades: [],
    classes: [],
  });
  api.createAcademicGrades.mockImplementation(async ({ program_id, grades }) => grades.map((grade: { name: string; sequence_number: number }, index: number) => ({
    id: index + 1, jenjang_id: program_id === 22 ? 2 : program_id === 33 ? 3 : 1, program_id,
    ...grade, active: true, created_at: "2026-09-23", updated_at: "2026-09-23",
  })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = createTestQueryClient();
  const invalidation = vi.spyOn(queryClient, "invalidateQueries");
  const onChanged = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}><AcademicFoundationPanel academicYears={[]} onChanged={onChanged} /></QueryClientProvider>);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { view: container, invalidation, onChanged };
}

async function selectValue(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function setGradeLines(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("AcademicFoundationPanel quick grade setup", () => {
  it("fills editable presets and creates ordered custom grades with one mutation", async () => {
    const { view, invalidation, onChanged } = await renderPanel();
    const preset = view!.querySelector("#quick-grade-preset") as HTMLSelectElement;
    const lines = view!.querySelector("#quick-grade-lines") as HTMLTextAreaElement;

    await selectValue(preset, "PRIMARY");
    expect(lines.value).toBe("P1\nP2\nP3\nP4\nP5\nP6");
    await selectValue(preset, "SECONDARY");
    expect(lines.value).toBe("S1\nS2\nS3");
    await selectValue(preset, "HOMESCHOOLING_PRIMARY");
    expect(lines.value).toBe("HSP1\nHSP2\nHSP3\nHSP4\nHSP5\nHSP6");

    await selectValue(preset, "CUSTOM");
    await setGradeLines(lines, "Custom A\n\nCustom B");
    expect(Array.from(view!.querySelectorAll('[aria-label="Grade sequence preview"] li')).map((item) => item.textContent?.trim())).toEqual(["1Custom A", "2Custom B"]);
    await selectValue(view!.querySelector("#quick-grade-program") as HTMLSelectElement, "22");
    const create = Array.from(view!.querySelectorAll("button")).find((button) => button.textContent === "Create 2 grades") as HTMLButtonElement;
    await act(async () => {
      create.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.createAcademicGrades).toHaveBeenCalledTimes(1);
    expect(api.createAcademicGrades).toHaveBeenCalledWith({
      program_id: 22,
      grades: [{ name: "Custom A", sequence_number: 1 }, { name: "Custom B", sequence_number: 2 }],
    });
    expect(invalidation).toHaveBeenCalledTimes(5);
    expect(invalidation.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["readiness"], ["academic-masters", "grades"], ["academic-masters", "class-reference"], ["analytics", "filters"], ["analytics", "academic"],
    ]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(view!.textContent).toContain("2 grades were added to Secondary Program.");
  });

  it("ignores blank lines and blocks empty or duplicate grade lists", async () => {
    const { view } = await renderPanel();
    const lines = view!.querySelector("#quick-grade-lines") as HTMLTextAreaElement;
    const create = () => Array.from(view!.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Create ")) as HTMLButtonElement;

    expect(create().disabled).toBe(true);
    await setGradeLines(lines, "P1\n\nP2\n");
    expect(view!.querySelectorAll('[aria-label="Grade sequence preview"] li')).toHaveLength(2);
    expect(create().disabled).toBe(false);
    await setGradeLines(lines, "P1\nP1");
    expect(view!.querySelector('[role="alert"]')?.textContent).toContain("Remove duplicate grade names");
    expect(create().disabled).toBe(true);
    expect(api.createAcademicGrades).not.toHaveBeenCalled();
  });
});
