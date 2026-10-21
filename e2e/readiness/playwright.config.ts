import baseConfig from "../../apps/web/playwright.config";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { defineConfig }: typeof import("../../apps/web/node_modules/@playwright/test") = createRequire(import.meta.url)("../../apps/web/node_modules/@playwright/test");
const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  ...baseConfig,
  testDir: directory,
  outputDir: path.resolve(directory, "../../e2e-results/readiness"),
  reporter: [["line"], ["junit", { outputFile: path.resolve(directory, "../../e2e-results/junit/readiness.xml") }]],
});
