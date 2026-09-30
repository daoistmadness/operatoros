import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, CURRENT_SCHEMA_VERSION, openDatabase } from "../src";

describe("Bun S4.7 fresh bootstrap", () => {
  it("creates a startup-valid database and enforces approved identities", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-ts-bootstrap-"));
    const path = join(root, "operatoros.sqlite");
    try {
      createFreshDatabase(path);
      const handle = openDatabase(path);
      const db = handle.client;
      try {
        expect(db.query("SELECT version FROM operatoros_schema_migrations").get()).toEqual({ version: CURRENT_SCHEMA_VERSION });
        db.run("INSERT INTO students (id, name) VALUES (1, 'Same Name'), (2, 'Same Name')");
        db.run("INSERT INTO student_masters (id, full_name, normalized_name, nipd) VALUES ('one', 'Same Name', 'same name', 'N001')");
        expect(() => db.run("INSERT INTO student_masters (id, full_name, normalized_name, nipd) VALUES ('two', 'Same Name', 'same name', 'N001')")).toThrow();
        for (const [index, status] of ["upcoming", "active", "closed"].entries()) {
          db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES (?, '2026-07-01', '2027-06-30', ?, ?)", [`Year ${index}`, status, index === 0 ? 1 : 0]);
        }
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Year 0', '2027-07-01', '2028-06-30', 'active', 0)")).toThrow();
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Another', '2027-07-01', '2028-06-30', 'active', 1)")).toThrow();
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Invalid', '2027-07-01', '2028-06-30', 'invalid', 0)")).toThrow();
      } finally {
        handle.close();
      }
      expect(() => createFreshDatabase(path)).toThrow("DATABASE_ALREADY_EXISTS");
      const reopened = openDatabase(path, { readonly: true });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing unknown database without changing it", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-ts-bootstrap-"));
    const path = join(root, "operatoros.sqlite");
    try {
      const db = new Database(path);
      db.run("CREATE TABLE preserve_me (id INTEGER PRIMARY KEY)");
      db.close();
      expect(() => createFreshDatabase(path)).toThrow("DATABASE_ALREADY_EXISTS");
      const reopened = new Database(path, { readonly: true });
      expect(reopened.query("SELECT name FROM sqlite_master WHERE name = 'preserve_me'").get()).toEqual({ name: "preserve_me" });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
