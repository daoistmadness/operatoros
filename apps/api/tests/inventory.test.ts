import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import {
  getLabelTemplate,
  getRegisteredLabelTemplates,
  resolveLabelTemplate,
} from "@operatoros/contracts/inventory";
import { generateAssetLabelsPdf } from "../src/domains/inventory-labels";
import { createApp } from "../src/app";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "synthetic-inventory-cookie-secret-1234567890";

function request(method: string, path: string, cookie?: string, body?: any): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  headers.set("origin", "http://local");
  if (body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function login(app: ReturnType<typeof createApp>, role = "admin"): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `golden-${role}`, password: `golden-${role}-pass-1` }),
  }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-inventory-test-"));
  const databasePath = join(root, "operatoros.sqlite");
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);

  // Insert school units
  database.client.run("INSERT INTO school_units (id, name, status) VALUES (1, 'SD Edelweiss', 'ACTIVE')");
  database.client.run("INSERT INTO school_units (id, name, status) VALUES (2, 'SMP Edelweiss', 'ACTIVE')");
  database.client.run("INSERT INTO school_units (id, name, status) VALUES (3, 'SMA Edelweiss Unit Khusus', 'INACTIVE')");

  const app = createApp({
    auth: { authCookieSecret: secret, allowedOrigins: ["http://local"] },
    databaseHandle: database,
    environment: "test",
  });

  return { root, database, app };
}

