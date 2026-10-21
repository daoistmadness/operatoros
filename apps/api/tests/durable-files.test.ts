import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncDirectory, syncFile } from "../src/domains/durable-files";

describe("durable filesystem helpers", () => {
  it("flushes synthetic artifact bytes and the containing directory", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-durable-files-"));
    const artifact = join(root, "backup.synthetic");
    try {
      writeFileSync(artifact, "synthetic-encrypted-artifact", { mode: 0o600 });
      syncFile(artifact);
      syncDirectory(root);
      expect(readFileSync(artifact, "utf8")).toBe("synthetic-encrypted-artifact");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
