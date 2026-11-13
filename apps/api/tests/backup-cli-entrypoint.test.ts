import { expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import { isBackupCliEntrypoint } from "../src/backup-cli";

it("runs the lock wrapper only when backup-cli is the direct entrypoint", () => {
  const bundledRunner = "/app/apps/api/dist/backup-cli-runner.mjs";
  expect(isBackupCliEntrypoint(bundledRunner, pathToFileURL(bundledRunner).href)).toBe(false);

  for (const entrypoint of ["/app/apps/api/src/backup-cli.ts", "/app/apps/api/dist/backup-cli.mjs"]) {
    expect(isBackupCliEntrypoint(entrypoint, pathToFileURL(entrypoint).href)).toBe(true);
  }
});
