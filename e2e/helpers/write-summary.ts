#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { junitCounts } from "./junit-counts";

export function writeSummary(args: string[]): void {
  const { values } = parseArgs({ args, options: {
    title: { type: "string", default: "OperatorOS E2E Smoke" }, output: { type: "string" }, status: { type: "string" },
    backend: { type: "string", default: "0 passed, 0 failed" }, web: { type: "string", default: "0 passed, 0 failed" }, duration: { type: "string", default: "0m 0s" },
    "failed-test": { type: "string", multiple: true }, evidence: { type: "string", multiple: true }, "backend-junit": { type: "string" }, "web-junit": { type: "string" },
  } });
  if (!values.output || !values.status || !["PASS", "FAIL", "BLOCKED"].includes(values.status)) throw new TypeError("--output and --status PASS|FAIL|BLOCKED are required");
  const names = [...(values["failed-test"] ?? [])];
  let backend = values.backend, web = values.web;
  for (const [key, path] of [["backend", values["backend-junit"]], ["web", values["web-junit"]]] as const) if (path) {
    const [passed, failed, , failedNames] = junitCounts(path); names.push(...failedNames);
    if (key === "backend") backend = `${passed} passed, ${failed} failed`; else web = `${passed} passed, ${failed} failed`;
  }
  const lines = [values.title, `Status: ${values.status}`, `Backend: ${backend}`, `Web: ${web}`, `Duration: ${values.duration}`, "Failed tests:", ...(names.length ? names : ["None"]).map(item => `- ${item}`), "Evidence:", ...(values.evidence?.length ? values.evidence : ["None"]).map(item => `- ${item}`)];
  mkdirSync(dirname(values.output), { recursive: true }); writeFileSync(values.output, `${lines.join("\n")}\n`);
}
if (import.meta.main) {
  try { writeSummary(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = error instanceof TypeError ? 2 : 1; }
}
