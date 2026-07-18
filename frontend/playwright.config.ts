import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function runtimeBaseUrl(): string {
  const explicitUrl = process.env.OPERATOROS_E2E_FRONTEND_URL;
  if (explicitUrl) return explicitUrl;

  const stateFile = process.env.OPERATOROS_E2E_PORTS_FILE;
  if (stateFile && fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const selectedUrl = state.frontend_url ?? state.frontend?.url;
    if (typeof selectedUrl === "string" && selectedUrl.length > 0) return selectedUrl;
  }

  if (process.env.OPERATOROS_E2E_CONFIG_VALIDATE === "1") return "http://127.0.0.1:1";
  throw new Error("OperatorOS runtime state did not provide the selected frontend URL");
}

const repositoryRoot = path.resolve(__dirname, "..");
const resultsRoot = path.join(repositoryRoot, "e2e-results");

export default defineConfig({
  testDir: path.join(repositoryRoot, "e2e/smoke/web"),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"], ["junit", { outputFile: path.join(resultsRoot, "junit/web.xml") }]],
  outputDir: path.join(resultsRoot, "playwright"),
  use: {
    baseURL: runtimeBaseUrl(),
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
