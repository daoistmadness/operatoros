import baseConfig from "../../apps/web/playwright.config";
import { defineConfig } from "../../apps/web/node_modules/@playwright/test";
import path from "node:path";

export default defineConfig({
  ...baseConfig,
  testDir: __dirname,
  outputDir: path.resolve(__dirname, "../../e2e-results/readiness"),
  reporter: [["line"], ["junit", { outputFile: path.resolve(__dirname, "../../e2e-results/junit/readiness.xml") }]],
});