describe("Inventory & Asset Labels V1", () => {
  it("manages shared categories and funding sources without changing asset keys", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");
      const mastersRes = await app.handle(request("GET", "/api/inventory/master-data", cookie));
      expect(mastersRes.status).toBe(200);
      const masters = await mastersRes.json() as any;
      expect(masters.categories.find((item: any) => item.code === "IT")).toMatchObject({
        name: "Peralatan TI / Komputer",
        is_active: true,
      });
      expect(masters.funding_sources.find((item: any) => item.code === "BOS")).toMatchObject({
        name: "BOS (ARKAS)",
        is_active: true,
      });

      const categoryRes = await app.handle(request("POST", "/api/inventory/master-data/categories", cookie, {
        code: "CUS",
        name: "  Peralatan   Khusus  ",
      }));
      expect(categoryRes.status).toBe(201);
      expect(await categoryRes.json()).toMatchObject({ code: "CUS", name: "Peralatan Khusus" });

      const duplicateNameRes = await app.handle(request("POST", "/api/inventory/master-data/categories", cookie, {
        code: "CS2",
        name: "peralatan khusus",
      }));
      expect(duplicateNameRes.status).toBe(409);
      const duplicateCodeRes = await app.handle(request("POST", "/api/inventory/master-data/categories", cookie, {
        code: "CUS",
        name: "A different category name",
      }));
      expect(duplicateCodeRes.status).toBe(409);

      const fundingRes = await app.handle(request("POST", "/api/inventory/master-data/funding-sources", cookie, {
        name: "Dana Sponsor Lokal",
      }));
      expect(fundingRes.status).toBe(201);
      const funding = await fundingRes.json() as any;
      expect(funding.code).toMatch(/^CUSTOM_[A-F0-9]{32}$/);
      const fundingOrderRes = await app.handle(request("PUT", "/api/inventory/master-data/funding-sources/order", cookie, {
        codes: [funding.code, ...masters.funding_sources.map((item: any) => item.code)],
      }));
      expect(fundingOrderRes.status).toBe(200);
      expect((await fundingOrderRes.json() as any).funding_sources[0]).toMatchObject({ code: funding.code, sort_order: 0 });

      const duplicateFundingRes = await app.handle(request("POST", "/api/inventory/master-data/funding-sources", cookie, {
        name: "dana sponsor lokal",
      }));
      expect(duplicateFundingRes.status).toBe(409);

      const createRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "CUS",
        item_name: "Perangkat Khusus",
        funding_source: funding.code,
        budget_year: 2026,
      }));
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as any;
      expect(created.asset_code).toBe("SD-CUS-0001");
      expect(created.category_name).toBe("Peralatan Khusus");
      expect(created.funding_source_name).toBe("Dana Sponsor Lokal");

      const batchRes = await app.handle(request("POST", "/api/inventory/assets/batch", cookie, {
        school_unit_id: 1,
        category: "CUS",
        item_name: "Perangkat Khusus Batch",
        quantity: 2,
        funding_source: funding.code,
        budget_year: 2026,
      }));
      expect(batchRes.status).toBe(201);
      const batch = await batchRes.json() as any;
      expect(batch.items.map((item: any) => item.asset_code)).toEqual(["SD-CUS-0002", "SD-CUS-0003"]);
      expect(batch.items[0]).toMatchObject({ category_name: "Peralatan Khusus", funding_source_name: "Dana Sponsor Lokal" });

      const renameRes = await app.handle(request("PATCH", "/api/inventory/master-data/categories/CUS", cookie, {
        name: "Peralatan Spesial",
      }));
      expect(renameRes.status).toBe(200);
      expect(await renameRes.json()).toMatchObject({ code: "CUS", name: "Peralatan Spesial" });

      const reorderRes = await app.handle(request("PUT", "/api/inventory/master-data/categories/order", cookie, {
        codes: ["CUS", ...masters.categories.map((item: any) => item.code)],
      }));
      expect(reorderRes.status).toBe(200);
      expect((await reorderRes.json() as any).categories[0]).toMatchObject({ code: "CUS", sort_order: 0 });

      for (const [path, body] of [
        ["/api/inventory/master-data/categories/CUS", { is_active: false }],
        [`/api/inventory/master-data/funding-sources/${funding.code}`, { is_active: false }],
      ] as const) {
        const response = await app.handle(request("PATCH", path, cookie, body));
        expect(response.status).toBe(200);
      }

      const inactiveAssignmentRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "CUS",
        item_name: "Must be rejected",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(inactiveAssignmentRes.status).toBe(400);

      const inactiveBatchRes = await app.handle(request("POST", "/api/inventory/assets/batch", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Must reject inactive source",
        quantity: 1,
        funding_source: funding.code,
        budget_year: 2026,
      }));
      expect(inactiveBatchRes.status).toBe(400);

      const existingEditRes = await app.handle(request("PUT", `/api/inventory/assets/${created.id}`, cookie, {
        location: "Ruang Arsip",
      }));
      expect(existingEditRes.status).toBe(200);
      expect(await existingEditRes.json()).toMatchObject({ category: "CUS", funding_source: funding.code, location: "Ruang Arsip" });

      const listedRes = await app.handle(request("GET", "/api/inventory/assets?category=CUS", cookie));
      const listed = await listedRes.json() as any;
      expect(listed.items.find((item: any) => item.id === created.id)).toMatchObject({
        asset_code: "SD-CUS-0001",
        category_name: "Peralatan Spesial",
        funding_source_name: "Dana Sponsor Lokal",
      });

      const summaryRes = await app.handle(request("GET", "/api/inventory/summary", cookie));
      const summary = await summaryRes.json() as any;
      expect(summary.by_category).toContainEqual({ category: "CUS", category_name: "Peralatan Spesial", count: 3 });
      expect(summary.by_funding).toContainEqual({ funding_source: funding.code, funding_source_name: "Dana Sponsor Lokal", count: 3 });

      const currentMasters = await (await app.handle(request("GET", "/api/inventory/master-data", cookie))).json() as any;
      expect(currentMasters.categories.find((item: any) => item.code === "CUS")).toMatchObject({ is_active: false, can_delete: false });
      expect(currentMasters.funding_sources.find((item: any) => item.code === funding.code)).toMatchObject({ is_active: false, can_delete: false });

      const exportRes = await app.handle(request("GET", "/api/inventory/export/xlsx", cookie));
      expect(exportRes.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exportRes.arrayBuffer()));
      const exportedRow = workbook.getWorksheet("Buku Inventaris")?.getRow(2);
      expect(exportedRow?.getCell(6).value).toBe("Peralatan Spesial");
      expect(exportedRow?.getCell(11).value).toBe("Dana Sponsor Lokal");

      for (const path of [
        "/api/inventory/master-data/categories/CUS",
        `/api/inventory/master-data/funding-sources/${funding.code}`,
      ]) {
        const response = await app.handle(request("DELETE", path, cookie));
        expect(response.status).toBe(409);
      }

      const unusedRes = await app.handle(request("POST", "/api/inventory/master-data/categories", cookie, {
        code: "TMP",
        name: "Temporary Category",
      }));
      expect(unusedRes.status).toBe(201);
      expect((await app.handle(request("DELETE", "/api/inventory/master-data/categories/TMP", cookie))).status).toBe(204);
      const masterAuditCount = database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE entity_type IN ('INVENTORY_ASSET_CATEGORY', 'INVENTORY_FUNDING_SOURCE')").get() as { count: number };
      expect(masterAuditCount.count).toBeGreaterThan(0);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows staff to read inventory masters but rejects master-data mutations", async () => {
    const { root, database, app } = setup();
    try {
      const staffCookie = await login(app, "staff");
      expect((await app.handle(request("GET", "/api/inventory/master-data", staffCookie))).status).toBe(200);
      expect((await app.handle(request("POST", "/api/inventory/master-data/categories", staffCookie, {
        code: "CUS",
        name: "Unauthorized",
      }))).status).toBe(403);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers single asset with sequential code and logs audit", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      const createRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Laptop ASUS Vivobook",
        brand: "ASUS",
        location: "Ruang Guru",
        funding_source: "BOS",
        budget_year: 2026,
        acquisition_date: "2026-02-15",
        price: 8500000,
        condition: "BAIK",
        notes: "Pengadaan BOS reguler tahap 1",
      }));

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as any;
      expect(created.asset_code).toBe("SD-IT-0001");
      expect(created.school_unit_name).toBe("SD Edelweiss");
      expect(created.item_name).toBe("Laptop ASUS Vivobook");
      expect(created.status).toBe("ACTIVE");

      // Register second asset in same category -> sequence increments
      const createRes2 = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Proyektor Epson",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(createRes2.status).toBe(201);
      const created2 = (await createRes2.json()) as any;
      expect(created2.asset_code).toBe("SD-IT-0002");

      // Register asset in different category -> sequence starts at 1
      const createRes3 = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "FRN",
        item_name: "Meja Guru Kayu Jati",
        funding_source: "YAYASAN",
        budget_year: 2026,
      }));
      expect(createRes3.status).toBe(201);
      const created3 = (await createRes3.json()) as any;
      expect(created3.asset_code).toBe("SD-FRN-0001");

      // Different school unit -> sequence independent
      const createRes4 = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 2,
        category: "IT",
        item_name: "PC All-in-One SMP",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(createRes4.status).toBe(201);
      const created4 = (await createRes4.json()) as any;
      expect(created4.asset_code).toBe("SMP-IT-0001");

      // Inactive school unit rejected
      const createRes5 = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 3,
        category: "IT",
        item_name: "PC",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(createRes5.status).toBe(400);

      // Audit logged in operations_audit_events
      const audits = database.client.query("SELECT * FROM operations_audit_events WHERE entity_type = 'INVENTORY_ASSET'").all();
      expect(audits.length).toBeGreaterThanOrEqual(4);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles batch registration with atomic sequence allocation", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      const batchRes = await app.handle(request("POST", "/api/inventory/assets/batch", cookie, {
        school_unit_id: 1,
        category: "FRN",
        item_name: "Kursi Siswa Standar",
        quantity: 5,
        brand: "Informa",
        location: "Kelas 1A",
        funding_source: "BOS",
        budget_year: 2026,
        price_per_unit: 250000,
      }));

      expect(batchRes.status).toBe(201);
      const batchData = (await batchRes.json()) as any;
      expect(batchData.created_count).toBe(5);
      expect(batchData.items.map((i: any) => i.asset_code)).toEqual([
        "SD-FRN-0001",
        "SD-FRN-0002",
        "SD-FRN-0003",
        "SD-FRN-0004",
        "SD-FRN-0005",
      ]);

      // Next single creation picks up next sequence
      const singleRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "FRN",
        item_name: "Kursi Siswa Tambahan",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(singleRes.status).toBe(201);
      const singleData = (await singleRes.json()) as any;
      expect(singleData.asset_code).toBe("SD-FRN-0006");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("queries and filters assets with pagination and search", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      // Register sample items
      await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Laptop Lenovo ThinkPad",
        brand: "Lenovo",
        location: "Lab Komputer",
        funding_source: "BOS",
        budget_year: 2025,
      }));
      await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "ELK",
        item_name: "AC Panasonic 1 PK",
        brand: "Panasonic",
        location: "Ruang Guru",
        funding_source: "YAYASAN",
        budget_year: 2026,
      }));

      // Filter by category
      const itRes = await app.handle(request("GET", "/api/inventory/assets?category=IT", cookie));
      expect(itRes.status).toBe(200);
      const itData = (await itRes.json()) as any;
      expect(itData.total).toBe(1);
      expect(itData.items[0].item_name).toBe("Laptop Lenovo ThinkPad");

      // Search by brand
      const searchRes = await app.handle(request("GET", "/api/inventory/assets?search=panasonic", cookie));
      expect(searchRes.status).toBe(200);
      const searchData = (await searchRes.json()) as any;
      expect(searchData.total).toBe(1);
      expect(searchData.items[0].item_name).toBe("AC Panasonic 1 PK");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updates asset details and preserves immutable code and origin", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      const createRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Printer Canon",
        model: "Pixma G3010",
        serial_number: "SN-CANON-1234",
        arkas_account_code: "5.2.2.01.01",
        purchase_document_reference: "BAST-2026-001",
        funding_source: "BOS",
        budget_year: 2026,
        price: 2500000,
      }));
      const created = (await createRes.json()) as any;
      expect(created.model).toBe("Pixma G3010");
      expect(created.serial_number).toBe("SN-CANON-1234");
      expect(created.arkas_account_code).toBe("5.2.2.01.01");
      expect(created.purchase_document_reference).toBe("BAST-2026-001");
      expect(created.current_unit_id).toBe(1);

      // Perform update: modify location, condition, notes, category, current_unit_id (transfer), price
      const updateRes = await app.handle(request("PUT", `/api/inventory/assets/${created.id}`, cookie, {
        category: "OFF",
        current_unit_id: 2,
        location: "Tata Usaha SMP",
        condition: "RUSAK_RINGAN",
        price: 2600000,
        model: "Pixma G3020",
        serial_number: "SN-CANON-5678",
        notes: "Dipindahkan ke unit SMP, update serial number dan harga per invoice revisi",
      }));
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as any;
      expect(updated.category).toBe("OFF");
      expect(updated.current_unit_id).toBe(2);
      expect(updated.current_unit_name).toBe("SMP Edelweiss");
      expect(updated.school_unit_id).toBe(1); // Permanent origin preserved!
      expect(updated.school_unit_name).toBe("SD Edelweiss"); // Permanent origin preserved!
      expect(updated.location).toBe("Tata Usaha SMP");
      expect(updated.condition).toBe("RUSAK_RINGAN");
      expect(updated.price).toBe(2600000);
      expect(updated.model).toBe("Pixma G3020");
      expect(updated.serial_number).toBe("SN-CANON-5678");
      expect(updated.notes).toContain("Dipindahkan ke unit SMP");
      expect(updated.asset_code).toBe("SD-IT-0001"); // Permanent code preserved!

      // Audit logged in operations_audit_events
      const audits = database.client.query("SELECT * FROM operations_audit_events WHERE entity_reference = ?").all(created.id);
      expect(audits.some((a: any) => a.operation === "UPDATE_ASSET")).toBe(true);

      // Verify DB immutability triggers directly
      expect(() => database.client.run("UPDATE inventory_assets SET asset_code = 'SMP-OFF-9999' WHERE id = ?", [created.id]))
        .toThrow("INVENTORY_ASSETS_IMMUTABLE_CODE_AND_ORIGIN");
      expect(() => database.client.run("UPDATE inventory_assets SET school_unit_id = 2 WHERE id = ?", [created.id]))
        .toThrow("INVENTORY_ASSETS_IMMUTABLE_CODE_AND_ORIGIN");
      expect(() => database.client.run("DELETE FROM inventory_assets WHERE id = ?", [created.id]))
        .toThrow("INVENTORY_ASSETS_IMMUTABLE_NO_DELETE");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("calculates summary statistics accurately across units and categories", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      // Register asset 1: SD, IT, Baik, 8500000
      await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Laptop 1",
        price: 8500000,
        condition: "BAIK",
        funding_source: "BOS",
        budget_year: 2026,
      }));

      // Register asset 2: SD, FRN, Rusak Ringan, 1500000
      const a2Res = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "FRN",
        item_name: "Meja Guru",
        price: 1500000,
        condition: "RUSAK_RINGAN",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      const a2 = (await a2Res.json()) as any;

      // Register asset 3: SMP, ELK, Baik, 500000, retired
      const a3Res = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 2,
        category: "ELK",
        item_name: "Kipas Rusak",
        price: 500000,
        condition: "RUSAK_BERAT",
        funding_source: "KOMITE",
        budget_year: 2025,
      }));
      const a3 = (await a3Res.json()) as any;
      await app.handle(request("POST", `/api/inventory/assets/${a3.id}/retire`, cookie, {
        retired_reason: "Rusak total",
      }));

      // Fetch summary
      const sumRes = await app.handle(request("GET", "/api/inventory/summary", cookie));
      expect(sumRes.status).toBe(200);
      const summary = (await sumRes.json()) as any;

      expect(summary.total_assets).toBe(3);
      expect(summary.active_count).toBe(2);
      expect(summary.retired_count).toBe(1);
      expect(summary.total_value).toBe(10500000);
      expect(summary.by_condition.baik).toBe(1);
      expect(summary.by_condition.rusak_ringan).toBe(1);
      expect(summary.by_condition.rusak_berat).toBe(1);
      expect(summary.by_category.find((c: any) => c.category === "IT")?.count).toBe(1);
      expect(summary.by_category.find((c: any) => c.category === "FRN")?.count).toBe(1);
      expect(summary.by_category.find((c: any) => c.category === "ELK")?.count).toBe(1);
      expect(summary.by_unit.find((u: any) => u.unit_id === 1)?.count).toBe(2);
      expect(summary.by_unit.find((u: any) => u.unit_id === 2)?.count).toBe(1);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retires an asset with reason and timestamp and forbids further modification", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      const createRes = await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "ELK",
        item_name: "Kipas Angin Dinding",
        funding_source: "KOMITE",
        budget_year: 2024,
      }));
      const created = (await createRes.json()) as any;

      const retireRes = await app.handle(request("POST", `/api/inventory/assets/${created.id}/retire`, cookie, {
        retired_reason: "Motor terbakar, biaya perbaikan melebihi nilai ekonomis",
      }));
      expect(retireRes.status).toBe(200);
      const retired = (await retireRes.json()) as any;
      expect(retired.status).toBe("RETIRED");
      expect(retired.retired_reason).toBe("Motor terbakar, biaya perbaikan melebihi nilai ekonomis");
      expect(retired.retired_at).toBeTruthy();

      // Subsequent update on retired asset is rejected
      const updateRes = await app.handle(request("PUT", `/api/inventory/assets/${created.id}`, cookie, {
        location: "Gudang",
      }));
      expect(updateRes.status).toBe(400);

      // Re-retire is rejected
      const doubleRetireRes = await app.handle(request("POST", `/api/inventory/assets/${created.id}/retire`, cookie, {
        retired_reason: "Duplicate retire",
      }));
      expect(doubleRetireRes.status).toBe(400);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exports filtered assets to Excel (.xlsx)", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Router Mikrotik",
        funding_source: "BOS",
        budget_year: 2026,
      }));

      const exportRes = await app.handle(request("GET", "/api/inventory/export/xlsx", cookie));
      expect(exportRes.status).toBe(200);
      expect(exportRes.headers.get("content-type")).toContain("spreadsheetml");
      const bytes = await exportRes.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(1000);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("generates label preview and precision print PDF for No. 103 and No. 107", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      const c1: any = await (await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Laptop Lab 01",
        funding_source: "BOS",
        budget_year: 2026,
      }))).json();
      const c2: any = await (await app.handle(request("POST", "/api/inventory/assets", cookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Laptop Lab 02",
        funding_source: "BOS",
        budget_year: 2026,
      }))).json();

      // Test Preview for No. 103 with starting_index = 2
      const previewRes = await app.handle(request("POST", "/api/inventory/labels/preview", cookie, {
        asset_ids: [c1.id, c2.id],
        template_id: "103",
        starting_index: 2,
      }));
      expect(previewRes.status).toBe(200);
      const previewData = (await previewRes.json()) as any;
      expect(previewData.template.id).toBe("103");
      expect(previewData.total_assets).toBe(2);
      expect(previewData.starting_index).toBe(2);
      expect(previewData.items[0].slot_index).toBe(2);
      expect(previewData.items[1].slot_index).toBe(3);

      // Test PDF generation for No. 103 (with calibration offsets & monochrome)
      const pdfRes103 = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: [c1.id, c2.id],
        template_id: "103",
        starting_index: 2,
        offset_x_mm: 1.5,
        offset_y_mm: -0.5,
        monochrome: false,
      }));
      expect(pdfRes103.status).toBe(200);
      expect(pdfRes103.headers.get("content-type")).toBe("application/pdf");
      const pdfBytes103 = await pdfRes103.arrayBuffer();
      expect(pdfBytes103.byteLength).toBeGreaterThan(1000);

      // Verify PDF validity with pdf-lib
      const doc103 = await PDFDocument.load(pdfBytes103);
      expect(doc103.getPageCount()).toBe(1);
      const page103 = doc103.getPage(0);
      // Dimensions in points: ~609.84 x ~841.69
      expect(Math.round(page103.getWidth())).toBe(610);
      expect(Math.round(page103.getHeight())).toBe(842);

      // Test PDF generation for No. 107 (Landscape 296.93 x 254.00 mm)
      const pdfRes107 = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: [c1.id, c2.id],
        template_id: "107",
        starting_index: 0,
        monochrome: true,
      }));
      expect(pdfRes107.status).toBe(200);
      const pdfBytes107 = await pdfRes107.arrayBuffer();
      const doc107 = await PDFDocument.load(pdfBytes107);
      expect(doc107.getPageCount()).toBe(1);
      const page107 = doc107.getPage(0);
      // Landscape 841.68 x 720.00 pt
      expect(Math.round(page107.getWidth())).toBe(842);
      expect(Math.round(page107.getHeight())).toBe(720);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes authoritative template registry, A4 presets, multi-page pagination, and calibration PDF", async () => {
    const { root, database, app } = setup();
    try {
      const cookie = await login(app, "admin");

      // 1. Registry endpoint returns manufacturer + A4 templates
      const tplRes = await app.handle(request("GET", "/api/inventory/labels/templates", cookie));
      expect(tplRes.status).toBe(200);
      const tplData = (await tplRes.json()) as any;
      expect(tplData.items.map((t: any) => t.id)).toEqual(["103", "107", "a4-standard", "a4-compact"]);

      // Verify No. 103 & No. 107 reference geometry
      const t103 = getLabelTemplate("103")!;
      expect(t103.slotsPerPage).toBe(12);
      expect(t103.orientation).toBe("portrait");
      expect(t103.slots[0]).toMatchObject({ xMm: 5.84, yTopMm: 14.14, widthMm: 64, heightMm: 32 });
      expect(t103.slots[11]).toMatchObject({ xMm: 144.25, yTopMm: 124.82, widthMm: 64, heightMm: 32 });

      const t107 = getLabelTemplate("107")!;
      expect(t107.slotsPerPage).toBe(30);
      expect(t107.orientation).toBe("landscape");
      expect(t107.slots[0]).toMatchObject({ xMm: 10.84, yTopMm: 50.82, widthMm: 50, heightMm: 18 });
      expect(t107.slots[29]).toMatchObject({ xMm: 119.16, yTopMm: 229.2, widthMm: 50, heightMm: 18 });

      // Verify A4 Standard (210x297mm, 64x32mm -> 3x8 = 24) & A4 Compact (210x297mm, 50x18mm -> 3x13 = 39)
      const a4Std = getLabelTemplate("a4-standard")!;
      expect(a4Std.pageWidthMm).toBe(210);
      expect(a4Std.pageHeightMm).toBe(297);
      expect(a4Std.slotsPerPage).toBe(24);
      expect(a4Std.supportsCuttingGuides).toBe(true);

      const a4Cmp = getLabelTemplate("a4-compact")!;
      expect(a4Cmp.pageWidthMm).toBe(210);
      expect(a4Cmp.pageHeightMm).toBe(297);
      expect(a4Cmp.slotsPerPage).toBe(39);

      // 2. Create 15 batch assets and test multi-page partial sheet pagination (15 items starting at slot 10 on 12-slot 103 -> 3 pages)
      const batchRes = await app.handle(request("POST", "/api/inventory/assets/batch", cookie, {
        school_unit_id: 1,
        category: "EDU",
        item_name: "Alat Peraga Matematika",
        quantity: 15,
        funding_source: "YAYASAN",
        budget_year: 2026,
      }));
      const batch = (await batchRes.json()) as any;
      const ids = batch.items.map((i: any) => i.id);

      const previewRes = await app.handle(request("POST", "/api/inventory/labels/preview", cookie, {
        asset_ids: ids,
        template_id: "103",
        starting_index: 10,
      }));
      expect(previewRes.status).toBe(200);
      const preview = (await previewRes.json()) as any;
      expect(preview.total_pages).toBe(3);
      expect(preview.pages[0].labels_on_page).toBe(2);
      expect(preview.pages[1].labels_on_page).toBe(12);
      expect(preview.pages[2].labels_on_page).toBe(1);

      const multiPdfRes = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: ids,
        template_id: "103",
        starting_index: 10,
      }));
      expect(multiPdfRes.status).toBe(200);
      const multiDoc = await PDFDocument.load(await multiPdfRes.arrayBuffer());
      expect(multiDoc.getPageCount()).toBe(3);

      // 3. A4 Standard PDF generation with cutting guides (210 x 297 mm -> ~595 x 842 pt)
      const a4PdfRes = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: ids.slice(0, 4),
        template_id: "a4-standard",
        starting_index: 0,
        cutting_guides: true,
      }));
      expect(a4PdfRes.status).toBe(200);
      const a4Doc = await PDFDocument.load(await a4PdfRes.arrayBuffer());
      expect(a4Doc.getPageCount()).toBe(1);
      expect(Math.round(a4Doc.getPage(0).getWidth())).toBe(595);
      expect(Math.round(a4Doc.getPage(0).getHeight())).toBe(842);

      // 4. Calibration PDF generation
      const calRes = await app.handle(request("POST", "/api/inventory/labels/calibration-pdf", cookie, {
        template_id: "107",
        offset_x_mm: 1.0,
        offset_y_mm: -0.5,
      }));
      expect(calRes.status).toBe(200);
      expect(calRes.headers.get("content-type")).toBe("application/pdf");
      const calDoc = await PDFDocument.load(await calRes.arrayBuffer());
      expect(calDoc.getPageCount()).toBe(1);
      expect(Math.round(calDoc.getPage(0).getWidth())).toBe(842);
      expect(Math.round(calDoc.getPage(0).getHeight())).toBe(720);

      // 5. Reject unknown template, invalid starting_index, and unsafe calibration offsets
      const badTplRes = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: ids.slice(0, 1),
        template_id: "unknown-999",
      }));
      expect(badTplRes.status).toBe(400);

      const badSlotRes = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: ids.slice(0, 1),
        template_id: "103",
        starting_index: 12,
      }));
      expect(badSlotRes.status).toBe(400);

      const badOffsetRes = await app.handle(request("POST", "/api/inventory/labels/pdf", cookie, {
        asset_ids: ids.slice(0, 1),
        template_id: "103",
        offset_x_mm: 20,
      }));
      expect(badOffsetRes.status).toBe(400);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports extensible synthetic templates and rejects invalid template geometry", async () => {
    // Synthetic A5 standard paper template (148 x 210 mm, 64 x 32 mm labels)
    const syntheticA5 = resolveLabelTemplate({
      id: "synthetic-a5",
      name: "A5 Synthetic Test (64 x 32 mm)",
      shortLabel: "A5 Test",
      description: "Synthetic extensibility test",
      family: "standard_paper",
      pageWidthMm: 148,
      pageHeightMm: 210,
      orientation: "portrait",
      labelWidthMm: 64,
      labelHeightMm: 32,
      contentPreset: "standard",
      safeInsetMm: 2,
      defaultOffsetXMm: 0,
      defaultOffsetYMm: 0,
      supportsCuttingGuides: true,
      defaultCuttingGuides: true,
      supportsPartialSheet: true,
      verificationStatus: "verified_standard_paper",
      verificationNote: "Synthetic",
      gridSpec: { minMarginXMm: 6, minMarginYMm: 8, gapXMm: 4, gapYMm: 4 },
    });
    expect(syntheticA5.columns).toBe(2);
    expect(syntheticA5.rows).toBe(5);
    expect(syntheticA5.slotsPerPage).toBe(10);

    const pdfBytes = await generateAssetLabelsPdf(
      [
        {
          id: "ast_syn_1",
          asset_code: "SD-IT-0099",
          item_name: "Router Sekolah",
          school_unit_name: "SD Edelweiss",
          category: "IT",
          funding_source: "HIBAH",
          budget_year: 2026,
          condition: "BAIK",
        },
      ],
      { templateId: syntheticA5.id, templateOverride: syntheticA5 },
    );
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(Math.round((148 * 72) / 25.4));

    // Reject overlapping slots
    expect(() =>
      resolveLabelTemplate({
        id: "bad-overlap",
        name: "Bad",
        shortLabel: "Bad",
        description: "Bad",
        family: "manufacturer",
        pageWidthMm: 210,
        pageHeightMm: 297,
        orientation: "portrait",
        labelWidthMm: 50,
        labelHeightMm: 20,
        contentPreset: "compact",
        safeInsetMm: 1,
        defaultOffsetXMm: 0,
        defaultOffsetYMm: 0,
        supportsCuttingGuides: false,
        defaultCuttingGuides: false,
        supportsPartialSheet: true,
        verificationStatus: "verified_pdf_provisional_physical",
        verificationNote: "Bad",
        explicitSlots: [
          { index: 0, row: 0, col: 0, xMm: 10, yTopMm: 10, widthMm: 50, heightMm: 20 },
          { index: 1, row: 0, col: 1, xMm: 40, yTopMm: 10, widthMm: 50, heightMm: 20 },
        ],
      }),
    ).toThrow("overlap");

    // Reject out-of-bounds slots
    expect(() =>
      resolveLabelTemplate({
        id: "bad-oob",
        name: "Bad",
        shortLabel: "Bad",
        description: "Bad",
        family: "manufacturer",
        pageWidthMm: 100,
        pageHeightMm: 100,
        orientation: "portrait",
        labelWidthMm: 50,
        labelHeightMm: 20,
        contentPreset: "compact",
        safeInsetMm: 1,
        defaultOffsetXMm: 0,
        defaultOffsetYMm: 0,
        supportsCuttingGuides: false,
        defaultCuttingGuides: false,
        supportsPartialSheet: true,
        verificationStatus: "verified_pdf_provisional_physical",
        verificationNote: "Bad",
        explicitSlots: [
          { index: 0, row: 0, col: 0, xMm: 60, yTopMm: 10, widthMm: 50, heightMm: 20 },
        ],
      }),
    ).toThrow("exceeds page bounds");

    expect(getRegisteredLabelTemplates().length).toBe(4);
  });

  it("enforces role-based capabilities on inventory routes", async () => {
    const { root, database, app } = setup();
    try {
      const staffCookie = await login(app, "staff");

      // Staff can view assets
      const viewRes = await app.handle(request("GET", "/api/inventory/assets", staffCookie));
      expect(viewRes.status).toBe(200);

      // Staff cannot manage (create/update/retire)
      const createRes = await app.handle(request("POST", "/api/inventory/assets", staffCookie, {
        school_unit_id: 1,
        category: "IT",
        item_name: "Forbidden Item",
        funding_source: "BOS",
        budget_year: 2026,
      }));
      expect(createRes.status).toBe(403);

      // Staff cannot export
      const exportRes = await app.handle(request("GET", "/api/inventory/export/xlsx", staffCookie));
      expect(exportRes.status).toBe(403);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
