import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetListResponseDto, AssetDtoType } from "@operatoros/contracts/inventory";
import * as api from "../api/inventory";
import * as staffApi from "../api/staff";
import { createTestQueryClient } from "../lib/query/queryClient";
import InventoryManagement from "./InventoryManagement";
import { AuthContext } from "../context/AuthContext";

vi.mock("../api/inventory", () => ({
  fetchAssets: vi.fn(),
  fetchInventoryMasterData: vi.fn(),
  createAssetCategory: vi.fn(),
  createFundingSource: vi.fn(),
  updateAssetCategory: vi.fn(),
  updateFundingSource: vi.fn(),
  reorderAssetCategories: vi.fn(),
  reorderFundingSources: vi.fn(),
  deleteAssetCategory: vi.fn(),
  deleteFundingSource: vi.fn(),
  fetchInventorySummary: vi.fn(),
  fetchAsset: vi.fn(),
  createAsset: vi.fn(),
  batchCreateAssets: vi.fn(),
  updateAsset: vi.fn(),
  retireAsset: vi.fn(),
  previewLabels: vi.fn(),
  downloadLabelsPdf: vi.fn(),
  downloadCalibrationPdf: vi.fn(),
  fetchLabelTemplates: vi.fn(),
  downloadInventoryXlsx: vi.fn(),
}));

vi.mock("../api/staff", () => ({
  fetchSchoolUnits: vi.fn(),
}));

const sampleAssets: AssetDtoType[] = [
  {
    id: "ast_1",
    asset_code: "SD-IT-0001",
    school_unit_id: 1,
    school_unit_name: "SD Edelweiss",
    current_unit_id: 1,
    current_unit_name: "SD Edelweiss",
    category: "IT",
    category_name: "Peralatan TI / Komputer",
    item_name: "Laptop Asus Guru",
    brand: "ASUS",
    model: "Vivobook",
    serial_number: "SN123",
    location: "Ruang Guru",
    funding_source: "BOS",
    funding_source_name: "BOS (ARKAS)",
    budget_year: 2026,
    arkas_account_code: "5.1.02.01.01.0024",
    purchase_document_reference: "INV-001",
    acquisition_date: "2026-02-01",
    price: 8500000,
    condition: "BAIK",
    status: "ACTIVE",
    retired_at: null,
    retired_reason: null,
    notes: "Pengadaan tahap 1",
    created_at: "2026-02-01T08:00:00Z",
    updated_at: "2026-02-01T08:00:00Z",
  },
  {
    id: "ast_2",
    asset_code: "SD-FRN-0001",
    school_unit_id: 1,
    school_unit_name: "SD Edelweiss",
    current_unit_id: 1,
    current_unit_name: "SD Edelweiss",
    category: "FRN",
    category_name: "Furnitur / Mebel",
    item_name: "Meja Guru Kayu Jati",
    brand: "Informa",
    model: null,
    serial_number: null,
    location: "Ruang 1A",
    funding_source: "YAYASAN",
    funding_source_name: "Yayasan",
    budget_year: 2025,
    arkas_account_code: null,
    purchase_document_reference: null,
    acquisition_date: "2025-07-01",
    price: 1200000,
    condition: "BAIK",
    status: "ACTIVE",
    retired_at: null,
    retired_reason: null,
    notes: null,
    created_at: "2025-07-01T08:00:00Z",
    updated_at: "2025-07-01T08:00:00Z",
  },
];

const mockAssetList: AssetListResponseDto = {
  items: sampleAssets,
  total: 2,
  limit: 50,
  offset: 0,
};

const mockMasterData = {
  categories: [
    { code: "IT", name: "Peralatan TI / Komputer", is_active: true, sort_order: 0, can_delete: false },
    { code: "FRN", name: "Furnitur / Mebel", is_active: true, sort_order: 1, can_delete: false },
    { code: "CUS", name: "Peralatan Khusus", is_active: true, sort_order: 2, can_delete: true },
  ],
  funding_sources: [
    { code: "BOS", name: "BOS (ARKAS)", is_active: true, sort_order: 0, can_delete: false },
    { code: "YAYASAN", name: "Yayasan", is_active: true, sort_order: 1, can_delete: false },
    { code: "CUSTOM_0123456789ABCDEF0123456789ABCDEF", name: "Dana Sponsor Lokal", is_active: true, sort_order: 2, can_delete: true },
  ],
};

const mockSchoolUnits = [
  { id: 1, name: "SD Edelweiss", status: "ACTIVE" as const, version: 1, created_at: "", updated_at: "" },
  { id: 2, name: "SMP Edelweiss", status: "ACTIVE" as const, version: 1, created_at: "", updated_at: "" },
];

const mockAuthValue: any = {
  authenticated: true,
  user: {
    id: 1,
    username: "admin",
    role: "admin",
    capabilities: ["view_inventory", "manage_inventory", "export_inventory"],
  },
  can: (cap: string) => true,
  loading: false,
};

