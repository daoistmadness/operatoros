import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ChangelogCheck = {
  changedFiles: string[];
  content: string;
  prNumber: number;
  skipLabel: boolean;
};

export function changelogProblems({ changedFiles, content, prNumber, skipLabel }: ChangelogCheck): string[] {
  if (skipLabel) return [];
  const problems: string[] = [];
  if (!changedFiles.includes("CHANGELOG.md")) problems.push("The pull request must change CHANGELOG.md");

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "## [Unreleased]");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const unreleased = start < 0 ? [] : lines.slice(start + 1, end < 0 ? lines.length : end);
  if (!unreleased.some((line) => new RegExp(`^\\s*- .+\\(#${prNumber}\\)\\s*$`).test(line))) {
    problems.push(`Add an Unreleased changelog entry ending in (#${prNumber})`);
  }
  return problems;
}

if (import.meta.main) {
  if (Bun.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("Changelog check applies to pull requests only.");
    process.exit(0);
  }
  const root = resolve(import.meta.dir, "../..");
  const event = JSON.parse(readFileSync(Bun.env.GITHUB_EVENT_PATH!, "utf8")) as {
    number: number;
    pull_request: { labels?: { name: string }[]; base: { sha: string } };
  };
  const base = Bun.env.CHANGELOG_BASE_SHA || event.pull_request.base.sha;
  const diff = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (diff.exitCode !== 0) {
    console.error(diff.stderr.toString() || "Could not inspect pull request changes");
    process.exit(1);
  }
  const problems = changelogProblems({
    changedFiles: diff.stdout.toString().split(/\r?\n/),
    content: readFileSync(resolve(root, "CHANGELOG.md"), "utf8"),
    prNumber: event.number,
    skipLabel: event.pull_request.labels?.some((label) => label.name === "skip-changelog") ?? false,
  });
  console.log(problems.length ? problems.join("\n") : "Pull request changelog entry is valid.");
  process.exitCode = problems.length ? 1 : 0;
}
