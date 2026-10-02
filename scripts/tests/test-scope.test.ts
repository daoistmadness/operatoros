import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildScope, classifyPath, FOCUSED_TESTS, gitPaths, pathsFromNameStatus } from "../test-scope";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const repository = resolve(import.meta.dir, "../..");
const cleanEnv = { ...process.env };
const variables = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
if (variables.exitCode !== 0) throw new Error("Git local environment discovery failed");
for (const name of variables.stdout.toString().trim().split("\n")) delete cleanEnv[name];
function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-test-scope-")); roots.push(root);
  git(root, "init", "-q");
  git(root, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
  return root;
}

describe("test scope decisions", () => {
  test.each([
    ["docs/guide.md", "DOCUMENTATION_ONLY"], ["apps/api/src/auth/session.ts", "BACKEND_AUTH"],
    ["apps/api/src/attendance-import.ts", "BACKEND_UPLOAD"], ["apps/api/src/attendance.ts", "BACKEND_ATTENDANCE"],
    ["apps/api/src/openapi-contract.ts", "BACKEND_API"], ["apps/api/src/health.ts", "BACKEND_UNIT"],
    ["apps/web/src/components/Card.tsx", "FRONTEND_COMPONENT"], ["apps/web/src/features/readiness/index.ts", "FRONTEND_FEATURE"],
    ["apps/web/src/routes/x.tsx", "FRONTEND_ROUTE"], ["apps/web/src/lib/api/client.ts", "FRONTEND_API_CLIENT"],
    ["apps/web/src/generated/openapi/schema.ts", "FRONTEND_GENERATED_CONTRACT"], ["packages/db/src/schema.ts", "DATABASE_PACKAGE"],
    ["packages/contracts/src/index.ts", "CONTRACTS_PACKAGE"], ["packages/ui/src/button.tsx", "UI_PACKAGE"],
    ["Makefile", "E2E_INFRASTRUCTURE"], ["e2e/run-smoke.sh", "E2E_INFRASTRUCTURE"],
    ["scripts/test-tier.sh", "E2E_INFRASTRUCTURE"], ["scripts/new-runner.sh", "UNKNOWN_HIGH_RISK"], ["unknown/x", "UNKNOWN_HIGH_RISK"],
  ])("%s selects %s", (path, category) => { expect(classifyPath(path)).toContain(category); });
  test("preserves unrelated entries and Windows separator normalization", () => {
    for (const path of ["PROJECT_CONTEXT.md", "f22", "docs/student-data/dapodik-roster-import-design.md"]) expect(classifyPath(path)).toEqual([]);
    expect(classifyPath(".\\apps\\web\\src\\routes\\x.tsx")).toEqual(["FRONTEND_ROUTE"]);
  });
  test("schema and unknown changes escalate; docs select no product suites", () => {
    for (const path of ["packages/db/src/schema.ts", "backend/src/models/student.py", "unknown/x"]) expect(buildScope([path]).backend_full_passes_required).toBe(2);
    const docs = buildScope(["docs/guide.md"]);
    expect(docs.documentation_only).toBe(true); expect(docs.focused_tests).toEqual([]); expect(docs.browser_scenarios).toEqual([]);
    expect(buildScope(["apps/web/src/routes/x.tsx"]).frontend_build_required).toBe(true);
    expect(buildScope(["apps/api/src/auth/session.ts"]).api_drift_required).toBe(true);
  });
  test("multiple files are order independent and preserve every risk", () => {
    const paths = ["docs/guide.md", "apps/web/src/routes/x.tsx", "apps/api/src/auth/session.ts"];
    const scope = buildScope(paths);
    expect(scope).toEqual(buildScope([...paths].reverse()));
    expect(scope.browser_scenarios).toEqual(["auth", "error-recovery"]);
    expect(scope.frontend_changed && scope.backend_changed).toBe(true);
    expect(scope.documentation_only).toBe(false);
  });
  test("deleted paths and both sides of rename/copy contribute", () => {
    expect(pathsFromNameStatus("D\tbackend/src/models/old.py\nR100\tapps/web/src/routes/old.tsx\tdocs/new.md\nC100\tpackages/db/a.ts\tpackages/contracts/b.ts\n")).toEqual([
      "apps/web/src/routes/old.tsx", "backend/src/models/old.py", "docs/new.md", "packages/contracts/b.ts", "packages/db/a.ts",
    ]);
  });
  test("every mapped test exists", () => {
    for (const tests of Object.values(FOCUSED_TESTS)) for (const path of tests) expect(existsSync(join(repository, path.startsWith("apps/api/") ? path : `apps/web/${path}`))).toBe(true);
  });
});

describe("Git change discovery", () => {
  test("untracked, staged rename, deleted paths, and base/head", () => {
    const repo = fixture();
    mkdirSync(join(repo, "packages/db"), { recursive: true });
    writeFileSync(join(repo, "packages/db/old.ts"), "synthetic source\n");
    writeFileSync(join(repo, "deleted.ts"), "synthetic deleted source\n");
    git(repo, "add", "packages/db/old.ts", "deleted.ts");
    git(repo, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "source");
    git(repo, "mv", "packages/db/old.ts", "packages/db/new.ts");
    rmSync(join(repo, "deleted.ts"));
    writeFileSync(join(repo, "untracked.ts"), "synthetic untracked source\n");
    writeFileSync(join(repo, "PROJECT_CONTEXT.md"), "preserved\n");
    expect(gitPaths(repo)).toEqual(["deleted.ts", "packages/db/new.ts", "packages/db/old.ts", "untracked.ts"]);
    expect(gitPaths(repo, "HEAD~1", "HEAD")).toEqual(["deleted.ts", "packages/db/old.ts"]);
  });
  test("explicit repo wins over inherited hook Git state", () => {
    const selected = fixture(), outer = fixture();
    writeFileSync(join(selected, "selected.ts"), "synthetic selected\n"); writeFileSync(join(outer, "outer.ts"), "synthetic outer\n");
    const result = Bun.spawnSync([process.execPath, join(repository, "scripts/test-scope.ts"), "--repo", selected], {
      env: { ...cleanEnv, GIT_DIR: join(outer, ".git"), GIT_WORK_TREE: outer, GIT_COMMON_DIR: join(outer, ".git"), GIT_INDEX_FILE: join(outer, ".git/index"), GIT_PREFIX: "" }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString()).changed_paths).toEqual(["selected.ts"]);
  });
});
