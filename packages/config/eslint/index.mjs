const internalPackages = [
  "@operatoros/api",
  "@operatoros/config",
  "@operatoros/contracts",
  "@operatoros/db",
  "@operatoros/ui",
  "@operatoros/web",
];

const deepImportPattern = {
  group: ["@operatoros/*/src", "@operatoros/*/src/**"],
  message: "Use the target workspace package exports, not its src tree.",
};

const appSourcePattern = {
  group: ["apps/**", "**/apps/**"],
  message: "Cross-workspace source imports must use package exports.",
};

const forbiddenByWorkspace = {
  "@operatoros/api": ["@operatoros/ui", "@operatoros/web"],
  "@operatoros/web": [
    "@operatoros/api",
    "@operatoros/db",
    "bun:sqlite",
    "drizzle-orm",
    "better-sqlite3",
    "sqlite3",
    "@libsql/client",
  ],
  "@operatoros/contracts": [
    "@operatoros/api",
    "@operatoros/db",
    "@operatoros/ui",
    "@operatoros/web",
    "drizzle-orm",
    "elysia",
    "react",
  ],
  "@operatoros/db": [
    "@operatoros/api",
    "@operatoros/contracts",
    "@operatoros/ui",
    "@operatoros/web",
    "elysia",
    "react",
  ],
  "@operatoros/ui": [
    "@operatoros/api",
    "@operatoros/contracts",
    "@operatoros/db",
    "@operatoros/web",
    "drizzle-orm",
    "elysia",
  ],
  "@operatoros/config": internalPackages,
};

export function boundaryRulesFor(packageName) {
  const paths = (forbiddenByWorkspace[packageName] ?? []).map((name) => ({
    name,
    message: `${packageName} must not depend on ${name}.`,
  }));

  return {
    "no-restricted-imports": ["error", {
      paths,
      patterns: [deepImportPattern, appSourcePattern],
    }],
  };
}

const sourceGlob = "**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}";
const workspacePaths = {
  "@operatoros/api": "apps/api",
  "@operatoros/web": "apps/web",
  "@operatoros/contracts": "packages/contracts",
  "@operatoros/db": "packages/db",
  "@operatoros/ui": "packages/ui",
  "@operatoros/config": "packages/config",
};

export const workspaceBoundaryConfigs = Object.keys(forbiddenByWorkspace).map((packageName) => ({
  files: [`${workspacePaths[packageName]}/${sourceGlob}`],
  packageName,
}));
