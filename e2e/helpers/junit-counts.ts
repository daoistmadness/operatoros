import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { SaxesParser } from "saxes";

type Case = { name: string; failed: boolean };
type Suite = { total: number; failed: number; skipped: number; cases: Case[] };
export function junitCounts(path: string): [number, number, number, string[]] {
  if (!existsSync(path)) return [0, 1, 0, [`Missing result file: ${basename(path)}`]];
  const suites: Suite[] = [], stack: { name: string; suite?: Suite; case?: Case }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", error => { throw error; });
  parser.on("doctype", () => { throw new Error("JUNIT_UNSUPPORTED_DOCTYPE"); });
  parser.on("opentag", tag => {
    const name = tag.uri ? `{${tag.uri}}${tag.local}` : tag.local, parent = stack.at(-1);
    const attr = (key: string) => tag.attributes[key]?.value;
    const count = (key: string) => {
      const value = (attr(key) ?? "0").trim();
      if (!/^[+-]?\d+$/.test(value)) throw new Error(`JUNIT_COUNT_INVALID: ${key}`);
      return Number(value);
    };
    let suite = parent?.suite;
    if (name === "testsuite" && (stack.length === 0 || (stack.length === 1 && parent?.name !== "testsuite"))) {
      suite = { total: count("tests"), failed: count("failures") + count("errors"), skipped: count("skipped"), cases: [] }; suites.push(suite);
    }
    const entry: typeof stack[number] = { name, suite };
    if (name === "testcase" && suite) { entry.case = { name: attr("name") ?? "unknown", failed: false }; suite.cases.push(entry.case); }
    if ((name === "failure" || name === "error") && parent?.name === "testcase" && parent.case) parent.case.failed = true;
    stack.push(entry);
  });
  parser.on("closetag", () => { stack.pop(); });
  parser.write(readFileSync(path, "utf8")).close();
  const total = suites.reduce((sum, suite) => sum + suite.total, 0), failed = suites.reduce((sum, suite) => sum + suite.failed, 0), skipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
  return [total - failed - skipped, failed, skipped, suites.flatMap(suite => suite.cases.filter(item => item.failed).map(item => item.name))];
}
