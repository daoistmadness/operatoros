import { defineConfig } from "oxlint";
import { boundaryRulesFor, workspaceBoundaryConfigs } from "./packages/config/lint/boundaries.mjs";

export default defineConfig({
  plugins: ["eslint"],
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/build/**",
    "**/dist/**",
    "**/coverage/**",
    ".runtime/**",
    "e2e-results/**",
    "scripts/tests/architecture-fixtures/**",
    "**/routeTree.gen.ts",
    "packages/sheetjs-fork/**",
  ],
  overrides: workspaceBoundaryConfigs.map(({ files, packageName }) => ({
    files,
    rules: boundaryRulesFor(packageName),
  })),
});
