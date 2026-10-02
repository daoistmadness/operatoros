import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../.."), roots: string[] = [];
const oracle = Bun.spawnSync([process.execPath, join(repo, "scripts/python-tooling-env.ts"), "--repo", repo, "print-executable"], { stdout: "pipe", stderr: "pipe" });
if (oracle.exitCode !== 0) throw new Error(oracle.stderr.toString());
const python = oracle.stdout.toString().trim();
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-doc-checkers-")); roots.push(root);
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  for (const path of ["README.md", "AGENTS.md", "PROJECT_CONTEXT.md", "COMMANDS.md", "CONVENTIONS.md", "MEMORY.md", "ERRORS.md", "backend/README.md", "apps/web/README.md", "CONTRIBUTING.md", "docs/README.md", "docs/development/README.md", "docs/testing/TEST_STRATEGY.md"]) write(path, "");
  const tasks = ["doctor", "dev", "check:affected", "check:full", "test:fast", "db:fresh"];
  write("mise.toml", tasks.map((task) => `[tasks."${task}"]\ndescription = "Synthetic task"\n`).join("\n"));
  write("COMMANDS.md", tasks.map((task) => `mise run ${task}`).join("\n") + "\nbun install --frozen-lockfile\n");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  for (const path of ["check_markdown_links.py", "check_current_developer_docs.py", "check-markdown-links.ts", "check-current-developer-docs.ts"]) copyFileSync(join(repo, ".github/scripts", path), join(root, ".github/scripts", path));
  return { root, write };
}
function parity(root: string, tool: "links" | "docs") {
  const files = tool === "links" ? ["check_markdown_links.py", "check-markdown-links.ts"] : ["check_current_developer_docs.py", "check-current-developer-docs.ts"];
  const results = files.map((file, index) => {
    const value = Bun.spawnSync([index ? process.execPath : python, join(root, ".github/scripts", file)], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
    return { code: value.exitCode, stdout: value.stdout.toString(), stderr: value.stderr.toString() };
  });
  expect(results[1]).toEqual(results[0]); return results[0]!;
}
test("both checkers pass an aligned controlled repository", () => {
  const f = fixture(); expect(parity(f.root, "links").code).toBe(0); expect(parity(f.root, "docs").code).toBe(0);
});
test("links preserve exclusions, URL/query/fragment handling, image rules, and diagnostic ordering", () => {
  const f = fixture(); f.write("README.md", "[valid](docs/README.md#section?x=1) [query](docs/README.md?x=1#section) [remote](https://example.invalid) [mail](mailto:test@example.invalid) [anchor](#section) [missing](missing.md) ![image](missing.png) ![](empty-alt.png)");
  f.write("PROJECT_CONTEXT.md", "[ignored](missing-context.md)"); f.write("docs/product-audit/old.md", "[ignored](missing-historical.md)");
  f.write("docs/a.md", "[relative](../README.md) [bad](not-found.md)");
  const result = parity(f.root, "links"); expect(result.code).toBe(1);
  expect(result.stdout).toBe("README.md -> missing.md\nREADME.md -> missing.png\nREADME.md -> empty-alt.png\ndocs/a.md -> not-found.md\n");
});
test("developer diagnostics preserve TOML quoted task names and Python truthiness", () => {
  const f = fixture(); f.write("mise.toml", '[tasks.doctor]\ndescription = []\n[tasks.dev]\ndescription = {}\n[tasks."check:affected"]\ndescription = false\n[tasks."check:full"]\ndescription = ""\n[tasks."test:fast"]\ndescription = 0\n[tasks."db:fresh"]\ndescription = "Synthetic"\n');
  f.write("README.md", "cd apps/web && bun install --frozen-lockfile\ncd apps/api && bun install\n"); f.write("COMMANDS.md", "");
  const result = parity(f.root, "docs"); expect(result.code).toBe(1); expect(result.stderr).toContain("mise task 'doctor' must have a description");
  expect(result.stderr).toContain("COMMANDS.md must document root bun install --frozen-lockfile");
});
