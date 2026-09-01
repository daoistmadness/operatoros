import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";

function sha256FileSync(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
import { inTransaction, openDatabase, REQUIRED_TABLES, validateDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;

function disposableDatabasePath(label: string): string {
  return `/tmp/operatoros-${label}-${process.pid}-${Date.now()}.db`;
}

function bootstrapDatabase(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "bootstrap_fresh_sqlite_database(Path(sys.argv[1]))",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:///${path}`,
      AUTH_COOKIE_SECRET: "astryx-test-only-cookie-secret-32-chars",
      OPERATOROS_ISOLATED_TEST: "true",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

describe("S4.6 data layer", () => {
  it("opens and validates a fresh disposable S4.6 database", () => {
    const path = disposableDatabasePath("fresh");
    bootstrapDatabase(path);
    try {
      const handle = openDatabase(path, { readonly: true });
      expect(handle.db).toBeDefined();
      handle.close();
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("creates every table declared by the S4.6 schema snapshot", () => {
    const path = disposableDatabasePath("fresh-parity");
    bootstrapDatabase(path);
    try {
      const client = new Database(path, { readonly: true });
      const present = new Set(
        (client.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name),
      );
      client.close();
      const schemaSource = readFileSync(`${repoRoot}/packages/db/src/schema.ts`, "utf8");
      const declared = [...schemaSource.matchAll(/sqliteTable\("([^"]+)"/g)].map((match) => match[1] as string);
      expect(declared.length).toBeGreaterThan(0);
      const missing = declared.filter((table) => !present.has(table));
      expect(missing).toEqual([]);
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("rejects the protected operational database before opening it", () => {
    expect(() => openDatabase("/tmp/attendance.db")).toThrow("PROTECTED_DATABASE_FORBIDDEN");
  });

  it("rolls back a failed transaction", () => {
    const client = new Database(":memory:");
    client.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    expect(() =>
      inTransaction(client, () => {
        client.run("INSERT INTO items (name) VALUES (?)", ["kept only until failure"]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(client.query("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 0 });
    client.close();
  });

  it("fails closed on an incomplete current-schema state", () => {
    const path = disposableDatabasePath("historical-65");
    bootstrapDatabase(path);
    try {
      const client = new Database(path);
      for (const table of ["staff_members", "staff_education", "staff_identifiers", "staff_contact_details", "staff_import_batches", "staff_import_rows", "staff_import_issues", "staff_job_title_mappings", "staff_jenjang_assignments", "dismissal_policies", "dismissal_policy_audits", "teacher_class_assignments", "teacher_class_assignment_audit"]) {
        client.run(`DROP TABLE IF EXISTS "${table}"`);
      }
      client.close();
      const probe = new Database(path, { readonly: true });
      const before = (probe.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name).sort().join(",");
      const ledgerBefore = (probe.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at").all() as { version: string }[]).map((r) => r.version).join(",");
      probe.close();
      expect(before.split(",").length).toBe(69);
      expect(ledgerBefore).toBe("20260724_s42,20260725_s43,20260831_s44,20260901_s45,20260901_s46");
      let error: unknown;
      try {
        openDatabase(path);
      } catch (value) {
        error = value;
      }
      expect(String(error)).toContain("EXISTING_SCHEMA_INCOMPLETE");
      expect(String(error)).toContain("staff_members");
      expect(String(error)).toContain("dismissal_policies");
      expect(String(error)).toContain("teacher_class_assignments");
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("rejects a disposable valid schema with any single required table removed", () => {
    expect.assertions(REQUIRED_TABLES.length);
    const template = disposableDatabasePath("template");
    bootstrapDatabase(template);
    try {
      for (const table of REQUIRED_TABLES) {
        const path = disposableDatabasePath("drop-one");
        copyFileSync(template, path);
        try {
          const client = new Database(path);
          client.run(`PRAGMA foreign_keys = OFF`);
          client.run(`DROP TABLE IF EXISTS "${table}"`);
          client.close();
          expect(() => openDatabase(path)).toThrow(/EXISTING_SCHEMA_INCOMPLETE|missing tables/);
        } finally {
          unlinkSync(path);
        }
      }
    } finally {
      unlinkSync(template);
    }
  }, 600000);

  it("leaves an incomplete database byte-identical after failed validation", () => {
    const path = disposableDatabasePath("nonmutation");
    bootstrapDatabase(path);
    try {
      const client = new Database(path);
      client.run("DROP TABLE staff_members");
      client.close();
      const before = sha256FileSync(path);
      expect(() => openDatabase(path)).toThrow("EXISTING_SCHEMA_INCOMPLETE");
      expect(sha256FileSync(path)).toBe(before);
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("accepts a complete schema that carries benign extra tables", () => {
    const path = disposableDatabasePath("extras");
    bootstrapDatabase(path);
    try {
      const client = new Database(path);
      client.run("CREATE TABLE unrelated_legacy_notes (id INTEGER PRIMARY KEY, note TEXT)");
      client.close();
      const handle = openDatabase(path, { readonly: true });
      expect(handle.db).toBeDefined();
      handle.close();
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("fails closed when a required trigger is missing from an otherwise complete schema", () => {
    const path = disposableDatabasePath("missing-trigger");
    bootstrapDatabase(path);
    try {
      const client = new Database(path);
      client.run("DROP TRIGGER trg_student_master_change_history_no_delete");
      client.close();
      expect(() => openDatabase(path)).toThrow("DATABASE_SCHEMA_INVALID");
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("fails closed when the migration ledger is missing entirely", () => {
    const client = new Database(":memory:");
    expect(() => validateDatabase(client)).toThrow();
    client.close();
  });
});
