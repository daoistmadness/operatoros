import { readdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface TypeScriptVersionCheckResult {
  errors: string[];
  checked: Array<{ workspace: string; section: string; dependency: string; version: string }>;
  compatibilityExceptionFound: boolean;
}

export const PERMITTED_COMPATIBILITY_PACKAGE = "@typescript/typescript6";

export function parseMinimumMajor(spec: string): number | null {
  const trimmed = spec.trim();
  if (trimmed === "catalog:") {
    return null; // deferred to catalog resolution
  }

  // Any strict upper bound like "<7" or "<8" allows versions below 7
  if (/^<(?!=)/.test(trimmed)) {
    return 0;
  }
  // Upper bound "<=6" allows versions below 7
  if (/^<=\s*[0-6](\.|$)/.test(trimmed)) {
    return 0;
  }

  // Check for common semver patterns: "7.0.2", "^7.0.0", "~7.0.2", ">=7.0.0"
  // Match the first numeric major segment
  const match = trimmed.match(/(?:>=|\^|~|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (match && match[1] !== undefined) {
    return Number(match[1]);
  }

  return null;
}

export function checkTypeScriptVersions(repoRoot: string): TypeScriptVersionCheckResult {
  const errors: string[] = [];
  const checked: Array<{ workspace: string; section: string; dependency: string; version: string }> = [];
  let compatibilityExceptionFound = false;

  const rootManifestPath = join(repoRoot, "package.json");
  if (!existsSync(rootManifestPath)) {
    return {
      errors: [`Root package.json not found at ${rootManifestPath}`],
      checked,
      compatibilityExceptionFound: false,
    };
  }

  const rootManifest: PackageJson = JSON.parse(readFileSync(rootManifestPath, "utf8"));
  const workspaceConfig = rootManifest.workspaces;
  const catalog = workspaceConfig && !Array.isArray(workspaceConfig) ? workspaceConfig.catalog : undefined;

  // Workspace manifest paths to inspect
  const manifestPaths: Array<{ label: string; path: string }> = [{ label: "root", path: rootManifestPath }];

  // Find workspace packages
  const packagesList = Array.isArray(workspaceConfig)
    ? workspaceConfig
    : workspaceConfig?.packages ?? ["apps/api", "apps/web", "packages/*"];

  for (const pattern of packagesList) {
    if (pattern.endsWith("/*")) {
      const baseDir = join(repoRoot, pattern.slice(0, -2));
      if (existsSync(baseDir)) {
        for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const pkgPath = join(baseDir, entry.name, "package.json");
            if (existsSync(pkgPath)) {
              manifestPaths.push({
                label: relative(repoRoot, join(baseDir, entry.name)),
                path: pkgPath,
              });
            }
          }
        }
      }
    } else {
      const pkgPath = join(repoRoot, pattern, "package.json");
      if (existsSync(pkgPath)) {
        manifestPaths.push({
          label: pattern,
          path: pkgPath,
        });
      }
    }
  }

  // Sections that represent direct declarations in the workspace manifests
  const directSections = ["dependencies", "devDependencies", "optionalDependencies"] as const;

  for (const { label, path } of manifestPaths) {
    let manifest: PackageJson;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`Failed to parse manifest at ${path}: ${String(error)}`);
      continue;
    }

    for (const section of directSections) {
      const deps = manifest[section];
      if (!deps) continue;

      for (const [depName, declared] of Object.entries(deps)) {
        if (!declared) continue;

        // 1. Check canonical "typescript" package
        if (depName === "typescript") {
          checked.push({ workspace: label, section, dependency: depName, version: declared });

          let resolvedSpec = declared;
          if (declared === "catalog:") {
            const catalogVersion = catalog?.["typescript"];
            if (!catalogVersion) {
              errors.push(
                `Workspace ${label} declares typescript via catalog:, but no catalog entry exists in root package.json`
              );
              continue;
            }
            resolvedSpec = catalogVersion;
          }

          const minMajor = parseMinimumMajor(resolvedSpec);
          if (minMajor === null || minMajor < 7) {
            errors.push(
              `Direct TypeScript dependency in ${label} (${section}) must be >=7.0.0; found "${declared}" (resolved: "${resolvedSpec}")`
            );
          }
          continue;
        }

        // 2. Check permitted compatibility package (@typescript/typescript6)
        if (depName === PERMITTED_COMPATIBILITY_PACKAGE) {
          if (label === "root" && section === "devDependencies") {
            compatibilityExceptionFound = true;
            checked.push({ workspace: label, section, dependency: depName, version: declared });
          } else {
            errors.push(
              `${PERMITTED_COMPATIBILITY_PACKAGE} is scoped exclusively to root devDependencies for architecture validation; found in ${label} (${section})`
            );
          }
          continue;
        }

        // 3. Reject any unauthorized npm:typescript alias
        if (declared.startsWith("npm:typescript@")) {
          errors.push(
            `Unauthorized TypeScript alias in ${label} (${section}): "${depName}": "${declared}". Direct npm:typescript aliases are forbidden.`
          );
          continue;
        }

        // 4. Reject unauthorized typescript-related compatibility packages or aliases
        const isTypeScriptAlias =
          depName === "typescript" ||
          depName.startsWith("typescript-") ||
          (depName.startsWith("@typescript/") && !depName.startsWith("@typescript-eslint/"));

        if (isTypeScriptAlias && depName !== "typescript" && depName !== PERMITTED_COMPATIBILITY_PACKAGE) {
          errors.push(
            `Unauthorized TypeScript package or alias in ${label} (${section}): "${depName}": "${declared}". Only canonical "typescript" and root-scoped "${PERMITTED_COMPATIBILITY_PACKAGE}" are permitted.`
          );
        }
      }
    }
  }

  // Ensure root declares canonical typescript >= 7.0.0
  const rootHasTs = checked.some(
    (c) => c.workspace === "root" && c.section === "devDependencies" && c.dependency === "typescript"
  );
  if (!rootHasTs) {
    errors.push("Root package.json must declare direct typescript in devDependencies");
  }

  return { errors, checked, compatibilityExceptionFound };
}

if (import.meta.main) {
  const repoRoot = dirname(import.meta.dir);
  const result = checkTypeScriptVersions(repoRoot);

  if (result.errors.length > 0) {
    console.error("TYPESCRIPT_VERSION_CHECK_ERROR: Direct TypeScript versions below 7 and unauthorized aliases are forbidden:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("TypeScript version guard: PASS");
  for (const entry of result.checked) {
    console.log(`  - ${entry.workspace} (${entry.section}): ${entry.dependency}@${entry.version}`);
  }
}
