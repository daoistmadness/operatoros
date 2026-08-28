import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = dirname(import.meta.dir);
const errors: string[] = [];
const importPattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
const forbiddenUiImports = [
  "@operatoros/api",
  "@operatoros/contracts",
  "@operatoros/db",
  "@operatoros/web",
  "drizzle-orm",
  "elysia",
  "react-dom",
  "zod",
  "bun:sqlite",
];

function imports(source: string): string[] {
  return [...source.matchAll(importPattern)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => Boolean(value));
}

function sourceFiles(directory: string): string[] {
  return Array.from(new Bun.Glob("**/*.{ts,tsx,mjs,js}").scanSync({ cwd: directory, onlyFiles: true }))
    .map((path) => resolve(directory, path));
}

function forbiddenUiImport(specifier: string): boolean {
  return forbiddenUiImports.includes(specifier) || specifier.startsWith("apps/") || specifier.startsWith("@operatoros/ui/src");
}

function inspect(directory: string, predicate = forbiddenUiImport): number {
  let count = 0;
  for (const sourcePath of sourceFiles(directory)) {
    for (const specifier of imports(readFileSync(sourcePath, "utf8"))) {
      if (predicate(specifier)) {
        errors.push(`${relative(root, sourcePath)} imports forbidden module ${specifier}`);
        count += 1;
      }
    }
  }
  return count;
}

for (const specifier of forbiddenUiImports) {
  if (!forbiddenUiImport(specifier)) errors.push(`UI boundary self-check missed ${specifier}`);
}

const uiImports = inspect(resolve(root, "packages/ui/src"));
for (const directory of ["apps/api/src", "apps/web/src", "packages/db/src", "packages/contracts/src"]) {
  for (const sourcePath of sourceFiles(resolve(root, directory))) {
    const source = readFileSync(sourcePath, "utf8");
    if (source.includes("packages/ui/src") || source.includes("@operatoros/ui/src")) {
      errors.push(`${relative(root, sourcePath)} uses a deep UI import`);
    }
  }
}

const importsUiPackage = (specifier: string) => specifier === "@operatoros/ui" || specifier.startsWith("@operatoros/ui/");
const apiImportsUi = inspect(resolve(root, "apps/api/src"), importsUiPackage);
const dbImportsUi = inspect(resolve(root, "packages/db/src"), importsUiPackage);
const contractsImportsUi = inspect(resolve(root, "packages/contracts/src"), importsUiPackage);
if (apiImportsUi || dbImportsUi || contractsImportsUi) {
  errors.push("application, database, or contracts source imports the UI package");
}

if (errors.length > 0) {
  console.error(errors.map((error) => `UI_BOUNDARY_ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log("Synthetic forbidden-import checks: PASS");
console.log(`UI source forbidden imports: ${uiImports}`);
console.log("UI boundaries: PASS");
