import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = dirname(import.meta.dir);
const errors: string[] = [];
const importPattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

function imports(source: string): string[] {
  return [...source.matchAll(importPattern)].map((match) => match[1] ?? match[2]).filter((value): value is string => Boolean(value));
}

function sourceFiles(directory: string): string[] {
  return Array.from(new Bun.Glob("**/*.{ts,tsx,mjs,js}").scanSync({ cwd: directory, onlyFiles: true }))
    .map((path) => resolve(directory, path));
}

function forbiddenContractImport(specifier: string, sourcePath: string): boolean {
  if (["elysia", "drizzle-orm", "react", "@operatoros/db", "@operatoros/api", "@operatoros/web", "zod", "bun:sqlite"].includes(specifier)) return true;
  if (specifier.startsWith("apps/") || specifier.startsWith("@operatoros/")) return specifier !== "@sinclair/typebox";
  if (specifier.startsWith(".")) return resolve(dirname(sourcePath), specifier).startsWith(resolve(root, "apps"));
  return false;
}

function inspect(directory: string, check: (specifier: string, sourcePath: string) => boolean): number {
  let count = 0;
  for (const sourcePath of sourceFiles(directory)) {
    const source = readFileSync(sourcePath, "utf8");
    for (const specifier of imports(source)) {
      if (check(specifier, sourcePath)) {
        errors.push(`${relative(root, sourcePath)} imports forbidden module ${specifier}`);
        count += 1;
      }
    }
  }
  return count;
}

function syntheticViolation(specifier: string): boolean {
  return forbiddenContractImport(specifier, resolve(root, "packages/contracts/src/example.ts"));
}

for (const specifier of ["elysia", "drizzle-orm", "react", "@operatoros/db", "apps/api/internal", "../../../apps/api/src/app"]) {
  if (!syntheticViolation(specifier)) errors.push(`boundary self-check missed ${specifier}`);
}

const contractsImports = inspect(resolve(root, "packages/contracts/src"), forbiddenContractImport);
const webImports = inspect(resolve(root, "apps/web/src"), (specifier) => ["@operatoros/db", "drizzle-orm", "bun:sqlite"].includes(specifier));

for (const directory of ["apps/api/src", "apps/web/src", "packages/db/src", "packages/contracts/src"]) {
  for (const sourcePath of sourceFiles(resolve(root, directory))) {
    const source = readFileSync(sourcePath, "utf8");
    if (source.includes("@operatoros/contracts/src") || source.includes("packages/contracts/src")) {
      errors.push(`${relative(root, sourcePath)} uses a deep contracts import`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `CONTRACT_BOUNDARY_ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Synthetic forbidden-import checks: PASS`);
console.log(`Contracts source forbidden imports: ${contractsImports}`);
console.log(`Web persistence imports: ${webImports}`);
console.log("Contract boundaries: PASS");
