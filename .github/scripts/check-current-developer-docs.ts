import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REQUIRED_TASKS = ["doctor", "dev", "check:affected", "check:full", "test:fast", "db:fresh"];
const CURRENT_DOCS = ["AGENTS.md", "README.md", "COMMANDS.md", "CONTRIBUTING.md", "docs/README.md", "docs/development/README.md", "docs/testing/TEST_STRATEGY.md"];
const truthy = (value: unknown): boolean => value != null && value !== false && value !== 0 && value !== "" &&
  (typeof value !== "object" || Object.keys(value).length > 0);

export function currentDeveloperDocsProblems(root: string): string[] {
  const config = Bun.TOML.parse(readFileSync(join(root, "mise.toml"), "utf8")) as { tasks?: Record<string, unknown> };
  const problems: string[] = [];
  for (const task of REQUIRED_TASKS) {
    const definition = config.tasks?.[task];
    if (!definition || typeof definition !== "object" || Array.isArray(definition) || !truthy((definition as Record<string, unknown>).description)) problems.push(`mise task '${task}' must have a description`);
  }
  for (const document of CURRENT_DOCS) {
    const content = readFileSync(join(root, document), "utf8");
    for (const pattern of [/cd apps\/web && bun install(?: --frozen-lockfile)?/, /cd apps\/api && bun install(?: --frozen-lockfile)?/]) {
      if (pattern.test(content)) problems.push(`${document} contains obsolete workspace install guidance`);
    }
  }
  const commands = readFileSync(join(root, "COMMANDS.md"), "utf8");
  for (const task of REQUIRED_TASKS) if (!commands.includes(`mise run ${task}`)) problems.push(`COMMANDS.md is missing mise run ${task}`);
  if (!commands.includes("bun install --frozen-lockfile")) problems.push("COMMANDS.md must document root bun install --frozen-lockfile");
  return problems;
}

if (import.meta.main) {
  const problems = currentDeveloperDocsProblems(resolve(import.meta.dir, "../.."));
  if (problems.length) console.error(["Current developer documentation check: FAIL", ...problems.map((problem) => `- ${problem}`)].join("\n"));
  else console.log("Current developer documentation check: PASS");
  process.exitCode = problems.length ? 1 : 0;
}
