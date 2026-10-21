import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

test("rejects privileged Podman host ports before invoking Podman", () => {
  const root = join(import.meta.dir, "../..");
  const bin = mkdtempSync(join(tmpdir(), "operatoros-podman-test-"));
  const podman = join(bin, "podman");
  const calls = join(bin, "podman-calls");
  writeFileSync(podman, '#!/bin/sh\nprintf called >> "$PODMAN_CALL_LOG"\n', "utf8");
  chmodSync(podman, 0o755);

  try {
    const result = Bun.spawnSync(["bash", "scripts/podman-dev.sh"], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, OPERATOROS_PODMAN_PORT: "1023", PODMAN_CALL_LOG: calls },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });

    expect(result.exitCode).toBe(2);
    expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain("port from 1024 to 65535");
    expect(existsSync(calls)).toBe(false);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
