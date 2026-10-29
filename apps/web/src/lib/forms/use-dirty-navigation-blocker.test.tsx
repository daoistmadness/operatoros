import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useRouter } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDirtyNavigationBlocker } from "./use-dirty-navigation-blocker";

function DirtyPage() {
  const router = useRouter();
  const [isDirty, setIsDirty] = useState(false);
  useDirtyNavigationBlocker({ isDirty, message: "Leave with unsaved changes?" });

  return (
    <main>
      <p>Dirty page</p>
      <button type="button" onClick={() => setIsDirty(true)}>Make changes</button>
      <button type="button" onClick={() => router.history.push("/next")}>Navigate</button>
      <button type="button" onClick={() => router.history.push(`${router.state.location.pathname}#details`)}>Change hash</button>
      <p>Current hash: {router.state.location.hash}</p>
    </main>
  );
}

function BrowserTestRouter() {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/dirty", component: DirtyPage }),
      createRoute({ getParentRoute: () => rootRoute, path: "/next", component: () => <p>Next page</p> }),
    ]);
    const history = createBrowserHistory();
    history.replace("/dirty");
    return createRouter({ routeTree, history });
  });

  return <RouterProvider router={router} />;
}

describe("dirty form navigation blocker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let confirm: ReturnType<typeof vi.fn>;
  let previousConfirm: typeof window.confirm;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    previousConfirm = window.confirm;
    confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await act(async () => root.render(<BrowserTestRouter />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
    if (previousConfirm) Object.defineProperty(window, "confirm", { configurable: true, value: previousConfirm });
    else Reflect.deleteProperty(window, "confirm");
    vi.restoreAllMocks();
  });

  async function click(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === label);
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  it("blocks route and hash navigation and registers before-unload protection", async () => {
    await click("Make changes");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    await click("Navigate");
    expect(confirm).toHaveBeenCalledWith("Leave with unsaved changes?");
    expect(host.textContent).toContain("Dirty page");
    expect(host.textContent).not.toContain("Next page");

    confirm.mockClear();
    await click("Change hash");
    expect(confirm).toHaveBeenCalledWith("Leave with unsaved changes?");
    expect(host.textContent).toContain("Current hash:");
    expect(host.textContent).not.toContain("Current hash: details");

    confirm.mockReturnValue(true);
    await click("Navigate");
    expect(host.textContent).toContain("Next page");
  });
});
