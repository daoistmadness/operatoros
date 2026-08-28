import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import api from "../../../api";
import { AuthContext, type AuthContextValue } from "../../../context/AuthContext";
import JenjangConfig, {
  getJenjangConfigError,
  normalizeJenjangPayload,
  type AvailableJenjangPayload,
  type JenjangConfigPayload,
} from "./JenjangConfig";

vi.mock("../../../api", () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const admin: AuthContextValue = { user: { id: 1, username: "admin", role: "admin", capabilities: [] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const staff: AuthContextValue = { ...admin, user: { id: 2, username: "staff", role: "staff", capabilities: [] }, can: () => false };
const completeConfig: JenjangConfigPayload = { configured: [{ jenjang: "Primary", cutoff_time: "07:00", updated_at: null }], unconfigured: [] };
const available: AvailableJenjangPayload = { jenjang_list: ["Primary"] };
let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mockLoad(config: JenjangConfigPayload = completeConfig, options: AvailableJenjangPayload = available) {
  vi.mocked(api.get).mockImplementation((path: string) =>
    Promise.resolve({ data: path.endsWith("/available") ? options : config, status: 200, headers: {} }) as never
  );
}

async function renderPage(auth: AuthContextValue = admin): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<MemoryRouter><AuthContext.Provider value={auth}><JenjangConfig /></AuthContext.Provider></MemoryRouter>));
  return container;
}

async function click(element: HTMLElement | undefined) {
  if (!element) throw new Error("Expected clickable element.");
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("JenjangConfig", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad(); });
  afterEach(async () => {
    const activeRoot = root;
    if (activeRoot) await act(async () => activeRoot.unmount());
    container?.remove();
  });

  it("renders an accessible initial loading state", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const view = await renderPage();
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Memuat konfigurasi");
  });

  it("reports complete configuration without claiming unrelated readiness", async () => {
    const view = await renderPage();
    expect(view.textContent).toContain("Konfigurasi lengkap");
    expect(view.textContent).not.toContain("Everything is ready");
  });

  it("shows permission-aware setup guidance when no student jenjang exists", async () => {
    mockLoad({ configured: [], unconfigured: [] }, { jenjang_list: [] });
    const adminView = await renderPage();
    expect(adminView.textContent).toContain("Buka Data Siswa");
  });

  it("shows specific incomplete jenjang names", async () => {
    mockLoad({ configured: [], unconfigured: ["Primary"] });
    const view = await renderPage();
    expect(view.textContent).toContain("Konfigurasi belum lengkap");
    expect(view.textContent).toContain("Primary");
  });

  it("treats inconsistent partial responses as a warning and disables save", async () => {
    mockLoad({ configured: completeConfig.configured, unconfigured: ["Primary"] });
    const view = await renderPage();
    expect(view.textContent).toContain("Daftar status dari server tidak konsisten");
  });

  it("shows a sanitized blocking error and retry", async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 500, data: { detail: "SQLSTATE private internals" } } });
    const view = await renderPage();
    expect(view.textContent).toContain("Konfigurasi tidak dapat dimuat");
    expect(view.textContent).toContain("Coba Lagi");
    expect(view.textContent).not.toContain("SQLSTATE");
  });

  it("shows permission restriction for a denied read", async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 403, data: { detail: "internal role" } } });
    const view = await renderPage();
    expect(view.textContent).toContain("Akses konfigurasi dibatasi");
    expect(view.textContent).not.toContain("internal role");
  });

  it("renders read-only guidance without mutation controls for staff", async () => {
    const view = await renderPage(staff);
    expect(view.textContent).toContain("Anda memiliki akses baca");
    expect(view.textContent).not.toContain("Ubah");
    expect(view.textContent).not.toContain("Hapus");
  });

  it("keeps Save disabled until the cutoff changes", async () => {
    const view = await renderPage();
    await click(Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Ubah")));
    const save = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan"));
    if (!save) throw new Error("Expected save button.");
    expect(save.disabled).toBe(true);
    expect(save.title).toContain("Ubah waktu cutoff");
  });

  it("refetches authoritative data after a successful save", async () => {
    const view = await renderPage();
    await click(Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Ubah")));
    const input = view.querySelector<HTMLInputElement>('input[type="time"]');
    if (!input) throw new Error("Expected cutoff input.");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Expected input value setter.");
      setter.call(input, "07:15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mockLoad({ configured: [{ jenjang: "Primary", cutoff_time: "07:15", updated_at: null }], unconfigured: [] });
    vi.mocked(api.put).mockResolvedValue({ data: { jenjang: "Primary", cutoff_time: "07:15" }, status: 200, headers: {} } as never);
    const save = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan"));
    await click(save);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(4);
    expect(view.textContent).toContain("berhasil disimpan");
  });

  it("prevents duplicate save submission while a request is pending", async () => {
    const view = await renderPage();
    await click(Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Ubah")));
    const input = view.querySelector<HTMLInputElement>('input[type="time"]');
    if (!input) throw new Error("Expected cutoff input.");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Expected input value setter.");
      setter.call(input, "07:20"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(api.put).mockReturnValue(new Promise(() => {}));
    const save = Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Simpan"));
    if (!save) throw new Error("Expected save button.");
    await act(async () => { save.click(); save.click(); });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(save.disabled).toBe(true);
  });

  it("explains deletion as cutoff fallback rather than master deletion", async () => {
    const view = await renderPage();
    await click(Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("Hapus")));
    expect(view.textContent).toContain("Data historis tidak dihapus");
  });
});

describe("Jenjang Config contracts", () => {
  it("rejects malformed and duplicate definitions", () => {
    expect(() => normalizeJenjangPayload(Object.create(null), available)).toThrow("INVALID_CONFIG_RESPONSE");
    expect(() => normalizeJenjangPayload({ configured: [completeConfig.configured[0], completeConfig.configured[0]], unconfigured: [] }, available)).toThrow("DUPLICATE_CONFIG_ITEM");
  });

  it("sanitizes validation, conflict, permission, and server failures", () => {
    expect(getJenjangConfigError({ response: { status: 422, data: { detail: "raw" } } }, "fallback")).not.toContain("raw");
    expect(getJenjangConfigError({ response: { status: 409 } }, "fallback")).toContain("berubah di server");
    expect(getJenjangConfigError({ response: { status: 403 } }, "fallback")).toContain("tidak memiliki izin");
    expect(getJenjangConfigError({ response: { status: 500, data: { detail: "SQL" } } }, "fallback")).not.toContain("SQL");
  });
});
