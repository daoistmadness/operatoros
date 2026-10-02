#!/usr/bin/env bun
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

const PRESERVED = new Set(["PROJECT_CONTEXT.md", "f22", "docs/student-data/dapodik-roster-import-design.md"]);
export const FOCUSED_TESTS: Record<string, string[]> = {
  FRONTEND_COMPONENT: ["src/components/common/common-patterns.test.tsx"],
  FRONTEND_FEATURE: ["src/features/readiness/components/SetupOverview.test.tsx", "src/features/operator-work-queue/queries/useOperatorQueries.test.ts", "src/features/jenjang-config/pages/JenjangConfig.test.tsx"],
  FRONTEND_ROUTE: ["src/routes/routeDefinitions.test.tsx", "src/routes/RouteErrorBoundary.test.tsx"],
  FRONTEND_API_CLIENT: ["src/lib/api", "src/lib/query"],
  FRONTEND_GENERATED_CONTRACT: ["src/generated/openapi/openapiFoundation.test.ts"],
  BACKEND_UNIT: ["apps/api/tests/core.test.ts"], BACKEND_API: ["apps/api/tests/app.test.ts"],
  BACKEND_AUTH: ["apps/api/tests/auth.test.ts"], BACKEND_UPLOAD: ["apps/api/tests/attendance-import.test.ts"],
  BACKEND_ATTENDANCE: ["apps/api/tests/attendance.test.ts"],
  BACKEND_MODEL: ["apps/api/tests/data-layer.test.ts"], BACKEND_MIGRATION: ["apps/api/tests/data-layer.test.ts"],
  BACKEND_BOOTSTRAP: ["apps/api/tests/data-layer.test.ts"], UI_PACKAGE: ["src/components/ui-package-consumer.test.tsx"],
};
const BROWSER_SCENARIOS: Record<string, string[]> = {
  FRONTEND_ROUTE: ["error-recovery"], FRONTEND_FEATURE: ["readiness"], BACKEND_AUTH: ["auth"],
  BACKEND_UPLOAD: ["uploads"], BACKEND_ATTENDANCE: ["attendance", "corrections"], E2E_INFRASTRUCTURE: ["release"],
};
const WEB_ROOTS = ["apps/web/", "frontend/"];
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

export function classifyPath(path: string): string[] {
  const value = path.replaceAll("\\", "/").replace(/^[./]+/, "");
  const web = (suffix: string) => WEB_ROOTS.some((root) => value.startsWith(root + suffix));
  if (PRESERVED.has(value)) return [];
  if (value === "Makefile" || value.startsWith("scripts/test") || value.startsWith("e2e/") || ["apps/web/playwright.config.ts", "frontend/playwright.config.ts"].includes(value)) return ["E2E_INFRASTRUCTURE"];
  if (value.startsWith("docs/") || /\.(md|txt)$/.test(value)) return ["DOCUMENTATION_ONLY"];
  if (web("src/generated/")) return ["FRONTEND_GENERATED_CONTRACT"];
  if (value.startsWith("apps/api/src/")) {
    if (value.includes("attendance-import")) return ["BACKEND_UPLOAD"];
    if (value.includes("attendance")) return ["BACKEND_ATTENDANCE"];
    if (value.includes("/auth/")) return ["BACKEND_AUTH"];
    return [value.endsWith("openapi-contract.ts") ? "BACKEND_API" : "BACKEND_UNIT"];
  }
  if (value.startsWith("apps/api/tests/")) return ["BACKEND_UNIT"];
  if (value.startsWith("packages/db/")) return ["DATABASE_PACKAGE"];
  if (value.startsWith("packages/contracts/")) return ["CONTRACTS_PACKAGE"];
  if (value.startsWith("packages/ui/")) return ["UI_PACKAGE"];
  if (web("src/routes/")) return ["FRONTEND_ROUTE"];
  if (web("src/features/")) return ["FRONTEND_FEATURE"];
  if (web("src/components/") || web("src/pages/")) return ["FRONTEND_COMPONENT"];
  if (web("src/lib/api/") || web("src/api/")) return ["FRONTEND_API_CLIENT"];
  if (web("") && ["package.json", "package-lock.json", "bun.lock", "vite.config.ts", "vitest.config.ts", "tsconfig.json"].includes(basename(value))) return ["FRONTEND_BUILD_CONFIG", "FRONTEND_TEST_INFRASTRUCTURE"];
  if (value.startsWith("backend/src/models/")) return ["BACKEND_MODEL"];
  if (value.startsWith("backend/migrations/") || value.startsWith("backend/src/migrations/") || value.includes("migration") && value.startsWith("backend/src/core/")) return ["BACKEND_MIGRATION"];
  if (["backend/src/main.py", "backend/src/core/database.py", "backend/src/core/schema_guard.py", "backend/src/core/schema_parity.py"].includes(value)) return ["BACKEND_BOOTSTRAP"];
  if (value.startsWith("backend/tests/fixtures/") || value.startsWith("e2e/fixtures/")) return ["DATABASE_FIXTURE"];
  if (value.startsWith("backend/src/api/auth") || value.startsWith("backend/src/security/")) return ["BACKEND_AUTH"];
  if (value.startsWith("backend/src/")) {
    if (value.includes("upload")) return ["BACKEND_UPLOAD"];
    if (value.includes("attendance")) return ["BACKEND_ATTENDANCE"];
    return [value.startsWith("backend/src/api/") ? "BACKEND_API" : "BACKEND_UNIT"];
  }
  if (value.startsWith("backend/tests/") || web("src/")) return [web("") ? "FRONTEND_TEST_INFRASTRUCTURE" : "BACKEND_UNIT"];
  return ["UNKNOWN_HIGH_RISK"];
}

