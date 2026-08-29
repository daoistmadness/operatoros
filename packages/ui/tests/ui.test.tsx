import { Window } from "happy-dom";
import { act } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

const browser = new Window();
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Element: browser.Element,
  Document: browser.Document,
  HTMLElement: browser.HTMLElement,
  Node: browser.Node,
  Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent,
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  getComputedStyle: browser.getComputedStyle.bind(browser),
});

const { Button } = await import("../src/components/button");
const { Card } = await import("../src/components/card");
const { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } = await import("../src/components/dialog");
const { Input } = await import("../src/components/input");

const mounts: Array<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounts.push({ container, root });
  await act(async () => root.render(element));
  return container;
}

afterEach(async () => {
  for (const { root, container } of mounts.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.replaceChildren();
});

afterAll(() => browser.close());

describe("Base UI foundation", () => {
  test("forwards button attributes and merges classes", async () => {
    const container = await render(<Button className="test-button" disabled>Save</Button>);
    const button = container.querySelector("button");

    expect(button?.textContent).toBe("Save");
    expect(button?.disabled).toBe(true);
    expect(button?.className).toContain("test-button");
    expect(button?.dataset.slot).toBe("button");
  });

  test("forwards an input ref", async () => {
    const ref = React.createRef<HTMLInputElement>();
    const container = await render(<Input ref={ref} aria-label="Search" />);

    expect(ref.current).toBe(container.querySelector("input"));
    expect(ref.current?.getAttribute("aria-label")).toBe("Search");
  });

  test("provides a reusable card surface", async () => {
    const container = await render(<Card className="test-card">Summary</Card>);
    const card = container.querySelector("[data-slot='card']");

    expect(card?.textContent).toBe("Summary");
    expect(card?.className).toContain("test-card");
  });

  test("supports keyboard focus and opens and closes a dialog", async () => {
    const container = await render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = container.querySelector("[data-slot='dialog-trigger']") as HTMLElement;

    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    const close = document.querySelector("[data-slot='dialog-close']") as HTMLElement;
    await act(async () => close.click());
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
