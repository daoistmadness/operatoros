import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ReadinessItem } from "@operatoros/contracts/readiness";
import { FeatureReadinessCard, ReadinessChecklist } from "./ReadinessChecklist";

const item = (state: ReadinessItem["state"], key: ReadinessItem["key"] = "jenjang"): ReadinessItem => ({
  key,
  label: key === "jenjang" ? "Programs / Jenjang" : "School calendar",
  state,
  summary: state === "ACTION_REQUIRED" ? "No active canonical program is configured." : "Configured.",
  actions: state === "ACTION_REQUIRED" ? [{ code: "configure_jenjang", label: "Configure programs / jenjang", route: "/academic-management?tab=foundation" }] : [],
});

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<MemoryRouter>{node}</MemoryRouter>));
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ReadinessChecklist", () => {
  it("keeps readiness states visible as text and exposes canonical actions", async () => {
    const view = await render(<ReadinessChecklist items={[item("READY"), item("ACTION_REQUIRED", "academic_year"), item("BLOCKED", "academic_periods"), item("ERROR", "classes"), item("NOT_APPLICABLE", "calendar")]} />);
    expect(view.textContent).toContain("Ready");
    expect(view.textContent).toContain("Action required");
    expect(view.textContent).toContain("Blocked");
    expect(view.textContent).toContain("Unavailable");
    expect(view.textContent).toContain("Not applicable");
    expect(view.querySelector('a[href="/academic-management?tab=foundation"]')?.textContent).toContain("Configure programs / jenjang");
  });

  it("shows a feature blocker without turning it into an automatic action", async () => {
    const view = await render(<FeatureReadinessCard feature={{ key: "MACHINE_IMPORT", label: "Machine Import", route: "/attendance/machine-import", state: "BLOCKED", blockers: ["jenjang"], actions: [{ code: "configure_jenjang", label: "Configure programs / jenjang", route: "/academic-management?tab=foundation" }] }} />);
    expect(view.textContent).toContain("Blocked");
    expect(view.textContent).toContain("Programs / Jenjang");
    expect(view.querySelector('a[href="/attendance/machine-import"]')).toBeNull();
  });
});
