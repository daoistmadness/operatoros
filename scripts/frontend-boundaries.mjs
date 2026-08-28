import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = resolve(scriptDirectory, "../apps/web/src");
const sourceExtensions = new Set([".ts", ".tsx"]);

function normalize(path) {
  return path.split(sep).join("/");
}

function featureName(path) {
  const match = normalize(path).match(/(?:^|\/)features\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    { regex: /\bimport\s+type\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g, typeOnly: true },
    { regex: /\bimport\s+(?!type\b)(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g, typeOnly: false },
    { regex: /\bexport\s+type\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g, typeOnly: true },
    { regex: /\bexport\s+(?!type\b)(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g, typeOnly: false },
    { regex: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, typeOnly: false },
  ];
  for (const { regex, typeOnly } of patterns) {
    for (const match of source.matchAll(regex)) imports.push({ specifier: match[1], typeOnly });
  }
  return imports;
}

function resolveImport(importer, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    ...[...sourceExtensions].map((extension) => `${base}${extension}`),
    ...[...sourceExtensions].map((extension) => resolve(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? base;
}

function isFeaturePublicEntry(target, targetFeature) {
  const normalized = normalize(target);
  return new RegExp(`/features/${targetFeature}/(?:index\\.(?:ts|tsx))?$`).test(normalized) ||
    normalized.endsWith(`/features/${targetFeature}`);
}

function addViolation(violations, rule, importer, target) {
  violations.push({ rule, importer: normalize(importer), target: normalize(target) });
}

export function checkBoundarySources(sources, sourceRoot = "/virtual/src") {
  const absoluteSources = new Map(
    Object.entries(sources).map(([path, source]) => [resolve(sourceRoot, path), source]),
  );
  const knownFiles = new Set(absoluteSources.keys());
  const violations = [];
  const featureGraph = new Map();

  for (const [importer, source] of absoluteSources) {
    const importerRelative = normalize(relative(sourceRoot, importer));
    const importerFeature = featureName(importerRelative);
    const importerIsShared = importerRelative.startsWith("shared/");
    const importerIsRoute = importerRelative.startsWith("routes/");
    const importerIsGenerated = importerRelative.startsWith("generated/");

    for (const dependency of importsFrom(source)) {
      const target = resolveImport(importer, dependency.specifier, knownFiles);
      if (!target) continue;
      const targetRelative = normalize(relative(sourceRoot, target));
      const targetFeature = featureName(targetRelative);
      const targetIsGenerated = targetRelative.startsWith("generated/");

      if (importerIsShared && targetFeature) {
        addViolation(violations, "NO_SHARED_TO_FEATURE_IMPORTS", importerRelative, targetRelative);
      }
      if (importerIsRoute && targetFeature && !isFeaturePublicEntry(target, targetFeature)) {
        addViolation(violations, "NO_ROUTE_DEEP_IMPORTS", importerRelative, targetRelative);
      }
      if (importerFeature && targetFeature && importerFeature !== targetFeature) {
        if (!isFeaturePublicEntry(target, targetFeature)) {
          addViolation(violations, "NO_CROSS_FEATURE_DEEP_IMPORTS", importerRelative, targetRelative);
        } else if (!dependency.typeOnly) {
          const edges = featureGraph.get(importerFeature) ?? new Set();
          edges.add(targetFeature);
          featureGraph.set(importerFeature, edges);
        }
      }
      if (targetIsGenerated && !importerIsGenerated) {
        const approvedAdapter = importerFeature &&
          importerRelative.startsWith(`features/${importerFeature}/api/`);
        if (!approvedAdapter) {
          addViolation(violations, "NO_DIRECT_GENERATED_IMPORTS", importerRelative, targetRelative);
        }
      }
      if (importerIsGenerated && !targetIsGenerated) {
        addViolation(violations, "NO_GENERATED_TO_HANDWRITTEN_IMPORTS", importerRelative, targetRelative);
      }
    }
  }

  for (const [from, targets] of featureGraph) {
    for (const to of targets) {
      if (featureGraph.get(to)?.has(from)) {
        addViolation(violations, "NO_NEW_CIRCULAR_FEATURE_DEPENDENCIES", `features/${from}`, `features/${to}`);
      }
    }
  }
  return violations;
}

function collectSources(root) {
  const result = {};
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (sourceExtensions.has(extname(entry.name))) {
        result[normalize(relative(root, path))] = readFileSync(path, "utf8");
      }
    }
  };
  visit(root);
  return result;
}

export function checkFrontendBoundaries(sourceRoot = defaultSourceRoot) {
  return checkBoundarySources(collectSources(sourceRoot), sourceRoot);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(defaultSourceRoot)) {
    process.stderr.write(`Frontend source root not found: ${defaultSourceRoot}\n`);
    process.exit(2);
  }
  const violations = checkFrontendBoundaries();
  if (violations.length) {
    for (const violation of violations) {
      process.stderr.write(`${violation.rule}: ${violation.importer} -> ${violation.target}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("FRONTEND_BOUNDARIES_OK\n");
}
