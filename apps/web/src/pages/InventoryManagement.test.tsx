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
  fetchAsset: vi.fn(),
  createAsset: vi.fn(),
  batchCreateAssets: vi.fn(),
  updateAsset: vi.fn(),
  retireAsset: vi.fn(),
  previewLabels: vi.fn(),
  downloadLabelsPdf: vi.fn(),
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
    category: "IT",
    item_name: "Laptop Asus Guru",
    brand: "ASUS",
    location: "Ruang Guru",
    funding_source: "BOS",
    budget_year: 2026,
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
    category: "FRN",
    item_name: "Meja Guru Kayu Jati",
    brand: "Informa",
    location: "Ruang 1A",
    funding_source: "YAYASAN",
    budget_year: 2025,
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
    expect(document.body.textContent).toContain("Labelindo No. 103");
    expect(document.body.textContent).toContain("Labelindo No. 107");
    expect(document.body.textContent).toContain("Posisi Awal Stiker");
    expect(document.body.textContent).toContain("Kalibrasi Margin Printer");
  });
});
