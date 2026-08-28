import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cts"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "build", "dist", "coverage", ".runtime", "e2e-results"]);
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const SQLITE_DRIVERS = new Set(["bun:sqlite", "better-sqlite3", "sqlite3", "@libsql/client"]);

type PackageJson = {
  name?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
  exports?: string | Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type Workspace = {
  name: string;
  path: string;
  relativePath: string;
  manifest: PackageJson;
};

export type ArchitectureViolation = {
  kind: string;
  sourcePackage: string;
  source: string;
  target: string;
  rule: string;
  detail: string;
};

export type ArchitectureReport = {
  workspaces: Workspace[];
  violations: ArchitectureViolation[];
  importEdges: number;
  manifestEdges: number;
};

const allowedInternal: Record<string, Set<string>> = {
  "@operatoros/api": new Set(["@operatoros/config", "@operatoros/contracts", "@operatoros/db"]),
  "@operatoros/web": new Set(["@operatoros/config", "@operatoros/contracts", "@operatoros/ui"]),
  "@operatoros/contracts": new Set(["@operatoros/config"]),
  "@operatoros/db": new Set(["@operatoros/config"]),
  "@operatoros/ui": new Set(["@operatoros/config"]),
  "@operatoros/config": new Set(),
};

const forbiddenExternal: Record<string, Set<string>> = {
  "@operatoros/api": new Set(),
  "@operatoros/web": new Set(["drizzle-orm", ...SQLITE_DRIVERS]),
  "@operatoros/contracts": new Set(["elysia", "drizzle-orm", "react"]),
  "@operatoros/db": new Set(["elysia", "react"]),
  "@operatoros/ui": new Set(["elysia", "drizzle-orm"]),
  "@operatoros/config": new Set(),
};

function readJson(path: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function workspacePatterns(root: string): string[] {
  const manifest = readJson(resolve(root, "package.json"));
  const workspaces = manifest?.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  return workspaces?.packages ?? [];
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
  if (!pattern.endsWith("/*")) return [pattern];
  const parent = resolve(root, pattern.slice(0, -2));
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => relative(root, resolve(parent, entry.name)));
  } catch {
    return [];
  }
}