export function buildScope(paths: string[]) {
  const categories = sorted(paths.flatMap(classifyPath));
  const has = (...names: string[]) => names.some((name) => categories.includes(name));
  const ui = has("UI_PACKAGE");
  const frontend = categories.some((category) => category.startsWith("FRONTEND_")) || ui;
  const backend = categories.some((category) => category.startsWith("BACKEND_")) || has("DATABASE_PACKAGE", "CONTRACTS_PACKAGE");
  const schemaSensitive = has("BACKEND_MODEL", "BACKEND_MIGRATION", "BACKEND_BOOTSTRAP", "DATABASE_PACKAGE", "CONTRACTS_PACKAGE", "DATABASE_FIXTURE", "E2E_INFRASTRUCTURE", "UNKNOWN_HIGH_RISK");
  return {
    changed_paths: [...paths].sort(), risk_categories: categories,
    focused_tests: sorted(categories.flatMap((category) => FOCUSED_TESTS[category] ?? [])),
    browser_scenarios: sorted(categories.flatMap((category) => BROWSER_SCENARIOS[category] ?? [])),
    frontend_changed: frontend, ui_changed: ui, backend_changed: backend, schema_sensitive: schemaSensitive,
    full_backend_required: backend || schemaSensitive,
    backend_full_passes_required: schemaSensitive ? 2 : backend ? 1 : 0,
    api_drift_required: has("BACKEND_API", "BACKEND_AUTH", "FRONTEND_API_CLIENT", "FRONTEND_GENERATED_CONTRACT", "UNKNOWN_HIGH_RISK"),
    frontend_build_required: has("FRONTEND_ROUTE", "FRONTEND_GENERATED_CONTRACT", "FRONTEND_BUILD_CONFIG", "FRONTEND_TEST_INFRASTRUCTURE", "E2E_INFRASTRUCTURE", "UNKNOWN_HIGH_RISK"),
    documentation_only: categories.length === 1 && categories[0] === "DOCUMENTATION_ONLY",
    selection_reasons: [...paths].sort().map((path) => ({ path, categories: classifyPath(path).sort(), reason: classifyPath(path).length ? "matched path-to-test map" : "preserved unrelated entry" })),
  };
}

export function pathsFromNameStatus(output: string): string[] {
  return sorted(output.split("\n").flatMap((line) => {
    const [status = "", ...paths] = line.split("\t");
    return paths.slice(0, /^[RC]/.test(status) ? 2 : 1);
  }));
}

export function gitPaths(repo: string, base?: string, head?: string): string[] {
  const env = { ...process.env };
  const local = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (local.exitCode !== 0) throw new Error(local.stderr.toString().trim());
  for (const name of local.stdout.toString().trim().split("\n")) delete env[name];
  const commands = base ? [["diff", "--name-status", "--find-renames", `${base}...${head || "HEAD"}`]] : [
    ["diff", "--name-status", "--find-renames"], ["diff", "--cached", "--name-status", "--find-renames"], ["ls-files", "--others", "--exclude-standard"],
  ];
  return sorted(commands.flatMap((args) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
    return args.includes("--name-status") ? pathsFromNameStatus(result.stdout.toString()) : result.stdout.toString().split("\n");
  }).filter((path) => path && !PRESERVED.has(path)));
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: {
      base: { type: "string" }, head: { type: "string" }, repo: { type: "string", default: resolve(import.meta.dir, "..") },
      "changed-file": { type: "string", multiple: true },
    } });
    const paths = values["changed-file"]?.length ? sorted(values["changed-file"]) : gitPaths(values.repo!, values.base, values.head);
    console.log(JSON.stringify(buildScope(paths.filter((path) => !PRESERVED.has(path)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
