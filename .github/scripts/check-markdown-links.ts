import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export function markdownLinkProblems(root: string): string[] {
  const files = ["README.md", "AGENTS.md", "PROJECT_CONTEXT.md", "COMMANDS.md", "CONVENTIONS.md", "MEMORY.md", "ERRORS.md", "apps/web/README.md"];
  if (existsSync(join(root, "docs"))) files.push(...[...new Bun.Glob("**/*.md").scanSync({ cwd: join(root, "docs"), onlyFiles: true, dot: true })].sort().map((path) => `docs/${path}`));
  const problems: string[] = [];
  for (const file of files) {
    if (file === "PROJECT_CONTEXT.md" || file === "docs/product-audit" || file.startsWith("docs/product-audit/")) continue;
    const path = join(root, file), content = readFileSync(path, "utf8");
    for (const pattern of [/(?<!!)\[[^\]]+\]\(([^)]+)\)/g, /!\[[^\]]*\]\(([^)]+)\)/g]) {
      for (const match of content.matchAll(pattern)) {
        const target = match[1]!.trim();
        if (!target || /^(https?:\/\/|mailto:|#)/.test(target)) continue;
        const destination = target.split("#", 1)[0]!.split("?", 1)[0]!;
        if (!existsSync(resolve(dirname(path), destination))) problems.push(`${relative(root, path)} -> ${target}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = markdownLinkProblems(resolve(import.meta.dir, "../.."));
  console.log(problems.length ? problems.join("\n") : "Markdown links look valid.");
  process.exitCode = problems.length ? 1 : 0;
}
