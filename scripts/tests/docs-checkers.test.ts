import { afterEach, expect, test } from "bun:test";
import { changelogProblems } from "../../.github/scripts/check-changelog.ts";
import { markdownOrganizationProblems } from "../../.github/scripts/check-markdown-organization.ts";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../.."), roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-doc-checkers-")); roots.push(root);
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  for (const path of ["README.md", "AGENTS.md", "CHANGELOG.md", "COMMANDS.md", "CONVENTIONS.md", "MEMORY.md", "ERRORS.md", ".github/CI.md", ".github/pull_request_template.md", "packages/agent-skills/docs/elysiajs.md", "packages/agent-skills/skills/elysiajs/SKILL.md", "backend/README.md", "apps/web/README.md", "CONTRIBUTING.md"]) write(path, "");
  write("docs/README.md", "# Docs\n\n[Development](guides/development.md)\n[Testing](guides/testing.md)\n");
  for (const path of ["docs/guides/development.md", "docs/guides/testing.md"]) write(path, "---\nstatus: current\nlast_reviewed: 2026-10-26\n---\n\n# Guide\n");
  const tasks = ["doctor", "dev", "check:affected", "check:full", "test:fast", "db:fresh"];
  write("mise.toml", tasks.map((task) => `[tasks."${task}"]\ndescription = "Synthetic task"\n`).join("\n"));
  write("COMMANDS.md", tasks.map((task) => `mise run ${task}`).join("\n") + "\nbun install --frozen-lockfile\n");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  for (const path of ["check-markdown-links.ts", "check-current-developer-docs.ts", "check-markdown-organization.ts"]) copyFileSync(join(repo, ".github/scripts", path), join(root, ".github/scripts", path));
  return { root, write };
}
function check(root: string, tool: "links" | "docs" | "organization") {
  const file = tool === "links" ? "check-markdown-links.ts" : tool === "docs" ? "check-current-developer-docs.ts" : "check-markdown-organization.ts";
  const value = Bun.spawnSync([process.execPath, join(root, ".github/scripts", file)], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: value.exitCode, stdout: value.stdout.toString(), stderr: value.stderr.toString() };
}
test("documentation checkers pass an aligned controlled repository", () => {
  const f = fixture();
  expect(check(f.root, "links")).toEqual({ code: 0, stdout: "Markdown links look valid.\n", stderr: "" });
  expect(check(f.root, "docs")).toEqual({ code: 0, stdout: "Current developer documentation check: PASS\n", stderr: "" });
  expect(check(f.root, "organization")).toEqual({ code: 0, stdout: "Markdown organization looks valid.\n", stderr: "" });
});
test("links preserve exclusions, URL/query/fragment handling, image rules, and diagnostic ordering", () => {
  const f = fixture(); f.write("README.md", "[valid](docs/README.md#section?x=1) [query](docs/README.md?x=1#section) [remote](https://example.invalid) [mail](mailto:test@example.invalid) [anchor](#section) [missing](missing.md) ![image](missing.png) ![](empty-alt.png)");
  f.write("PROJECT_CONTEXT.md", "[ignored](missing-context.md)"); f.write("docs/reference/old.md", "[missing historical](missing-historical.md)");
  f.write("docs/a.md", "[relative](../README.md) [bad](not-found.md)");
  const result = check(f.root, "links"); expect(result.code).toBe(1); expect(result.stderr).toBe("");
  expect(result.stdout).toBe("README.md -> missing.md\nREADME.md -> missing.png\nREADME.md -> empty-alt.png\ndocs/a.md -> not-found.md\ndocs/reference/old.md -> missing-historical.md\n");
});
test("developer diagnostics preserve TOML quoted task names and Python truthiness", () => {
  const f = fixture(); f.write("mise.toml", '[tasks.doctor]\ndescription = []\n[tasks.dev]\ndescription = {}\n[tasks."check:affected"]\ndescription = false\n[tasks."check:full"]\ndescription = ""\n[tasks."test:fast"]\ndescription = 0\n[tasks."db:fresh"]\ndescription = "Synthetic"\n');
  f.write("README.md", "cd apps/web && bun install --frozen-lockfile\ncd apps/api && bun install\n"); f.write("COMMANDS.md", "");
  const result = check(f.root, "docs"); expect(result.code).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr).toBe([
    "Current developer documentation check: FAIL",
    ...["doctor", "dev", "check:affected", "check:full", "test:fast"].map(task => `- mise task '${task}' must have a description`),
    "- README.md contains obsolete workspace install guidance", "- README.md contains obsolete workspace install guidance",
    ...["doctor", "dev", "check:affected", "check:full", "test:fast", "db:fresh"].map(task => `- COMMANDS.md is missing mise run ${task}`),
    "- COMMANDS.md must document root bun install --frozen-lockfile", "",
  ].join("\n"));
});

test("organization checker rejects loose docs, missing metadata, and an incomplete index", () => {
  const f = fixture();
  f.write("notes.md", "# Loose root note\n");
  f.write("docs/loose.md", "---\nstatus: current\nlast_reviewed: 2026-10-26\n---\n");
  f.write("docs/guides/unlisted.md", "# Missing metadata\n");
  f.write("docs/archive/old.md", "# Old\n");
  f.write("docs/reference/Title Case.md", "---\nstatus: current\nlast_reviewed: 2026-10-26\n---\n");
  f.write("docs/README.md", "# Docs\n\n[Development](guides/development.md)\n[Development again](guides/development.md)\n[Testing](guides/testing.md)\n");
  const problems = markdownOrganizationProblems(f.root);
  expect(problems).toContain("notes.md is outside the approved Markdown locations");
  expect(problems).toContain("docs/loose.md must live in an approved docs section");
  expect(problems).toContain("docs/guides/unlisted.md needs status and last_reviewed front matter");
  expect(problems).toContain("docs/guides/unlisted.md must appear exactly once in docs/README.md (found 0)");
  expect(problems).toContain("docs/archive/old.md must live in an approved docs section");
  expect(problems).toContain("docs/reference/Title Case.md must use a kebab-case Markdown filename");
  expect(problems).toContain("docs/README.md links to docs/guides/development.md more than once");
});

test("changelog checker requires a PR-specific Unreleased entry unless labeled", () => {
  const content = "# Changelog\n\n## [Unreleased]\n### Changed\n- Reorganized documentation (#42)\n\n## [1.0.0]\n";
  expect(changelogProblems({ changedFiles: ["CHANGELOG.md"], content, prNumber: 42, skipLabel: false })).toEqual([]);
  expect(changelogProblems({ changedFiles: [], content, prNumber: 42, skipLabel: false })).toEqual([
    "The pull request must change CHANGELOG.md",
  ]);
  expect(changelogProblems({ changedFiles: [], content, prNumber: 41, skipLabel: false })).toEqual([
    "The pull request must change CHANGELOG.md",
    "Add an Unreleased changelog entry ending in (#41)",
  ]);
  expect(changelogProblems({ changedFiles: [], content, prNumber: 42, skipLabel: true })).toEqual([]);
});
