import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length) await rm(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("TSRS typecheck exit compatibility", () => {
  for (const [tsrsStatus, expectedStatus] of [[0, 0], [1, 1], [2, 1], [42, 42]]) {
    test(`maps TSRS exit ${tsrsStatus} to ${expectedStatus}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "operatoros-tsrs-exit-"));
      temporaryRoots.push(root);
      const bin = join(root, "bin");
      await mkdir(bin);
      await writeFile(join(bin, "tsrs"), `#!/usr/bin/env bash\nexit ${tsrsStatus}\n`);
      await chmod(join(bin, "tsrs"), 0o755);
      const result = spawnSync("bash", [join(import.meta.dir, "../typecheck-tsrs.sh")], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });
      expect(result.status).toBe(expectedStatus);
    });
  }

  test("maps TypeScript diagnostics to tsc's program-error exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "operatoros-tsrs-type-error-"));
    temporaryRoots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tsrs"), "#!/usr/bin/env bash\nprintf '%s\\n' 'file.ts(1,1): error TS2322: type mismatch'\nexit 2\n");
    await chmod(join(bin, "tsrs"), 0o755);
    const result = spawnSync("bash", [join(import.meta.dir, "../typecheck-tsrs.sh")], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("TS2322");
  });

  test("preserves tsc's command-line exit code for a missing source file", async () => {
    const root = await mkdtemp(join(tmpdir(), "operatoros-tsrs-missing-file-"));
    temporaryRoots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tsrs"), "#!/usr/bin/env bash\nprintf '%s\\n' 'error TS6053: File missing.ts not found.'\nexit 2\n");
    await chmod(join(bin, "tsrs"), 0o755);
    const result = spawnSync("bash", [join(import.meta.dir, "../typecheck-tsrs.sh")], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("TS6053");
  });
});