const queryClient = createTestQueryClient();
let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("InventoryManagement Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    vi.mocked(api.fetchAssets).mockResolvedValue(mockAssetList);
    vi.mocked(api.fetchInventoryMasterData).mockResolvedValue(mockMasterData);
    vi.mocked(api.fetchInventorySummary).mockResolvedValue({
      total_assets: 2,
      total_value: 9700000,
      active_count: 2,
      retired_count: 0,
      by_condition: { baik: 2, rusak_ringan: 0, rusak_berat: 0 },
      by_category: [{ category: "IT", category_name: "Peralatan TI / Komputer", count: 1 }, { category: "FRN", category_name: "Furnitur / Mebel", count: 1 }],
      by_funding: [{ funding_source: "BOS", funding_source_name: "BOS (ARKAS)", count: 1 }, { funding_source: "YAYASAN", funding_source_name: "Yayasan", count: 1 }],
      by_unit: [{ unit_id: 1, unit_name: "SD Edelweiss", count: 2 }],
    });
    vi.mocked(staffApi.fetchSchoolUnits).mockResolvedValue(mockSchoolUnits);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
  });

  it("renders asset list table and header metrics", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });

    await flush();

    expect(container.textContent).toContain("Inventaris & Label Aset");
    expect(container.textContent).toContain("SD-IT-0001");
    expect(container.textContent).toContain("Laptop Asus Guru");
    expect(container.textContent).toContain("SD-FRN-0001");
    expect(container.textContent).toContain("Meja Guru Kayu Jati");
    expect(container.textContent).toContain("Tambah Aset");
    expect(container.textContent).toContain("Tambah Massal");
    expect(container.textContent).toContain("Cetak Label");
    expect(container.textContent).toContain("Ekspor Excel");
  });

  it("opens single asset registration modal when clicking Tambah Aset", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });

    await flush();

    const addBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Tambah Aset"),
    );
    expect(addBtn).toBeDefined();

    await act(async () => {
      addBtn?.click();
    });

    await flush();

    expect(document.body.textContent).toContain("Tambah Aset Baru");
    expect(document.body.textContent).toContain("Nomor kode aset unik akan otomatis dialokasikan");
    expect((document.querySelector("#reg-cat option[value='CUS']") as HTMLOptionElement)?.textContent).toBe("Peralatan Khusus");
  });

  it("opens master management without losing the registration draft", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });
    await flush();

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Tambah Aset"))?.click();
    });
    await flush();

    const itemName = document.querySelector("#reg-name") as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(itemName, "Draft laptop");
      itemName.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Kelola")?.click();
    });
    await flush();
    expect(document.body.textContent).toContain("Kelola Data Inventaris");
    expect(document.body.textContent).toContain("Kategori Aset");
    expect(document.body.textContent).toContain("Sumber Dana");

    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Tutup")?.click();
    });
    await flush();

    expect(document.body.textContent).not.toContain("Kelola Data Inventaris");
    expect((document.querySelector("#reg-name") as HTMLInputElement)?.value).toBe("Draft laptop");
  });

  it("refreshes active dropdown options after creating a master entry", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });
    await flush();

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Tambah Aset"))?.click();
    });
    await flush();
    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Kelola")?.click();
    });
    await flush();

    const newEntry = { code: "NEW", name: "Peralatan Baru", is_active: true, sort_order: 3, can_delete: true };
    vi.mocked(api.createAssetCategory).mockResolvedValue(newEntry);
    vi.mocked(api.fetchInventoryMasterData).mockResolvedValueOnce({
      ...mockMasterData,
      categories: [...mockMasterData.categories, newEntry],
    });
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(document.querySelector("[aria-label='Kode kategori baru']") as HTMLInputElement, "new");
      setValue(document.querySelector("[aria-label='Nama kategori baru']") as HTMLInputElement, "Peralatan Baru");
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Tambah")?.click();
    });
    await flush();
    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Tutup")?.click();
    });
    await flush();

    expect((document.querySelector("#reg-cat option[value='NEW']") as HTMLOptionElement)?.textContent).toBe("Peralatan Baru");
  });

  it("opens batch asset registration modal when clicking Tambah Massal", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });

    await flush();

    const batchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Tambah Massal"),
    );
    expect(batchBtn).toBeDefined();

    await act(async () => {
      batchBtn?.click();
    });

    await flush();

    expect(document.body.textContent).toContain("Pendaftaran Aset Massal (Batch)");
    expect(document.body.textContent).toContain("Jumlah Unit (1-100)");
  });

  it("opens label printing modal and displays templates and sticker slots", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={mockAuthValue}>
            <InventoryManagement />
          </AuthContext.Provider>
        </QueryClientProvider>,
      );
    });

    await flush();

    const printBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Cetak Label"),
    );
    expect(printBtn).toBeDefined();

    await act(async () => {
      printBtn?.click();
    });

    await flush();

    expect(document.body.textContent).toContain("Cetak Label Stiker Presisi");
    expect(document.body.textContent).toContain("Lembar Stiker Pabrikan");
    expect(document.body.textContent).toContain("Kertas Standar");
    expect(document.body.textContent).toContain("Labelindo No. 103");
    expect(document.body.textContent).toContain("Labelindo No. 107");
    expect(document.body.textContent).toContain("A4 Standar");
    expect(document.body.textContent).toContain("A4 Kompak");
    expect(document.body.textContent).toContain("Posisi Awal Stiker");
    expect(document.body.textContent).toContain("Kalibrasi Margin Printer");
    expect(document.body.textContent).toContain("Lembar Kalibrasi PDF");

    // Switch to A4 Standar and verify cutting guides option appears and slot count updates to 24
    const a4Btn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("A4 Standar"),
    );
    expect(a4Btn).toBeDefined();
    await act(async () => {
      a4Btn?.click();
    });
    await flush();

    expect(document.body.textContent).toContain("Kapasitas: 24/lembar");
    expect(document.body.textContent).toContain("Tampilkan Garis Bantu Potong");
  });
});
