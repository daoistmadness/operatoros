import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDatabaseMigrationSafe,
  ensureOperatorOSDirectories,
  resolveOperatorOSPaths,
} from "../src/data-dir";

const repositoryRoot = "/tmp/operatoros-data-dir-test-repository";
const commonDirectory = "/tmp/operatoros-data-dir-test-common.git";

function paths(env: Record<string, string | undefined>) {
  return resolveOperatorOSPaths({ env, repositoryRoot, commonDirectory, homeDirectory: "/tmp/operatoros-home" });
}

describe("canonical local data paths", () => {
  it("derives normalized child paths from an explicit absolute root", () => {
    const root = "/tmp/operatoros-data-dir/../operatoros-data-dir/instance";
    const value = paths({ OPERATOROS_DATA_DIR: root });
    expect(value.dataDir).toBe("/tmp/operatoros-data-dir/instance");
    expect(value.databasePath).toBe(join(value.dataDir, "operatoros.sqlite"));
    expect(value.backupDir).toBe(join(value.dataDir, "backups"));
    expect(value.logDir).toBe(join(value.dataDir, "logs"));
    expect(value.source).toBe("explicit");
  });

  it("preserves repository identity in the XDG default", () => {
    const value = paths({ XDG_DATA_HOME: "/tmp/operatoros-xdg" });
    const again = paths({ XDG_DATA_HOME: "/tmp/operatoros-xdg" });
    expect(value.dataDir).toBe(again.dataDir);
    expect(value.dataDir).toContain("/operatoros/development/");
    expect(value.source).toBe("default");
    expect(value.repositoryId).toHaveLength(16);
  });

  it("uses the legacy root only when the canonical root is absent", () => {
    const legacy = paths({ OPERATOROS_DEV_DATA_DIR: "/tmp/operatoros-legacy" });
    const canonical = paths({ OPERATOROS_DATA_DIR: "/tmp/operatoros-current", OPERATOROS_DEV_DATA_DIR: "/tmp/operatoros-legacy" });
    expect(legacy.dataDir).toBe("/tmp/operatoros-legacy");
    expect(legacy.source).toBe("legacy");
    expect(canonical.dataDir).toBe("/tmp/operatoros-current");
    expect(canonical.source).toBe("explicit");
  });

  it("rejects a relative explicit root", () => {
    expect(() => paths({ OPERATOROS_DATA_DIR: "relative-data" })).toThrow("DATA_DIR_PATH_NOT_ABSOLUTE");
  });

  it("creates only the canonical data directories", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-data-dir-"));
    rmSync(root, { recursive: true, force: true });
    const value = paths({ OPERATOROS_DATA_DIR: root });
    ensureOperatorOSDirectories(value);
    expect(existsSync(value.dataDir)).toBe(true);
    expect(existsSync(value.backupDir)).toBe(true);
    expect(existsSync(value.logDir)).toBe(true);
    expect(existsSync(value.databasePath)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses an old database when the new location is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-data-dir-migration-"));
    const value = paths({ OPERATOROS_DATA_DIR: root });
    writeFileSync(value.legacyDatabasePath, "synthetic legacy marker");
    expect(() => assertDatabaseMigrationSafe(value)).toThrow("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
    expect(existsSync(value.databasePath)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not mutate an operator-looking directory during isolated resolution", () => {
    const operatorRoot = mkdtempSync(join(tmpdir(), "operatoros-operator-looking-"));
    const testRoot = mkdtempSync(join(tmpdir(), "operatoros-test-looking-"));
    const value = paths({ OPERATOROS_DATA_DIR: testRoot, OPERATOROS_DEV_DATA_DIR: operatorRoot });
    ensureOperatorOSDirectories(value);
    expect(existsSync(join(operatorRoot, "operatoros.sqlite"))).toBe(false);
    rmSync(operatorRoot, { recursive: true, force: true });
    rmSync(testRoot, { recursive: true, force: true });
  });
});
