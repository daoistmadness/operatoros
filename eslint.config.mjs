import tsParser from "@typescript-eslint/parser";
import { boundaryRulesFor, workspaceBoundaryConfigs } from "./packages/config/eslint/index.mjs";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/coverage/**",
      ".runtime/**",
      "e2e-results/**",
      "scripts/tests/architecture-fixtures/**",
    ],
  },
  ...workspaceBoundaryConfigs.map(({ files, packageName }) => ({
    files,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: boundaryRulesFor(packageName),
  })),
];
