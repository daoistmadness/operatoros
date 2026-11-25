import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { openDatabase } from "@operatoros/db";
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

      // Test PDF generation for No. 107
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
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
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
