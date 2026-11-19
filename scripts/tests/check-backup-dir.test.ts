import { describe, expect, it } from "bun:test";
import { inspectBackupDirectory } from "../check-backup-dir";

const artifact = "backup_2026-11-18T19-00-14Z.sqlite3";
const metadata = `${artifact}.meta.json`;
const audit = "backup_operations_audit.jsonl";
const regular = () => true;

describe("backup directory containment", () => {
  it("accepts complete artifact/metadata pairs and the audit log", () => {
    expect(inspectBackupDirectory([artifact, metadata, audit], regular)).toEqual([]);
  });

  it("reports a plaintext database or any other unexpected entry", () => {
    const problems = inspectBackupDirectory([artifact, metadata, audit, "pre-cutover-20261119T042948Z.sqlite"], regular);
    expect(problems).toEqual(["unexpected entry: pre-cutover-20261119T042948Z.sqlite"]);
  });

  it("reports an artifact without metadata and metadata without an artifact", () => {
    expect(inspectBackupDirectory([artifact], regular)).toEqual([`incomplete pair: ${artifact} has no ${metadata}`]);
    expect(inspectBackupDirectory([metadata], regular)).toEqual([`incomplete pair: ${metadata} has no ${artifact}`]);
  });

  it("reports entries that are not regular files", () => {
    const problems = inspectBackupDirectory([artifact, metadata], (name) => name !== artifact);
    expect(problems).toEqual([`not a regular file: ${artifact}`]);
  });

  it("accepts collision-suffixed artifacts the runtime can publish", () => {
    const suffixed = "backup_2026-11-18T19-00-14Z_1.sqlite3";
    expect(inspectBackupDirectory([suffixed, `${suffixed}.meta.json`], regular)).toEqual([]);
  });
});
