import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadinessResponse } from "../../api/readiness";
import { SetupOverview } from "./SetupOverview";

const steps: ReadinessResponse["steps"] = [
  { code: "academic_year", name: "Configure an academic year", status: "NOT_STARTED", requirement: "REQUIRED", reason: "Academic context is required.", destination: "/academic-management", can_manage: true, responsibility: null },
  { code: "students", name: "Add or import students", status: "NOT_STARTED", requirement: "REQUIRED", reason: "Students are required.", destination: "/upload", can_manage: true, responsibility: null },
  { code: "enrollment", name: "Assign students to active classes", status: "NOT_STARTED", requirement: "REQUIRED", reason: "Enrollment is required.", destination: "/enrollment", can_manage: true, responsibility: null },
  { code: "academic_terms", name: "Configure academic periods", status: "NOT_STARTED", requirement: "WORKFLOW", reason: "Terms enable grades.", destination: "/academic-management", can_manage: true, responsibility: null },
  { code: "attendance", name: "Record or import attendance", status: "NOT_STARTED", requirement: "RECOMMENDED", reason: "Attendance enables analytics.", destination: "/upload", can_manage: true, responsibility: null },
  { code: "cutoff_jenjang", name: "Review Cutoff Jenjang overrides", status: "OPTIONAL", requirement: "OPTIONAL", reason: "Automatic fallback remains active.", destination: "/config/jenjang", can_manage: true, responsibility: null },
];

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function renderOverview(props: Partial<React.ComponentProps<typeof SetupOverview>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<MemoryRouter><SetupOverview data={{ overall_status: "FIRST_RUN", steps }} isLoading={false} isError={false} onRetry={vi.fn()} {...props} /></MemoryRouter>));
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SetupOverview", () => {
  it("shows readiness loading without incomplete claims", async () => {
    const view = await renderOverview({ data: undefined, isLoading: true });
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Checking setup readiness");
    expect(view.textContent).not.toContain("Initial setup is required");
  });

  it("distinguishes request failure and provides retry", async () => {
    const retry = vi.fn();
    const view = await renderOverview({ data: undefined, isError: true, onRetry: retry });
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("has not been classified as incomplete");
    await act(async () => (view.querySelector("button") as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    ["FIRST_RUN", "Initial setup is required"],
    ["SETUP_PARTIAL", "Setup is in progress"],
    ["READY_WITH_RECOMMENDATIONS", "Core setup is ready"],
    ["OPERATIONALLY_READY", "OperatorOS is ready"],
    ["READ_ONLY_GUIDANCE", "Setup needs administrator attention"],
  ] as const)("renders the %s state", async (overall_status, title) => {
    const view = await renderOverview({ data: { overall_status, steps } });
    expect(view.querySelector("h2")?.textContent).toBe(title);
  });

  it("orders dependencies and distinguishes requirement types", async () => {
    const view = await renderOverview();
    const items = [...view.querySelectorAll("li")];
    expect(items).toHaveLength(6);
    expect(items[0].textContent).toContain("Configure an academic year");
    expect(items[2].textContent).toContain("Assign students to active classes");
    expect(items[3].textContent).toContain("WORKFLOW");
    expect(items[4].textContent).toContain("RECOMMENDED");
    expect(items[5].textContent).toContain("OPTIONAL");
  });

  it("renders completion text as well as an icon", async () => {
    const view = await renderOverview({ data: { overall_status: "SETUP_PARTIAL", steps: [{ ...steps[0], status: "COMPLETE" }, ...steps.slice(1)] } });
    expect(view.textContent).toContain("Complete");
    expect(view.querySelector('[aria-label="Complete"]')).not.toBeNull();
  });

  it("removes mutation actions for restricted required steps", async () => {
    const restricted = steps.map((step) => ({ ...step, destination: step.requirement === "REQUIRED" ? null : step.destination, can_manage: false, responsibility: "An administrator can complete this step." }));
    const view = await renderOverview({ data: { overall_status: "READ_ONLY_GUIDANCE", steps: restricted } });
    expect(view.textContent).not.toContain("Continue setup");
    expect(view.textContent?.match(/An administrator can complete this step\./g)).toHaveLength(6);
  });

  it("uses responsive full-width actions at narrow layouts", async () => {
    const view = await renderOverview();
    expect(view.querySelector("a")?.className).toContain("w-full");
    expect(view.querySelector("a")?.className).toContain("sm:w-auto");
  });
});
