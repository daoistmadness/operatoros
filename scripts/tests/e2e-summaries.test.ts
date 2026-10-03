import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { junitCounts } from "../../e2e/helpers/junit-counts";
import { writeSummary } from "../../e2e/helpers/write-summary";
import { writeFullSummary } from "../../e2e/helpers/write-full-summary";
const roots: string[] = [], repository = resolve(import.meta.dir, "../..");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const root = () => { const value = mkdtempSync(join(tmpdir(), "operatoros-summary-fixture-")); roots.push(value); return value; };

const junitFixtures: [string, ReturnType<typeof junitCounts>][] = [
  ['<testsuite tests="4" failures="1" errors="1" skipped="1"><testcase name="passed"/><testcase name="A &amp; B &#x1F600;"><failure><![CDATA[<testcase name="fake"><failure/>]]></failure></testcase><testcase><error/></testcase></testsuite>', [1, 2, 1, ["A & B 😀", "unknown"]]],
  ['<testsuites><testsuite tests="3" failures="1"><nested><testcase name="nested"><failure/></testcase></nested><testsuite tests="50"><testcase name="deep"><error/></testcase></testsuite></testsuite><testsuite tests="2" skipped="1"><testcase name="ignore"><nested><failure/></nested></testcase></testsuite></testsuites>', [3, 1, 1, ["nested", "deep"]]],
  ['<testsuite xmlns="urn:junit" tests="2" failures="1"><testcase name="ignored"><failure/></testcase></testsuite>', [0, 0, 0, []]],
  ['<?xml version="1.0"?><testsuites><!-- <testsuite tests="99"/> --><testsuite><testcase name="both"><failure/><error/></testcase></testsuite></testsuites>', [0, 0, 0, ["both"]]],
];
test.each(junitFixtures)("JUnit counts preserve suite selection, XML names, and case failure decisions", (xml, expected) => {
  const path = join(root(), "results.xml"); writeFileSync(path, xml); expect(junitCounts(path)).toEqual(expected);
});
test("missing and malformed result files cannot silently become empty passing counts", () => {
  const path = join(root(), "missing.xml"); expect(junitCounts(path)).toEqual([0, 1, 0, ["Missing result file: missing.xml"]]);
  for (const xml of ['<testsuite>', '<testsuite tests="bad"/>', '<testsuite><testcase></testsuite>', '<!DOCTYPE testsuite [<!ENTITY custom "fixture">]><testsuite/>']) { writeFileSync(path, xml); expect(() => junitCounts(path)).toThrow(); }
});
test("smoke summary retains exact lines, trailing newline, explicit names, and evidence", () => {
  const directory = root(), output = join(directory, "nested/summary.txt"), junit = join(directory, "backend.xml");
  writeFileSync(junit, '<testsuite tests="3" failures="1" skipped="1"><testcase name="failure &amp; detail"><failure/></testcase></testsuite>');
  writeSummary(["--output", output, "--status", "BLOCKED", "--backend-junit", junit, "--failed-test", "explicit", "--evidence", "logs", "--evidence", "traces"]);
  expect(readFileSync(output, "utf8")).toBe("OperatorOS E2E Smoke\nStatus: BLOCKED\nBackend: 1 passed, 1 failed\nWeb: 0 passed, 0 failed\nDuration: 0m 0s\nFailed tests:\n- explicit\n- failure & detail\nEvidence:\n- logs\n- traces\n");
});
test("full summary preserves prerequisite failures, result ordering, printed/file output and exit", () => {
  const directory = root(), output = join(directory, "summary.txt"), good = join(directory, "good.xml"), missing = join(directory, "missing.xml");
  writeFileSync(good, '<testsuite tests="2" skipped="1"/>');
  const result = writeFullSummary(["--output", output, "--backend-junit", good, "--frontend-junit", missing, "--smoke-status", "FAIL", "--build-status", "FAIL", "--duration", "1m 2s"]);
  expect(result.status).toBe(1); expect(result.text).toBe(readFileSync(output, "utf8"));
  expect(result.text).toBe("OperatorOS E2E Full (CI Only)\nStatus: FAIL\nSmoke: FAIL\nBackend regression: 1 passed, 0 failed, 1 skipped\nFrontend regression: 0 passed, 1 failed, 0 skipped\nFrontend build: FAIL\nDuration: 1m 2s\nFailed tests:\n- Missing result file: missing.xml\n- E2E smoke prerequisite\n- Frontend production build\nEvidence:\n- e2e-results/logs\n- e2e-results/junit\n- e2e-results/playwright\n");
});
test("CLI argument failures preserve exit 2 and never publish a summary", () => {
  const output = join(root(), "summary.txt");
  for (const helper of ["write-summary", "write-full-summary"]) {
    const result = Bun.spawnSync([process.execPath, join(repository, `e2e/helpers/${helper}.ts`), "--output", output, "--unknown"], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(2); expect(result.stdout.toString()).toBe(""); expect(existsSync(output)).toBe(false);
  }
});
