import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);

type PackageJson = {
  name?: string;
  workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version?: string;
};

const errors: string[] = [];

async function readJson(path: string): Promise<PackageJson | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.json() as PackageJson : null;
}

function versionParts(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function satisfies(version: string, range: string) {
  const selected = versionParts(version);
  if (!selected) return false;
  return range.split("||").some((alternative) => {
    const constraints = [...alternative.matchAll(/(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/g)];
    if (constraints.length === 0) return false;
    return constraints.every(([, operator = "=", major, minor = "0", patch = "0"]) => {
      const lower: [number, number, number] = [Number(major), minor.match(/[xX*]/) ? 0 : Number(minor), patch.match(/[xX*]/) ? 0 : Number(patch)];
      const result = compare(selected, lower);
      if (operator === ">=") return result >= 0;
      if (operator === ">") return result > 0;
      if (operator === "<=") return result <= 0;
      if (operator === "<") return result < 0;
      if (operator === "^") {
        const upper: [number, number, number] = lower[0] > 0 ? [lower[0] + 1, 0, 0] : lower[1] > 0 ? [0, lower[1] + 1, 0] : [0, 0, lower[2] + 1];
        return result >= 0 && compare(selected, upper) < 0;
      }
      if (operator === "~") return result >= 0 && selected[0] === lower[0] && selected[1] === lower[1];
      if (minor.match(/[xX*]/) || patch.match(/[xX*]/)) return selected[0] === lower[0] && (minor.match(/[xX*]/) || selected[1] === lower[1]);
      return result === 0;
    });
  });
}

function allDependencies(manifest: PackageJson) {
  return Object.assign({}, manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies, manifest.peerDependencies);
}

const rootManifest = await readJson(join(root, "package.json"));
if (!rootManifest) errors.push("root package.json is missing");

const workspaceConfig = rootManifest?.workspaces;
const catalog = workspaceConfig && !Array.isArray(workspaceConfig) ? workspaceConfig.catalog : undefined;
const catalogVersion = catalog?.["@sinclair/typebox"];
if (!catalogVersion || !versionParts(catalogVersion)) errors.push("root workspaces.catalog must contain one exact TypeBox version");
if (catalogVersion && /[~^*xX]|\s/.test(catalogVersion)) errors.push(`TypeBox catalog is not exact: ${catalogVersion}`);

const workspacePaths = ["apps/api", "apps/web"];
const packageRoot = join(root, "packages");
try {
  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && await Bun.file(join(packageRoot, entry.name, "package.json")).exists()) workspacePaths.push(join("packages", entry.name));
  }
} catch {
  // Future package directories are optional in Phase 14.1.
}

const contractsPath = join(root, "packages/contracts");
const contractsManifest = await readJson(join(contractsPath, "package.json"));
if (!contractsManifest) {
  errors.push("packages/contracts/package.json is missing");
} else {
  const contractsDependencies = allDependencies(contractsManifest);
  if (contractsDependencies["@sinclair/typebox"] !== "catalog:") {
    errors.push("packages/contracts must use the root TypeBox catalog");
  }
  for (const dependency of ["elysia", "drizzle-orm", "react", "@operatoros/db", "@operatoros/api", "@operatoros/web", "zod"]) {
    if (contractsDependencies[dependency]) errors.push(`packages/contracts declares forbidden dependency: ${dependency}`);
  }
}

for (const relativePath of workspacePaths) {
  const manifest = await readJson(join(root, relativePath, "package.json"));
  if (!manifest) continue;
  const declared = allDependencies(manifest)["@sinclair/typebox"];
  if (declared && declared !== "catalog:") errors.push(`${relativePath} declares TypeBox outside the root catalog: ${declared}`);
}

async function firstJson(paths: string[]) {
  for (const path of paths) {
    const manifest = await readJson(path);
    if (manifest) return manifest;
  }
  return null;
}

const elysia = await firstJson([
  join(root, "node_modules/elysia/package.json"),
  join(root, "apps/api/node_modules/elysia/package.json"),
]);
const resolvedTypeBox = await firstJson([
  join(root, "node_modules/@sinclair/typebox/package.json"),
  join(root, "apps/api/node_modules/@sinclair/typebox/package.json"),
]);
const resolvedVersion = resolvedTypeBox?.version;
const requirement = elysia?.peerDependencies?.["@sinclair/typebox"] ?? elysia?.dependencies?.["@sinclair/typebox"];
if (!elysia?.version || !requirement) errors.push("installed Elysia TypeBox requirement is unavailable");
if (!resolvedVersion) errors.push("installed TypeBox resolution is unavailable");
if (requirement && resolvedVersion && !satisfies(resolvedVersion, requirement)) errors.push(`TypeBox ${resolvedVersion} does not satisfy Elysia ${requirement}`);
if (catalogVersion && resolvedVersion && catalogVersion !== resolvedVersion) errors.push(`catalog TypeBox ${catalogVersion} differs from resolved TypeBox ${resolvedVersion}`);

if (errors.length > 0) {
  console.error(errors.map((error) => `TYPEBOX_CHECK_ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`TypeBox catalog: ${catalogVersion}`);
console.log(`Elysia: ${elysia?.version}`);
console.log(`Elysia TypeBox requirement: ${requirement}`);
console.log(`Resolved TypeBox: ${resolvedVersion}`);
console.log("TypeBox resolution: PASS");
