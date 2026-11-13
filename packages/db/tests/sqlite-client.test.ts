import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteConnection } from "../src/sqlite-client";

describe("better-sqlite3 client boundary", () => {
  it("preserves positional, array, and named bindings and normalizes missing rows", () => {
    const { client } = openSqliteConnection(":memory:");
    try {
      client.exec("CREATE TABLE values_for_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      const inserted = client.query("INSERT INTO values_for_test (id, value) VALUES (?, ?)").run([1, "first"]);
      expect(inserted).toEqual({ changes: 1, lastInsertRowid: 1 });
      client.run("INSERT INTO values_for_test (id, value) VALUES (@id, @value)", { id: 2, value: "second" });
      expect(client.query("SELECT value FROM values_for_test WHERE id = ?").get(1)).toEqual({ value: "first" });
      expect(client.query("SELECT value FROM values_for_test WHERE id = ?").all([2])).toEqual([{ value: "second" }]);
      expect(client.query("SELECT value FROM values_for_test WHERE id = ?").get(99)).toBeNull();
      client.exec("CREATE TABLE blobs_for_test (value BLOB NOT NULL)");
      const typedValue = new Uint16Array([258, 514]);
      client.run("INSERT INTO blobs_for_test VALUES (?)", typedValue);
      const storedBytes = client.query("SELECT value FROM blobs_for_test").get()?.value as Uint8Array;
      expect([...storedBytes]).toEqual([...new Uint8Array(typedValue.buffer)]);

      client.exec("CREATE TABLE booleans_for_test (value INTEGER NOT NULL)");
      client.run("INSERT INTO booleans_for_test VALUES (?)", true);
      expect(client.query("SELECT value FROM booleans_for_test").get()).toEqual({ value: 1 });
      client.exec("INSERT INTO values_for_test (value) VALUES ('third'); INSERT INTO values_for_test (value) VALUES ('fourth')");
      expect(client.query("SELECT value FROM values_for_test ORDER BY id").all()).toEqual([
        { value: "first" }, { value: "second" }, { value: "third" }, { value: "fourth" },
      ]);
    } finally {
      client.close();
    }
  });

  it("preserves immediate and exclusive transaction modes and rolls back failures", () => {
    const { client } = openSqliteConnection(":memory:");
    try {
      client.exec("CREATE TABLE values_for_test (value TEXT NOT NULL)");
      client.transaction(() => client.run("INSERT INTO values_for_test VALUES (?)", "immediate")).immediate();
      const beforeRollback = client.query("SELECT count(*) AS count FROM values_for_test").get()?.count;
      expect(() => client.transaction(() => {
        client.run("INSERT INTO values_for_test VALUES (?)", "rolled-back");
        throw new Error("synthetic rollback");
      }).immediate()).toThrow("synthetic rollback");
      client.transaction(() => client.run("INSERT INTO values_for_test VALUES (?)", "exclusive")).exclusive();
      expect(client.query("SELECT value FROM values_for_test ORDER BY rowid").all()).toEqual([
        { value: "immediate" },
        { value: "exclusive" },
      ]);
      expect(beforeRollback).toBe(1);
    } finally {
      client.close();
    }
  });

  it("serializes committed WAL content into a restorable SQLite snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-sqlite-client-"));
    const sourcePath = join(root, "source.sqlite");
    const snapshotPath = join(root, "snapshot.sqlite");
    const source = openSqliteConnection(sourcePath);
    try {
      source.client.run("PRAGMA journal_mode = WAL");
      source.client.run("PRAGMA wal_autocheckpoint = 0");
      source.client.exec("CREATE TABLE sentinel (value TEXT NOT NULL)");
      source.client.run("INSERT INTO sentinel VALUES (?)", "synthetic-snapshot-sentinel");
      expect(statSync(`${sourcePath}-wal`).size).toBeGreaterThan(0);

      const snapshot = source.client.serialize();
      writeFileSync(snapshotPath, snapshot, { flag: "wx", mode: 0o600 });
      const restored = openSqliteConnection(snapshotPath, { readonly: true, fileMustExist: true });
      try {
        expect(restored.client.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        expect(restored.client.query("SELECT value FROM sentinel").get()).toEqual({ value: "synthetic-snapshot-sentinel" });
      } finally {
        restored.client.close();
      }
    } finally {
      source.client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
