import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredChart } from "./DeferredChart";

class MockIntersectionObserver {
  static current: MockIntersectionObserver;
  target: Element | null = null;
  callback: IntersectionObserverCallback;
  disconnect = vi.fn();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.current = this;
  }

  observe(target: Element) {
    this.target = target;
  }

  triggerVisible() {
    if (!this.target) throw new Error("Expected DeferredChart to be observed");
    this.callback([{ target: this.target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

describe("DeferredChart", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the chart when its container approaches the viewport", async () => {
    await act(async () => root.render(<DeferredChart><span>Chart</span></DeferredChart>));
    expect(container.textContent).toBe("");

    await act(async () => MockIntersectionObserver.current.triggerVisible());
    expect(container.textContent).toBe("Chart");
  });

  it("renders immediately when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await act(async () => root.render(<DeferredChart><span>Chart</span></DeferredChart>));
    expect(container.textContent).toBe("Chart");
  });

  it("keeps the caller-provided chart height", async () => {
    await act(async () => root.render(<DeferredChart className="h-56"><span>Chart</span></DeferredChart>));
    expect(container.firstElementChild?.className).toContain("h-56");
    expect(container.firstElementChild?.className).not.toContain("h-[300px]");
  });
});
