import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT_MARKDOWN = new Set([
  "AGENTS.md", "CHANGELOG.md", "COMMANDS.md", "CONTRIBUTING.md", "CONVENTIONS.md",
  "ERRORS.md", "MEMORY.md", "PROJECT_CONTEXT.md", "README.md",
]);
const DOC_SECTIONS = new Set(["architecture", "decisions", "guides", "reference", "runbooks", "session"]);
const PROTECTED_DOC = "docs/student-data/dapodik-roster-import-design.md";
const SESSION_LOG = /^docs\/session\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function markdownOrganizationProblems(root: string): string[] {
  const markdownFiles = [...new Bun.Glob("**/*.md").scanSync({
    cwd: root,
    onlyFiles: true,
    dot: true,
    followSymlinks: false,
  })].map((path) => path.split(sep).join("/")).filter((path) =>
    !path.split("/").some((part) => [".git", ".turbo", ".vite", "build", "coverage", "dist", "node_modules"].includes(part)),
  ).sort();
  const problems: string[] = [];
  const docsFiles = markdownFiles.filter((path) => path.startsWith("docs/"));

  for (const file of markdownFiles) {
    if (file.startsWith("docs/")) continue;
    if (ROOT_MARKDOWN.has(file) || /^(?:\.github|apps|backend|e2e|packages|release|_artifacts)\//.test(file)) continue;
    problems.push(`${file} is outside the approved Markdown locations`);
  }

  for (const file of docsFiles) {
    if (file === "docs/README.md" || file === PROTECTED_DOC) continue;
    const parts = file.split("/");
    const section = parts[1];
    if (!section || !DOC_SECTIONS.has(section)) {
      problems.push(`${file} must live in an approved docs section`);
      continue;
    }
    const inStudentData = section === "reference" && parts.length === 4 && parts[2] === "student-data";
    if (parts.length !== 3 && !inStudentData) {
      const allowed = section === "reference" ? `docs/${section} or docs/reference/student-data` : `docs/${section}`;
      problems.push(`${file} must be directly under ${allowed}`);
    }
    const name = file.slice(file.lastIndexOf("/") + 1);
    const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name);
    if (!kebabCase && !(name === "README.md" && section === "session")) {
      problems.push(`${file} must use a kebab-case Markdown filename`);
    }
    if (section === "session" && name !== "README.md" && !SESSION_LOG.test(file)) {
      problems.push(`${file} must use a YYYY-MM-DD-kebab-case session log filename`);
    }
    const content = readFileSync(join(root, file), "utf8");
    if (!/^---\r?\nstatus: (?:current|draft|deprecated)\r?\nlast_reviewed: \d{4}-\d{2}-\d{2}\r?\n---\r?\n/.test(content)) {
      problems.push(`${file} needs status and last_reviewed front matter`);
    }
  }

  const indexPath = join(root, "docs/README.md");
  const indexed = new Map<string, number>();
  for (const match of readFileSync(indexPath, "utf8").matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
    const target = match[1]!.split(/[?#]/, 1)[0]!;
    const resolved = relative(root, resolve(dirname(indexPath), target)).split(sep).join("/");
    if (!resolved.startsWith("docs/")) continue;
    indexed.set(resolved, (indexed.get(resolved) ?? 0) + 1);
  }

  for (const file of docsFiles.filter((path) => path !== "docs/README.md" && !SESSION_LOG.test(path))) {
    const count = indexed.get(file) ?? 0;
    if (count !== 1) problems.push(`${file} must appear exactly once in docs/README.md (found ${count})`);
  }
  for (const [file, count] of indexed) {
    if (!docsFiles.includes(file)) problems.push(`docs/README.md links to unmaintained page ${file}`);
    if (count > 1) problems.push(`docs/README.md links to ${file} more than once`);
  }

  return problems.sort();
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const problems = markdownOrganizationProblems(root);
  console.log(problems.length ? problems.join("\n") : "Markdown organization looks valid.");
  process.exitCode = problems.length ? 1 : 0;
}
