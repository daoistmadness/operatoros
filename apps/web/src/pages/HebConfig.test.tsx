import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("../api", () => ({ default: api }));

import HebConfig from "./HebConfig";

describe("HEB configuration authorship", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.get.mockImplementation(async (path: string) => ({
      data: path === "/api/config/jenjang/available"
        ? { jenjang_list: ["SMP"] }
        : { heb_by_jenjang: [{ jenjang: "SMP", heb: 10, auto_heb: 10, source: "auto" }] },
      status: 200,
      headers: {},
    }));
    api.put.mockResolvedValue({ data: {}, status: 200, headers: {} });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("does not ask for or submit a client-authored set_by value", async () => {
    await act(async () => root.render(<HebConfig />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const setOverride = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Set Override"));
    expect(setOverride).toBeTruthy();
    await act(async () => setOverride?.click());
    expect(host.textContent).toContain("HEB Override — SMP — Januari");
    expect(host.textContent).not.toContain("Set by");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan Override"))?.click());
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("/api/config/heb/SMP/2026/1", { heb_value: 10, note: "" });
  });
});
