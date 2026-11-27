import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, schemaFingerprint } from "../src";
import {
  installS47Schema,
  installS48EmployeeSchema,
  installS49SchoolUnitSchema,
  installS50StaffMonthlyActivitySchema,
  installS51UppReportsSchema,
  installS52StudentAdminSchema,
  installS53StudentVerificationSchema,
  installS54BospReminderSchema,
  installS55InventorySchema,
  installS56StaffPtkSchema,
} from "../src/bootstrap";
import { migrateExistingDatabase } from "../src/migrate-existing";
import { CURRENT_SCHEMA_VERSION, S56_SCHEMA_FINGERPRINT } from "../src/manifest";
import { openSqliteConnection } from "../src/sqlite-client";

const S56_VERSION = "20261126_s56";
function withS56Database(run: (path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "operatoros-inventory-master-data-"));
  const path = join(root, "source.sqlite");
  try {
    const db = openSqliteConnection(path).client;
    db.exec("PRAGMA foreign_keys = ON");
    db.transaction(() => {
      installS47Schema(db);
      installS48EmployeeSchema(db);
      installS49SchoolUnitSchema(db);
      installS50StaffMonthlyActivitySchema(db);
      installS51UppReportsSchema(db);
      installS52StudentAdminSchema(db);
      installS53StudentVerificationSchema(db);
      installS54BospReminderSchema(db);
      installS55InventorySchema(db);
      installS56StaffPtkSchema(db);
      expect(schemaFingerprint(db)).toBe(S56_SCHEMA_FINGERPRINT);
      db.run(
        "INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES (?, ?, ?, '{}', 'SYNTHETIC_FIXTURE', '2026-11-26T00:00:00Z')",
        [S56_VERSION, "20261125_s55", S56_SCHEMA_FINGERPRINT],
      );
      db.run("INSERT INTO school_units (id,name) VALUES (1,'Synthetic SD')");
      db.run(
        `INSERT INTO inventory_assets
          (id,asset_code,school_unit_id,current_unit_id,category,item_name,brand,model,serial_number,location,funding_source,budget_year,arkas_account_code,purchase_document_reference,acquisition_date,price,condition,status,notes)
         VALUES ('ast_synthetic0001','SD-IT-0007',1,1,'IT','Synthetic laptop','Synthetic brand','Model X','SN-0007','Room 1','BOS',2026,'ARKAS-001','Receipt-007','2026-08-12',12500000,'BAIK','ACTIVE','Original evidence')`,
      );
      db.run("INSERT INTO inventory_asset_sequences (school_unit_id,category,last_sequence) VALUES (1,'IT',7)");
      db.run(
        `INSERT INTO operations_audit_events
          (event_id,actor_id,actor_role,capability,entity_type,entity_reference,operation,risk_level,source,success,changed_fields,metadata,schema_version)
         VALUES ('synthetic-event-7','synthetic-admin','admin','manage_inventory','INVENTORY_ASSET','ast_synthetic0001','CREATE_ASSET','LOW','API',1,'[\"asset_code\"]','{\"asset_code\":\"SD-IT-0007\"}','1')`,
      );
    }).immediate();
    db.close();
    run(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("inventory master-data migration from S5.6", () => {
  it("adds global masters and preserves assets, evidence, audit, and allocated sequences", () => withS56Database((path) => {
    expect(migrateExistingDatabase(path)).toBe("MIGRATED");
    expect(migrateExistingDatabase(path)).toBe("NOOP");

    const handle = openDatabase(path);
    const db = handle.client;
    try {
      expect(db.query("SELECT version FROM operatoros_schema_migrations WHERE version = ?").get(CURRENT_SCHEMA_VERSION)).toEqual({ version: CURRENT_SCHEMA_VERSION });
      expect(db.query("SELECT id,asset_code,school_unit_id,current_unit_id,category,item_name,brand,model,serial_number,location,funding_source,budget_year,arkas_account_code,purchase_document_reference,acquisition_date,price,condition,status,notes FROM inventory_assets WHERE id='ast_synthetic0001'").get()).toEqual({
        id: "ast_synthetic0001",
        asset_code: "SD-IT-0007",
        school_unit_id: 1,
        current_unit_id: 1,
        category: "IT",
        item_name: "Synthetic laptop",
        brand: "Synthetic brand",
        model: "Model X",
        serial_number: "SN-0007",
        location: "Room 1",
        funding_source: "BOS",
        budget_year: 2026,
        arkas_account_code: "ARKAS-001",
        purchase_document_reference: "Receipt-007",
        acquisition_date: "2026-08-12",
        price: 12500000,
        condition: "BAIK",
        status: "ACTIVE",
        notes: "Original evidence",
      });
      expect(db.query("SELECT school_unit_id,category,last_sequence FROM inventory_asset_sequences").get()).toEqual({ school_unit_id: 1, category: "IT", last_sequence: 7 });
      expect(db.query("SELECT event_id,actor_id,entity_reference,operation,metadata FROM operations_audit_events").get()).toEqual({
        event_id: "synthetic-event-7",
        actor_id: "synthetic-admin",
        entity_reference: "ast_synthetic0001",
        operation: "CREATE_ASSET",
        metadata: "{\"asset_code\":\"SD-IT-0007\"}",
      });
      expect(db.query("SELECT code,display_name FROM inventory_asset_categories ORDER BY sort_order").all()).toEqual([
        { code: "IT", display_name: "Peralatan TI / Komputer" },
        { code: "FRN", display_name: "Furnitur / Mebel" },
        { code: "ELK", display_name: "Elektronik" },
        { code: "LAB", display_name: "Laboratorium" },
        { code: "LIB", display_name: "Pustaka / Buku" },
        { code: "SPT", display_name: "Olahraga" },
        { code: "EDU", display_name: "Alat Edukatif" },
        { code: "OFF", display_name: "Kantor" },
        { code: "OTH", display_name: "Lainnya" },
      ]);
      expect(db.query("SELECT code,display_name FROM inventory_funding_sources ORDER BY sort_order").all()).toEqual([
        { code: "BOS", display_name: "BOS (ARKAS)" },
        { code: "BOP", display_name: "BOP" },
        { code: "YAYASAN", display_name: "Yayasan" },
        { code: "KOMITE", display_name: "Komite Sekolah" },
        { code: "HIBAH", display_name: "Hibah / Donasi" },
        { code: "LAINNYA", display_name: "Lainnya" },
      ]);
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);

      expect(() => db.run("UPDATE inventory_asset_categories SET code='NEW' WHERE code='IT'")).toThrow("INVENTORY_CATEGORY_CODE_IMMUTABLE");
      expect(() => db.run("UPDATE inventory_funding_sources SET code='NEW' WHERE code='BOS'")).toThrow("INVENTORY_FUNDING_SOURCE_CODE_IMMUTABLE");
      expect(() => db.run("DELETE FROM inventory_asset_categories WHERE code='IT'")).toThrow();
      expect(() => db.run("DELETE FROM inventory_funding_sources WHERE code='BOS'")).toThrow();

      db.run("INSERT INTO inventory_asset_categories (code,display_name,normalized_name,is_active,sort_order) VALUES ('CMX','Custom Category','custom category',1,9)");
      db.run("INSERT INTO inventory_funding_sources (code,display_name,normalized_name,is_active,sort_order) VALUES ('CUSTOM_TEST','Community Grant','community grant',1,6)");
      expect(() => db.run("INSERT INTO inventory_asset_categories (code,display_name,normalized_name,is_active,sort_order) VALUES ('DUP','Different label','custom category',1,10)")).toThrow();
      db.run("INSERT INTO inventory_assets (id,asset_code,school_unit_id,current_unit_id,category,item_name,funding_source,budget_year) VALUES ('ast_custom0001','SD-CMX-0001',1,1,'CMX','Custom asset','CUSTOM_TEST',2026)");
      expect(db.query("SELECT asset_code,category,funding_source,arkas_account_code FROM inventory_assets WHERE id='ast_custom0001'").get()).toEqual({
        asset_code: "SD-CMX-0001",
        category: "CMX",
        funding_source: "CUSTOM_TEST",
        arkas_account_code: null,
      });

      db.run("UPDATE inventory_asset_categories SET is_active=0 WHERE code='IT'");
      db.run("UPDATE inventory_funding_sources SET is_active=0 WHERE code='BOS'");
      expect(() => db.run("INSERT INTO inventory_assets (id,asset_code,school_unit_id,category,item_name,funding_source,budget_year) VALUES ('ast_inactive0001','SD-IT-0008',1,'IT','Inactive category','CUSTOM_TEST',2026)")).toThrow("INVENTORY_CATEGORY_NOT_ACTIVE");
      expect(() => db.run("INSERT INTO inventory_assets (id,asset_code,school_unit_id,category,item_name,funding_source,budget_year) VALUES ('ast_inactive0002','SD-CMX-0002',1,'CMX','Inactive funding','BOS',2026)")).toThrow("INVENTORY_FUNDING_SOURCE_NOT_ACTIVE");
      expect(() => db.run("UPDATE inventory_assets SET category='IT',funding_source='BOS' WHERE id='ast_synthetic0001'")).not.toThrow();
      db.run("DELETE FROM inventory_asset_categories WHERE code='LAB'");
      expect(db.query("SELECT code FROM inventory_asset_categories WHERE code='LAB'").get()).toBeNull();
    } finally {
      handle.close();
    }
  }));
});
