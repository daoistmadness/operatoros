import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ChartContainer } from "./ChartContainer";

describe("ChartContainer", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
  });

  async function render(element: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(element));
    return container;
  }

  it("exposes the ready chart as an image with a text alternative", async () => {
    const view = await render(<ChartContainer state="ready" ariaLabel="Status counts"><svg /></ChartContainer>);

    expect(view.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Status counts");
    expect(view.querySelector("svg")).toBeTruthy();
  });

  it("announces loading, empty, and error states with appropriate roles", async () => {
    const view = await render(<ChartContainer state="loading" />);
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");

    await act(async () => root.render(<ChartContainer state="empty" message="No recorded attendance." />));
    expect(view.querySelector('[role="status"]')?.textContent).toBe("No recorded attendance.");

    await act(async () => root.render(<ChartContainer state="error" message="Chart could not be loaded." />));
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("Chart could not be loaded.");
  });
});
