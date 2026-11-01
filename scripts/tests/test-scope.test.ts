import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildScope, classifyPath, FOCUSED_TESTS, gitPaths, pathsFromNameStatus, scopeSummary } from "../test-scope";

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
  return result.stdout.toString().trim();
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
    ["apps/web/vite.config.js", "FRONTEND_BUILD_CONFIG"], ["apps/web/vite.preview.config.js", "FRONTEND_BUILD_CONFIG"],
    ["apps/web/vite.redact.preview.config.js", "FRONTEND_BUILD_CONFIG"], ["apps/web/vite.shared.js", "FRONTEND_BUILD_CONFIG"],
    ["apps/web/src/generated/openapi/schema.ts", "FRONTEND_GENERATED_CONTRACT"], ["packages/db/src/schema.ts", "DATABASE_PACKAGE"],
    ["packages/contracts/src/index.ts", "CONTRACTS_PACKAGE"], ["packages/ui/src/button.tsx", "UI_PACKAGE"],
    ["Makefile", "E2E_INFRASTRUCTURE"], ["e2e/run-smoke.sh", "E2E_INFRASTRUCTURE"],
    ["scripts/test-tier.sh", "E2E_INFRASTRUCTURE"], ["scripts/new-runner.sh", "UNKNOWN_HIGH_RISK"], ["unknown/x", "UNKNOWN_HIGH_RISK"],
  ])("%s selects %s", (path, category) => { expect(classifyPath(path)).toContain(category); });
  test("preserves unrelated entries and Windows separator normalization", () => {
    for (const path of ["PROJECT_CONTEXT.md", "f22", "docs/student-data/dapodik-roster-import-design.md"]) expect(classifyPath(path)).toEqual([]);
    expect(classifyPath(".\\apps\\web\\src\\routes\\x.tsx")).toEqual(["FRONTEND_ROUTE"]);
  });
  test("route and auth changes select migration guard, search, and cache tests", () => {
    expect(buildScope([
      "apps/web/src/App.tsx",
      "apps/web/src/lib/query/sessionCache.ts",
      "apps/web/src/lib/router/access.ts",
      "apps/web/src/routes/_authenticated.tsx",
    ]).focused_tests).toEqual([
      "src/components/auth/RouteGuards.test.tsx",
      "src/lib/query/sessionCache.test.ts",
      "src/lib/router/search.test.tsx",
      "src/routes/routeTree.test.tsx",
    ]);
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
  test("tier summary retains machine-consumed lines and ordering", () => {
    expect(scopeSummary(buildScope(["docs/guide.md"]))).toBe([
      "changed_paths=docs/guide.md", "risk_categories=DOCUMENTATION_ONLY", "focused_tests=", "browser_scenarios=",
      "frontend_changed=no", "ui_changed=no", "backend_changed=no", "schema_sensitive=no", "full_backend_required=no",
      "api_drift_required=no", "frontend_build_required=no", "documentation_only=yes", "backend_full_passes_required=0",
      "reason=docs/guide.md -> DOCUMENTATION_ONLY",
    ].join("\n"));
  });
  test("release gates and double-run policy remain", () => {
    const runner = readFileSync(join(repository, "scripts/test-tier.sh"), "utf8");
    const release = runner.split("  release)")[1]!;
    for (const required of ["fresh-db-parity", "backend_full", "bun run test", "bun run build", "e2e-validate", "e2e-smoke", "e2e-clean", "passes=2", "schema_sensitive", "RELEASE_DOUBLE_BACKEND"]) expect(release).toContain(required);
    expect(runner).toContain("test-tier-environment.sh"); expect(runner).not.toContain("protected_db_snapshot.py");
  });
  test("test tiers use a nonblocking per-worktree flock", () => {
    const runner = readFileSync(join(repository, "scripts/test-tier.sh"), "utf8");
    expect(runner).toContain('exec {tier_lock_fd}<"$repo/.git"');
    expect(runner).toContain('flock -n -x "$tier_lock_fd"');
    const root = mkdtempSync(join(tmpdir(), "operatoros-test-tier-lock-")); roots.push(root);
    mkdirSync(join(root, ".git"));
    const result = Bun.spawnSync(["bash", "-c", [
      'exec {lock_fd}<"$1/.git"',
      'flock -n -x "$lock_fd"',
      'flock -n -x "$1/.git" -c true',
    ].join("; "), "test", root], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
  });
  test("a second test tier acquires the worktree lock after the first exits", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-test-tier-lock-release-")); roots.push(root);
    mkdirSync(join(root, ".git"));
    const first = Bun.spawnSync(["bash", "-c", 'exec {lock_fd}<"$1/.git"; flock -n -x "$lock_fd"', "test", root], {
      env: cleanEnv, stdout: "pipe", stderr: "pipe",
    });
    expect(first.exitCode).toBe(0);
    const second = Bun.spawnSync(["bash", "-c", 'exec {lock_fd}<"$1/.git"; flock -n -x "$lock_fd"', "test", root], {
      env: cleanEnv, stdout: "pipe", stderr: "pipe",
    });
    expect(second.exitCode).toBe(0);
  });
  test("test-tier isolation removes inherited data paths and redirects fallback data", () => {
    const helper = join(repository, "scripts/test-tier-environment.sh");
    const result = Bun.spawnSync(["bash", "-c", [
      'source "$1"',
      'operatoros_test_tier_isolate_environment "$2"',
      'for name in DATABASE_URL DATABASE_PATH OPERATOROS_DATA_DIR OPERATOROS_DEV_DATA_DIR PROTECTED_DB_PATH BACKUP_DIR; do [[ -v "$name" ]] && printf "leaked=%s\\n" "$name"; done',
      'printf "xdg=%s\\n" "$XDG_DATA_HOME"',
    ].join("; "), "test", helper, "/tmp/operatoros-test-tier-synthetic/xdg"], {
      env: {
        ...cleanEnv,
        XDG_DATA_HOME: "/tmp/operatoros-test-tier-ambient/xdg",
        DATABASE_URL: "sqlite:////synthetic-canary/should-not-be-opened.sqlite",
        DATABASE_PATH: "/synthetic-canary/should-not-be-opened.sqlite",
        OPERATOROS_DATA_DIR: "/synthetic-canary/data",
        OPERATOROS_DEV_DATA_DIR: "/synthetic-canary/legacy-data",
        PROTECTED_DB_PATH: "/synthetic-canary/protected.sqlite",
        BACKUP_DIR: "/synthetic-canary/backups",
      }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe("xdg=/tmp/operatoros-test-tier-synthetic/xdg\n");
  });
  test("test-tier rejects unknown tiers before creating test resources", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-test-tier-runner-")); roots.push(root);
    const temporary = join(root, "tmp"); mkdirSync(temporary);
    const result = Bun.spawnSync(["bash", join(repository, "scripts/test-tier.sh"), "invalid-tier"], {
      cwd: repository,
      env: { ...cleanEnv, TMPDIR: temporary, DATABASE_URL: "sqlite:////synthetic-canary/should-not-be-opened.sqlite", OPERATOROS_DATA_DIR: "/synthetic-canary/data" },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("unknown tier: invalid-tier");
    expect(readdirSync(temporary)).toEqual([]);
  });
  test("test-tier cleanup preserves the failure code and cannot escape its temporary parent", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-test-tier-cleanup-")); roots.push(root);
    const parent = join(root, "tmp"); mkdirSync(parent);
    const testRoot = mkdtempSync(join(parent, "operatoros-test-tier."));
    writeFileSync(join(testRoot, "scope.json"), "synthetic\n");
    writeFileSync(join(parent, "preserve-canary"), "synthetic sibling\n");
    const helper = join(repository, "scripts/test-tier-environment.sh");
    const cleanup = Bun.spawnSync(["bash", "-c", [
      'source "$1"',
      'operatoros_test_tier_cleanup "$2" "$3" 23',
    ].join("; "), "test", helper, testRoot, parent], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
    expect(cleanup.exitCode).toBe(23);
    expect(existsSync(testRoot)).toBe(false);
    expect(readFileSync(join(parent, "preserve-canary"), "utf8")).toBe("synthetic sibling\n");

    const outside = join(root, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "preserve-canary"), "outside synthetic\n");
    const rejected = Bun.spawnSync(["bash", "-c", [
      'source "$1"',
      'operatoros_test_tier_cleanup "$2" "$3" 23',
    ].join("; "), "test", helper, `${parent}/operatoros-test-tier.fake/../../outside`, parent], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("Refusing unexpected test-tier cleanup path.");
    expect(readFileSync(join(outside, "preserve-canary"), "utf8")).toBe("outside synthetic\n");
  });
  test("test-tier cleanup rejects directory symlinks without deleting their target", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-test-tier-symlink-")); roots.push(root);
    const parent = join(root, "tmp"); mkdirSync(parent);
    const external = mkdtempSync(join(tmpdir(), "operatoros-test-tier-external.")); roots.push(external);
    writeFileSync(join(external, "preserve-canary"), "external synthetic\n");
    const link = join(parent, "operatoros-test-tier.symlink"); symlinkSync(external, link, "dir");
    const helper = join(repository, "scripts/test-tier-environment.sh");
    const rejected = Bun.spawnSync(["bash", "-c", [
      'source "$1"',
      'operatoros_test_tier_cleanup "$2" "$3" 23',
    ].join("; "), "test", helper, link, parent], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("Refusing unexpected test-tier cleanup path.");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(external)).toBe(true);
    expect(readFileSync(join(external, "preserve-canary"), "utf8")).toBe("external synthetic\n");
  });
  test("release scenario manifest matches browser tags without fixed sleeps", () => {
    const manifest = JSON.parse(readFileSync(join(repository, "e2e/release-scenarios.json"), "utf8")) as { groups: string[] };
    const specs = [...new Bun.Glob("*.spec.ts").scanSync({ cwd: join(repository, "e2e/smoke/web"), absolute: true })].sort().map(path => readFileSync(path, "utf8")).join("\n");
    expect(manifest.groups).toHaveLength(10); expect(new Set(manifest.groups).size).toBe(10);
    for (const group of manifest.groups) expect(specs).toContain(`@${group}`);
    expect(specs).not.toContain("waitForTimeout");
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

describe("E2E workflow scope selection", () => {
  const selector = join(repository, ".github/scripts/select-e2e-scope.sh");

  function runSelector(repo: string, baseSha?: string, event = "pull_request") {
    const output = join(repo, "github-output");
    const summary = join(repo, "github-summary");
    const result = Bun.spawnSync(["bash", selector], {
      cwd: repo,
      env: { ...cleanEnv, BASE_SHA: baseSha ?? "", GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      stdout: "pipe", stderr: "pipe",
    });
    return { result, output: existsSync(output) ? readFileSync(output, "utf8") : "", summary: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
  }

  function commitPath(repo: string, path: string, content = "synthetic change\n") {
    const target = join(repo, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
    git(repo, "add", "--", path);
    git(repo, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", `change ${path}`);
  }

  test.each([
    ["apps/api/src/change.ts", true],
    ["apps/web/src/change.tsx", true],
    ["packages/contracts/src/change.ts", true],
    ["bun.lock", true],
    [".github/workflows/ci.yml", true],
    [".github/actions/setup-bun/action.yml", true],
    ["unclassified.input", true],
    ["docs/example.json", true],
    ["docs/guide.md", true],
    [".github/dependabot.yml", true],
    ["hk.pkl", true],
    ["scripts/test-scope.ts", true],
    ["scripts/test-tier.sh", true],
    ["scripts/test-tier-environment.sh", true],
    ["scripts/tests/test-scope.test.ts", true],
    [".github/scripts/select-e2e-scope.sh", true],
    [".github/scripts/validate-e2e-result.sh", true],
  ])("%s selects E2E=%s", (path, expected) => {
    const repo = fixture();
    const base = git(repo, "rev-parse", "HEAD");
    commitPath(repo, path);
    const selected = runSelector(repo, base);
    expect(selected.result.exitCode).toBe(0);
    expect(selected.output).toContain(`run-e2e=${expected}`);
  });

  test("product-to-documentation rename remains E2E-relevant", () => {
    const repo = fixture();
    commitPath(repo, "apps/api/src/behavior.ts", "same synthetic contents\n");
    const base = git(repo, "rev-parse", "HEAD");
    mkdirSync(join(repo, "docs"), { recursive: true });
    git(repo, "mv", "apps/api/src/behavior.ts", "docs/behavior.md");
    git(repo, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "move behavior to docs");
    const selected = runSelector(repo, base);
    expect(selected.result.exitCode).toBe(0);
    expect(selected.output).toContain("run-e2e=true");
  });

  test("E2E aggregate rejects skipped, failed, cancelled, and missing runs", () => {
    const aggregate = join(repository, ".github/scripts/validate-e2e-result.sh");
    const run = (scope: string, selected: string, e2e: string) => Bun.spawnSync(["bash", aggregate], {
      env: { ...cleanEnv, E2E_SCOPE_RESULT: scope, E2E_SELECTED: selected, E2E_JOB_RESULT: e2e },
      stdout: "pipe", stderr: "pipe",
    });
    expect(run("success", "true", "success").exitCode).toBe(0);
    for (const result of [
      run("failure", "true", "success"),
      run("success", "true", "failure"),
      run("success", "true", "cancelled"),
      run("success", "true", ""),
      run("skipped", "", "skipped"),
      run("success", "false", "skipped"),
      run("success", "true", "skipped"),
      run("success", "false", "success"),
      run("success", "unknown", "skipped"),
    ]) expect(result.exitCode).toBe(1);
  });

  test("mandatory E2E runs for main pushes and cannot skip by path selection", () => {
    const workflow = Bun.YAML.parse(readFileSync(join(repository, ".github/workflows/ci.yml"), "utf8")) as {
      on: { push: { branches: string[] }; pull_request: { branches: string[] }; merge_group: unknown };
      jobs: Record<string, { name?: string; if?: string; needs?: string[]; steps?: { run?: string }[] }>;
    };
    expect(workflow.on.push.branches).toContain("main");
    expect(workflow.on.pull_request).toBeDefined();
    expect(workflow.on.merge_group).toBeDefined();
    expect(workflow.jobs.preflight?.name).toBe("preflight");
    expect(workflow.jobs.preflight?.if).toBe("github.event_name != 'schedule'");
    expect(workflow.jobs.preflight?.steps?.some((step) => step.run === "bun run skills:validate")).toBe(true);
    expect(workflow.jobs.preflight?.steps?.some((step) => step.run === "bunx --no-install --package @tanstack/intent intent maintainer check --base FETCH_HEAD --github-summary")).toBe(true);
    expect(workflow.jobs.api?.needs).toEqual(["preflight"]);
    expect(workflow.jobs.changes?.needs).toEqual(["preflight"]);
    expect(workflow.jobs["e2e-full"]?.name).toBe("E2E full regression");
    expect(workflow.jobs["e2e-full"]?.if).toBe("github.event_name != 'schedule'");
    expect(workflow.jobs["e2e-full"]?.needs).toEqual(["preflight"]);
    expect(workflow.jobs["e2e-full"]?.steps?.some((step) => step.run === "timeout 900 make e2e-smoke")).toBe(true);
    expect(workflow.jobs.api?.steps?.some((step) => step.run?.includes("bun run turbo:check"))).toBe(true);
    expect(workflow.jobs.api?.steps?.some((step) => step.run === "bun run test:security")).toBe(false);
    expect(workflow.jobs.audit?.if).toBe("github.event.schedule == '17 3 * * 1'");
    expect(workflow.jobs.result?.if).toBe("always() && github.event_name != 'schedule'");
    expect(workflow.jobs.result?.needs).toEqual(["changes", "e2e-full"]);
  });
  test("preflight falls back to the event SHA when a push has a zero before SHA", () => {
    const workflow = Bun.YAML.parse(readFileSync(join(repository, ".github/workflows/ci.yml"), "utf8")) as {
      jobs: Record<string, { steps?: { name?: string; env?: Record<string, string>; run?: string }[] }>;
    };
    const step = workflow.jobs.preflight?.steps?.find(({ name }) => name === "Fetch base for skill freshness check");
    const root = mkdtempSync(join(tmpdir(), "operatoros-preflight-base-")); roots.push(root);
    const bin = join(root, "bin"); mkdirSync(bin);
    const fetchSha = join(root, "fetch-sha");
    const fakeGit = join(bin, "git");
    writeFileSync(fakeGit, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1" == "fetch" ]]; then',
      '  printf "%s\\n" "$4" > "$CAPTURE_FETCH_SHA"',
      "  exit 0",
      "fi",
      "exit 64",
    ].join("\n"));
    chmodSync(fakeGit, 0o755);
    const fallbackSha = "a".repeat(40);
    const result = Bun.spawnSync(["bash", "-c", step?.run ?? "exit 1"], {
      env: {
        ...cleanEnv,
        PATH: `${bin}:${cleanEnv.PATH ?? ""}`,
        INTENT_BASE_SHA: "0".repeat(40),
        INTENT_FALLBACK_SHA: fallbackSha,
        CAPTURE_FETCH_SHA: fetchSha,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(fetchSha, "utf8").trim()).toBe(fallbackSha);
    expect(step?.env?.INTENT_BASE_SHA).toBe("${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || github.sha }}");
    expect(step?.env?.INTENT_FALLBACK_SHA).toBe("${{ github.sha }}");
  });

  test("workflow concurrency cancels only superseded pull-request runs", () => {
    for (const workflow of ["ci.yml"]) {
      const source = readFileSync(join(repository, ".github/workflows", workflow), "utf8");
      expect(source).toContain("group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}");
      expect(source).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    }
  });

  test.each([
    ["missing base", "", "pull_request"],
    ["invalid base", "deadbeef", "pull_request"],
    ["manual dispatch", "", "workflow_dispatch"],
  ])("%s fails closed", (_label, base, event) => {
    const repo = fixture();
    const selected = runSelector(repo, base, event);
    expect(selected.result.exitCode).toBe(0);
    expect(selected.output).toContain("run-e2e=true");
  });
});