export function discoverWorkspaces(root: string): Workspace[] {
  const byName = new Map<string, Workspace>();
  for (const pattern of workspacePatterns(root)) {
    for (const relativePath of expandWorkspacePattern(root, pattern)) {
      const path = resolve(root, relativePath);
      const manifest = readJson(resolve(path, "package.json"));
      if (!manifest?.name) continue;
      const workspace = { name: manifest.name, path, relativePath, manifest };
      if (!byName.has(workspace.name)) byName.set(workspace.name, workspace);
    }
  }
  return [...byName.values()];
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  if (!exists(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...sourceFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files;
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function packageForPath(path: string, workspaces: Workspace[]): Workspace | undefined {
  return workspaces
    .filter((workspace) => path === workspace.path || path.startsWith(`${workspace.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function packageForSpecifier(specifier: string, workspaces: Workspace[]): { workspace?: Workspace; packageName?: string; subpath: string } | null {
  const workspace = workspaces
    .filter(({ name }) => specifier === name || specifier.startsWith(`${name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!workspace) return null;
  return {
    workspace,
    packageName: workspace.name,
    subpath: specifier === workspace.name ? "" : specifier.slice(workspace.name.length + 1),
  };
}

function knownInternalSpecifier(specifier: string): string | undefined {
  const names = Object.keys(allowedInternal).sort((left, right) => right.length - left.length);
  return names.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function exportKeyMatches(exportsField: PackageJson["exports"], subpath: string): boolean {
  if (!exportsField) return true;
  if (typeof exportsField === "string") return subpath === "";
  const requested = subpath ? `./${subpath}` : ".";
  return Object.keys(exportsField).some((key) => {
    if (key === requested) return true;
    const wildcard = key.indexOf("*");
    if (wildcard < 0) return false;
    const prefix = key.slice(0, wildcard);
    const suffix = key.slice(wildcard + 1);
    return requested.startsWith(prefix) && requested.endsWith(suffix) && requested.length >= prefix.length + suffix.length;
  });
}

function resolveRelativeImport(source: string, specifier: string): string {
  const base = resolve(dirname(source), specifier);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cts"].map((extension) => `${base}${extension}`),
    ...["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.mts", "index.cts"].map((name) => resolve(base, name)),
  ];
  return candidates.find(exists) ?? base;
}

function lineFor(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function addViolation(
  violations: ArchitectureViolation[],
  workspace: Workspace,
  source: string,
  target: string,
  kind: string,
  rule: string,
  detail: string,
) {
  violations.push({
    kind,
    sourcePackage: workspace.name,
    source,
    target,
    rule,
    detail,
  });
}

function inspectSpecifier(
  root: string,
  workspace: Workspace,
  source: string,
  specifier: string,
  workspaces: Workspace[],
  violations: ArchitectureViolation[],
) {
  const internal = packageForSpecifier(specifier, workspaces);
  const knownName = internal?.packageName ?? knownInternalSpecifier(specifier);
  if (knownName) {
    const subpath = internal?.subpath ?? (specifier === knownName ? "" : specifier.slice(knownName.length + 1));
    if (subpath === "src" || subpath.startsWith("src/")) {
      addViolation(violations, workspace, source, specifier, "ARCHITECTURE_DEEP_IMPORT_VIOLATION", "workspace package exports are required", "source-tree import");
      return;
    }
    if (knownName !== workspace.name && !allowedInternal[workspace.name]?.has(knownName)) {
      addViolation(violations, workspace, source, specifier, "ARCHITECTURE_BOUNDARY_VIOLATION", "workspace dependency is forbidden", `allowed internal targets: ${[...(allowedInternal[workspace.name] ?? [])].join(", ") || "none"}`);
      return;
    }
    if (internal?.workspace?.manifest.exports && !exportKeyMatches(internal.workspace.manifest.exports, subpath)) {
      addViolation(violations, workspace, source, specifier, "ARCHITECTURE_DEEP_IMPORT_VIOLATION", "target package export is not public", "unexported package subpath");
    }
    return;
  }

  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const targetPath = resolveRelativeImport(source, specifier);
    const targetWorkspace = packageForPath(targetPath, workspaces);
    if (targetWorkspace && targetWorkspace.name !== workspace.name) {
      addViolation(violations, workspace, source, specifier, "ARCHITECTURE_RELATIVE_IMPORT_VIOLATION", "cross-workspace imports must use package exports", `resolved target: ${relative(root, targetPath)}`);
    }
    return;
  }

  if (specifier.startsWith("apps/") || specifier.includes("/apps/") || forbiddenExternal[workspace.name]?.has(specifier)) {
    addViolation(violations, workspace, source, specifier, "ARCHITECTURE_BOUNDARY_VIOLATION", "forbidden application or external dependency", "workspace ownership rule");
  }
}

function moduleSpecifiers(sourceFile: ts.SourceFile): Array<{ specifier: string; position: number; kind: string }> {
  const result: Array<{ specifier: string; position: number; kind: string }> = [];
  const add = (node: ts.Node, kind: string) => {
    if (ts.isStringLiteralLike(node)) result.push({ specifier: node.text, position: node.getStart(sourceFile), kind });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier, "import");
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier, "re-export");
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) add(node.moduleReference.expression, "import-equals");
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) add(node.argument.literal, "type import");
    else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], "dynamic import");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") add(node.arguments[0], "require");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function inspectManifest(workspace: Workspace, workspaces: Workspace[], violations: ArchitectureViolation[]): number {
  let count = 0;
  for (const section of DEPENDENCY_SECTIONS) {
    for (const dependency of Object.keys(workspace.manifest[section] ?? {})) {
      count += 1;
      const internal = packageForSpecifier(dependency, workspaces);
      const knownName = internal?.packageName ?? knownInternalSpecifier(dependency);
      if (knownName && knownName !== workspace.name && !allowedInternal[workspace.name]?.has(knownName)) {
        addViolation(violations, workspace, resolve(workspace.path, "package.json"), dependency, "ARCHITECTURE_MANIFEST_VIOLATION", "declared workspace dependency is forbidden", `dependency section: ${section}`);
        continue;
      }
      if (!knownName && (dependency.startsWith("apps/") || dependency.includes("/apps/") || forbiddenExternal[workspace.name]?.has(dependency))) {
        addViolation(violations, workspace, resolve(workspace.path, "package.json"), dependency, "ARCHITECTURE_MANIFEST_VIOLATION", "declared application or external dependency is forbidden", `dependency section: ${section}`);
      }
    }
  }
  return count;
}

