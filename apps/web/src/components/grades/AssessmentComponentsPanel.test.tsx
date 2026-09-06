import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import AssessmentComponentsPanel from "./AssessmentComponentsPanel";

const subject = { id: 7, name: "Mathematics", jenjang_id: 1, supports_sumatif: true, supports_formatif: true };

function mount(node: React.ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

describe("AssessmentComponentsPanel", () => {
  it("explains the empty state and creates a subject component", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container, root } = mount(<AssessmentComponentsPanel components={[]} subject={subject} onCreate={onCreate} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    expect(container.textContent).toContain("This assessment has no components yet.");
    const input = container.querySelector("#assessment-component-name") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Midterm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onCreate).toHaveBeenCalledWith({ name: "Midterm", assessment_type: "sumatif", subject_id: 7 });
    root.unmount();
    container.remove();
  });

  it("edits and deletes only subject-owned components", async () => {
    const component = { id: 3, name: "Quiz", assessment_type: "formatif" as const, subject_id: 7 };
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    window.confirm = vi.fn().mockReturnValue(true);
    const { container, root } = mount(<AssessmentComponentsPanel components={[component]} subject={subject} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={onDelete} />);
    (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Edit")) as HTMLButtonElement).click();
    const input = container.querySelector("#assessment-component-name") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Quiz revised");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(3, { name: "Quiz revised", assessment_type: "formatif" });
    await act(async () => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Delete")) as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledWith(3);
    root.unmount();
    container.remove();
  });
});
