#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { junitCounts } from "./junit-counts";

export function writeFullSummary(args: string[]): { status: number; text: string } {
  const { values } = parseArgs({ args, options: {
    output: { type: "string" }, "smoke-status": { type: "string" }, "backend-junit": { type: "string" }, "frontend-junit": { type: "string" }, "build-status": { type: "string" }, duration: { type: "string" },
  } });
  if (!values.output || !values["backend-junit"] || !values["frontend-junit"] || values.duration === undefined || !["PASS", "FAIL"].includes(values["smoke-status"] ?? "") || !["PASS", "FAIL"].includes(values["build-status"] ?? "")) throw new TypeError("Required full-summary arguments are missing or invalid");
  const [backendPassed, backendFailed, backendSkipped, backendNames] = junitCounts(values["backend-junit"]), [frontendPassed, frontendFailed, frontendSkipped, frontendNames] = junitCounts(values["frontend-junit"]);
  const names = [...backendNames, ...frontendNames];
  if (values["smoke-status"] === "FAIL") names.push("E2E smoke prerequisite");
  if (values["build-status"] === "FAIL") names.push("Frontend production build");
  // Preserve the legacy status decision: failing case names/prerequisites own it.
  const status = names.length ? "FAIL" : "PASS", evidence = status === "PASS" ? ["None"] : ["e2e-results/logs", "e2e-results/junit", "e2e-results/playwright"];
  const lines = ["OperatorOS E2E Full (CI Only)", `Status: ${status}`, `Smoke: ${values["smoke-status"]}`, `Backend regression: ${backendPassed} passed, ${backendFailed} failed, ${backendSkipped} skipped`, `Frontend regression: ${frontendPassed} passed, ${frontendFailed} failed, ${frontendSkipped} skipped`, `Frontend build: ${values["build-status"]}`, `Duration: ${values.duration}`, "Failed tests:", ...(names.length ? names : ["None"]).map(name => `- ${name}`), "Evidence:", ...evidence.map(item => `- ${item}`)];
  const text = `${lines.join("\n")}\n`; mkdirSync(dirname(values.output), { recursive: true }); writeFileSync(values.output, text);
  return { status: status === "PASS" ? 0 : 1, text };
}
if (import.meta.main) {
  try { const result = writeFullSummary(process.argv.slice(2)); process.stdout.write(result.text); process.exitCode = result.status; }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = error instanceof TypeError ? 2 : 1; }
}