export function checkArchitecture(root: string): ArchitectureReport {
  const workspaces = discoverWorkspaces(root).filter((workspace) => !workspace.name.startsWith("__duplicate__"));
  const violations: ArchitectureViolation[] = [];
  const duplicateNames = new Set<string>();
  for (const pattern of workspacePatterns(root)) {
    for (const relativePath of expandWorkspacePattern(root, pattern)) {
      const manifest = readJson(resolve(root, relativePath, "package.json"));
      if (!manifest?.name) continue;
      if (duplicateNames.has(manifest.name)) {
        addViolation(violations, { name: manifest.name, path: resolve(root, relativePath), relativePath, manifest }, resolve(root, relativePath, "package.json"), manifest.name, "ARCHITECTURE_MANIFEST_VIOLATION", "workspace package names must be unique", "duplicate package identity");
      }
      duplicateNames.add(manifest.name);
    }
  }

  let importEdges = 0;
  let manifestEdges = 0;
  for (const workspace of workspaces) {
    manifestEdges += inspectManifest(workspace, workspaces, violations);
    for (const source of sourceFiles(workspace.path)) {
      const extension = extname(source);
      const scriptKind = extension === ".tsx" || extension === ".jsx" ? ts.ScriptKind.TSX : extension === ".js" || extension === ".mjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(source, readFileSync(source, "utf8"), ts.ScriptTarget.Latest, true, scriptKind);
      for (const { specifier, position, kind } of moduleSpecifiers(sourceFile)) {
        importEdges += 1;
        const before = violations.length;
        inspectSpecifier(root, workspace, source, specifier, workspaces, violations);
        for (const violation of violations.slice(before)) {
          violation.detail = `${kind} at line ${lineFor(sourceFile, position)}; ${violation.detail}`;
        }
      }
    }
  }
  return { workspaces, violations, importEdges, manifestEdges };
}

function printReport(root: string, report: ArchitectureReport) {
  if (report.violations.length > 0) {
    for (const violation of report.violations) {
      console.error("ARCHITECTURE_BOUNDARY_VIOLATION");
      console.error(`  Source package: ${violation.sourcePackage}`);
      console.error(`  Source: ${relative(root, violation.source)}`);
      console.error(`  Forbidden dependency: ${violation.target}`);
      console.error(`  Rule: ${violation.rule}`);
      console.error(`  Detail: ${violation.detail}`);
    }
    console.error(`Architecture check: FAIL (${report.violations.length} violation(s))`);
    return;
  }
  console.log(`Architecture workspaces: ${report.workspaces.map(({ name, relativePath }) => `${name}=${relativePath}`).join(", ")}`);
  console.log(`Source edges checked: ${report.importEdges}`);
  console.log(`Manifest dependencies checked: ${report.manifestEdges}`);
  console.log("Architecture exceptions: 0");
  console.log("Architecture check: PASS");
}

if (import.meta.main) {
  const root = resolve(dirname(import.meta.path), "..");
  const report = checkArchitecture(root);
  printReport(root, report);
  if (report.violations.length > 0) process.exitCode = 1;
}
