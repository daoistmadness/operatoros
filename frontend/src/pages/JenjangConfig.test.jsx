import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import api from "../api";
import { AuthContext } from "../context/AuthContext";
import JenjangConfig, { getJenjangConfigError, normalizeJenjangPayload } from "./JenjangConfig";

vi.mock("../api", () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const admin = { user: { id: 1, username: "admin", role: "admin", capabilities: [] }, loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn() };
const staff = { ...admin, user: { id: 2, username: "staff", role: "staff", capabilities: [] }, can: () => false };
const completeConfig = { configured: [{ jenjang: "Primary", cutoff_time: "07:00", updated_at: null }], unconfigured: [] };
const available = { jenjang_list: ["Primary"] };
let container;
let root;

function mockLoad(config = completeConfig, options = available) {
  api.get.mockImplementation((path) => Promise.resolve({ data: path.endsWith("/available") ? options : config }));
}

async function renderPage(auth = admin) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><AuthContext.Provider value={auth}><JenjangConfig /></AuthContext.Provider></MemoryRouter>));
  return container;
}

async function click(element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("JenjangConfig", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad(); });
  afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });

  it("renders an accessible initial loading state", async () => {
    api.get.mockReturnValue(new Promise(() => {}));
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
    api.get.mockRejectedValue({ response: { status: 500, data: { detail: "SQLSTATE private internals" } } });
    const view = await renderPage();
    expect(view.textContent).toContain("Konfigurasi tidak dapat dimuat");
    expect(view.textContent).toContain("Coba Lagi");
    expect(view.textContent).not.toContain("SQLSTATE");
  });

  it("shows permission restriction for a denied read", async () => {
    api.get.mockRejectedValue({ response: { status: 403, data: { detail: "internal role" } } });
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
    await click([...view.querySelectorAll("button")].find((button) => button.textContent.includes("Ubah")));
    const save = [...view.querySelectorAll("button")].find((button) => button.textContent.includes("Simpan"));
    expect(save.disabled).toBe(true);
    expect(save.title).toContain("Ubah waktu cutoff");
  });

  it("refetches authoritative data after a successful save", async () => {
    const view = await renderPage();
    await click([...view.querySelectorAll("button")].find((button) => button.textContent.includes("Ubah")));
    const input = view.querySelector('input[type="time"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "07:15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mockLoad({ configured: [{ jenjang: "Primary", cutoff_time: "07:15", updated_at: null }], unconfigured: [] });
    api.put.mockResolvedValue({ data: { jenjang: "Primary", cutoff_time: "07:15" } });
    const save = [...view.querySelectorAll("button")].find((button) => button.textContent.includes("Simpan"));
    await click(save);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(4);
    expect(view.textContent).toContain("berhasil disimpan");
  });

  it("prevents duplicate save submission while a request is pending", async () => {
    const view = await renderPage();
    await click([...view.querySelectorAll("button")].find((button) => button.textContent.includes("Ubah")));
    const input = view.querySelector('input[type="time"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "07:20"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    api.put.mockReturnValue(new Promise(() => {}));
    const save = [...view.querySelectorAll("button")].find((button) => button.textContent.includes("Simpan"));
    await act(async () => { save.click(); save.click(); });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(save.disabled).toBe(true);
  });

  it("explains deletion as cutoff fallback rather than master deletion", async () => {
    const view = await renderPage();
    await click([...view.querySelectorAll("button")].find((button) => button.textContent.includes("Hapus")));
    expect(view.textContent).toContain("Data historis tidak dihapus");
  });
});

describe("Jenjang Config contracts", () => {
  it("rejects malformed and duplicate definitions", () => {
    expect(() => normalizeJenjangPayload({}, available)).toThrow("INVALID_CONFIG_RESPONSE");
    expect(() => normalizeJenjangPayload({ configured: [completeConfig.configured[0], completeConfig.configured[0]], unconfigured: [] }, available)).toThrow("DUPLICATE_CONFIG_ITEM");
  });

  it("sanitizes validation, conflict, permission, and server failures", () => {
    expect(getJenjangConfigError({ response: { status: 422, data: { detail: "raw" } } }, "fallback")).not.toContain("raw");
    expect(getJenjangConfigError({ response: { status: 409 } }, "fallback")).toContain("berubah di server");
    expect(getJenjangConfigError({ response: { status: 403 } }, "fallback")).toContain("tidak memiliki izin");
    expect(getJenjangConfigError({ response: { status: 500, data: { detail: "SQL" } } }, "fallback")).not.toContain("SQL");
  });
});
