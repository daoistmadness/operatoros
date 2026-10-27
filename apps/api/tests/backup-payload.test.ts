import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBackupPayload, isBackupPayload, writeBackupPayload } from "../src/security/backup-payload";

it("round trips the database and unique attachments with exact bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-backup-payload-"));
  const database = Buffer.from("synthetic database snapshot\0with bytes");
  const report = Buffer.from("synthetic xlsx workbook bytes\0with formulas");
  const databasePath = join(root, "database.sqlite");
  const reportPath = join(root, "report.xlsx");
  const payloadPath = join(root, "backup.payload");
  const contents = join(root, "contents");
  try {
    writeFileSync(databasePath, database);
    writeFileSync(reportPath, report);
    const sha256 = createHash("sha256").update(report).digest("hex");
    const payload = writeBackupPayload(databasePath, [{ path: reportPath, sha256, sizeBytes: report.byteLength }], payloadPath);
    expect(isBackupPayload(payloadPath)).toBe(true);
    expect(payload.databaseSizeBytes).toBe(database.byteLength);
    expect(payload.attachments).toEqual([{ sha256, sizeBytes: report.byteLength }]);
    const extracted = extractBackupPayload(payloadPath, contents);
    expect(readFileSync(extracted.databasePath)).toEqual(database);
    expect(readFileSync(extracted.attachments[0]!.path)).toEqual(report);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("rejects truncated and modified payload content and leaves no extracted files", () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-backup-payload-invalid-"));
  const databasePath = join(root, "database.sqlite");
  const payloadPath = join(root, "backup.payload");
  const corruptedPath = join(root, "corrupted.payload");
  const truncatedPath = join(root, "truncated.payload");
  const contents = join(root, "contents");
  try {
    writeFileSync(databasePath, "synthetic database");
    writeBackupPayload(databasePath, [], payloadPath);
    const corrupted = readFileSync(payloadPath);
    corrupted.writeUInt8(corrupted.readUInt8(corrupted.length - 1) ^ 1, corrupted.length - 1);
    writeFileSync(corruptedPath, corrupted);
    writeFileSync(truncatedPath, readFileSync(payloadPath).subarray(0, 12));
    expect(() => extractBackupPayload(corruptedPath, contents)).toThrow("BACKUP_DATABASE_CHECKSUM_MISMATCH");
    expect(() => extractBackupPayload(truncatedPath, contents)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
