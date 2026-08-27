import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

const SCAN_DIRECTORIES = [
  ".github",
  "scripts",
  "frontend",
  "backend",
  "e2e",
];

const SCAN_FILES = [
  "Makefile",
  "start-dev.sh",
];

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".runtime",
  ".git",
  "docs",
  "scratch",
]);

const IGNORED_FILE_PATHS = new Set([
  "scripts/check-node-regressions.mjs",
  "scripts/validate-wsl-bun.sh",
  "scripts/test_scope.py",
  "frontend/bun.lock",
]);

const FORBIDDEN_PATTERNS = [
  /\bsetup-node\b/,
  /\bpackage-lock\.json\b/,
  /\b\.nvmrc\b/,
  /\bnpm\s+(ci|install|run|test|exec|publish)\b/,
  /\bnpx\s+/,
];

let violations = 0;

function checkFile(filePath, relativePath) {
  if (IGNORED_FILE_PATHS.has(relativePath) || relativePath.endsWith(".pyc") || relativePath.endsWith(".lock")) {
    return;
  }
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[Node Regression] ${relativePath}:${index + 1}: ${line.trim()}`);
        violations++;
      }
    }
  });
}

function walkDir(dirPath, relativeDir) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    if (IGNORED_DIRECTORY_NAMES.has(entry)) {
      continue;
    }
    const fullPath = join(dirPath, entry);
    const relPath = relativeDir ? `${relativeDir}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, relPath);
    } else if (stat.isFile()) {
      checkFile(fullPath, relPath);
    }
  }
}

for (const dir of SCAN_DIRECTORIES) {
  const fullDir = join(repositoryRoot, dir);
  try {
    walkDir(fullDir, dir);
  } catch (e) {
    // Ignore if directory doesn't exist
  }
}

for (const file of SCAN_FILES) {
  const fullFile = join(repositoryRoot, file);
  try {
    checkFile(fullFile, file);
  } catch (e) {
    // Ignore if file doesn't exist
  }
}

if (violations > 0) {
  console.error(`\nFound ${violations} forbidden Node/npm pattern(s) in repository.`);
  process.exit(1);
} else {
  console.log("No Node/npm regressions found across guarded paths.");
}
