#!/usr/bin/env bun
/** Temporary test-scope oracle; DB/runtime baselines were retired after their cutovers. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
const repository = resolve(import.meta.dir, "../../..");
type Result = { exitCode: number; stdout: unknown; stderr: string };
function compare(name: string, python: Result, typescript: Result) {
  return { name, matched: isDeepStrictEqual(python, typescript), python, typescript };
}
export async function runParity() {
  const resolver = Bun.spawnSync([process.execPath, join(repository, "scripts/python-tooling-env.ts"), "--repo", repository, "print-executable"], { stdout: "pipe", stderr: "pipe" });
  if (resolver.exitCode) throw new Error(resolver.stderr.toString());
  const python = resolver.stdout.toString().trim(), root = mkdtempSync(join(tmpdir(), "operatoros-scope-parity-"));
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  const results: ReturnType<typeof compare>[] = [];
  const run = (executable: string, script: string, args: string[]): Result => {
    const result = Bun.spawnSync([executable, join(repository, script), ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    let stdout: unknown = result.stdout.toString().trim();
    try { stdout = JSON.parse(stdout as string); } catch {}
    return { exitCode: result.exitCode, stdout, stderr: result.stderr.toString().trim() };
  };
  try {
    const paths = [
      "apps/api/src/core/health.ts", "apps/api/src/auth/session.ts", "apps/api/src/attendance-import.ts", "apps/api/src/attendance.ts", "apps/api/src/openapi-contract.ts", "apps/api/tests/core.test.ts",
      "apps/web/src/components/Card.tsx", "apps/web/src/features/readiness/index.ts", "apps/web/src/routes/index.tsx", "apps/web/src/lib/api/client.ts", "apps/web/src/generated/openapi/schema.ts", "apps/web/vite.config.ts", "apps/web/playwright.config.ts",
      "packages/db/src/schema.ts", "packages/contracts/src/index.ts", "packages/ui/src/button.tsx", "docs/guide.md", "README.md", "e2e/run-smoke.sh", "e2e/fixtures/example.xlsx", "scripts/test-tier.sh", "scripts/new-tool.ts", "Makefile", "unknown/source.xyz",
      "backend/src/main.py", "backend/src/models/student.py", "backend/migrations/new.sql", "backend/src/security/dependencies.py", "backend/src/services/upload.py", "backend/src/services/attendance.py", "backend/tests/fixtures/seed.py", "PROJECT_CONTEXT.md", "f22", "docs/student-data/dapodik-roster-import-design.md", ".\\apps\\web\\src\\routes\\x.tsx",
    ];
    for (const changed of [...paths.map((path) => [path]), paths, ["docs/a.md", "apps/api/src/auth/session.ts", "packages/db/src/schema.ts"]]) {
      const args = changed.flatMap((path) => ["--changed-file", path]);
      const reference = run(python, "scripts/test_scope.py", args);
      if (reference.exitCode !== 0) throw new Error(`Python scope baseline failed: ${JSON.stringify(reference)}`);
      results.push(compare(`scope:${changed.length === 1 ? changed[0] : `mixed-${changed.length}`}`, reference, run(process.execPath, "scripts/test-scope.ts", args)));
    }
    return results;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (import.meta.main) {
  try {
    const cases = await runParity();
    console.log(JSON.stringify({ cases: cases.length, matched: cases.filter(item => item.matched).length, mismatches: cases.filter(item => !item.matched) }, null, 2));
    process.exitCode = cases.every(item => item.matched) ? 0 : 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
