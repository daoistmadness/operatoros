import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { architectureFixtures } from "./architecture-fixtures";
import { checkArchitecture } from "../check-architecture";

const temporaryRoots: string[] = [];

const pathForPackage = (name: string) => name === "@operatoros/api" ? "apps/api" : name === "@operatoros/web" ? "apps/web" : `packages/${name.slice("@operatoros/".length)}`;
const manifestFor = (name: string, dependencies: Record<string, string> = {}) => ({
  name,
  private: true,
  type: "module",
  dependencies,
  exports: {
    ".": "./src/index.ts",
    "./components/*": "./src/components/*.tsx",
  },
});

async function fixtureRoot(fixture: typeof architectureFixtures[number]) {
  const root = await mkdtemp(join(tmpdir(), "operatoros-architecture-"));
  temporaryRoots.push(root);
  const sourcePath = pathForPackage(fixture.sourcePackage);
  const targets = [...fixture.source.matchAll(/@operatoros\/[a-z-]+/g)].map(([name]) => name);
  const packageNames = new Set([fixture.sourcePackage, ...targets]);
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["apps/*", "packages/*"] } }));
  for (const name of packageNames) {
    const packagePath = join(root, pathForPackage(name));
    await mkdir(join(packagePath, "src"), { recursive: true });
    await writeFile(join(packagePath, "package.json"), JSON.stringify(manifestFor(name, name === fixture.sourcePackage ? fixture.manifestDependencies : undefined)));
    await writeFile(join(packagePath, "src/index.ts"), name === fixture.sourcePackage ? fixture.source : "export const target = 1;");
  }
  if (fixture.name === "cross-workspace relative import rejects") {
    await mkdir(join(root, "apps/web/src"), { recursive: true });
    await mkdir(join(root, "packages/db/src"), { recursive: true });
    await writeFile(join(root, "apps/web/src/index.ts"), fixture.source);
    await writeFile(join(root, "packages/db/package.json"), JSON.stringify(manifestFor("@operatoros/db")));
    await writeFile(join(root, "packages/db/src/schema.ts"), "export const schema = 1;");
  }
  return root;
}

async function attendanceRoot(source: string) {
  const root = await mkdtemp(join(tmpdir(), "operatoros-attendance-architecture-"));
  temporaryRoots.push(root);
  const api = join(root, "apps/api");
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["apps/*"] } }));
  await mkdir(api, { recursive: true });
  await writeFile(join(api, "package.json"), JSON.stringify(manifestFor("@operatoros/api")));
  const domains = join(api, "src/domains");
  await mkdir(domains, { recursive: true });
  await writeFile(join(domains, "attendance-report.ts"), source);
  return root;
}

afterEach(async () => {
  while (temporaryRoots.length) await rm(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("semantic architecture boundary checker", () => {
  for (const fixture of architectureFixtures) {
    test(fixture.name, async () => {
      const root = await fixtureRoot(fixture);
      const report = checkArchitecture(root);
      if (fixture.expected === "fail") expect(report.violations.length).toBeGreaterThan(0);
      else expect(report.violations).toEqual([]);
    });
  }

  test("current repository graph passes", () => {
    const report = checkArchitecture(join(import.meta.dir, "../.."));
    expect(report.violations).toEqual([]);
  }, 15000);

  test("mixed Attendance report source imports require the basis resolver", async () => {
    const root = await attendanceRoot(`
      import { aggregateManualAbsenceForPeriod } from "./manual-absence";
      import { attendancePeriodTotals } from "./term-attendance";
      export const report = { basis: "OBSERVED" };
    `);
    expect(checkArchitecture(root).violations.map((value) => value.kind)).toContain("ATTENDANCE_BASIS_BYPASS_VIOLATION");
  });

  test("mixed Attendance report passes when it calls the basis resolver", async () => {
    const root = await attendanceRoot(`
      import { aggregateManualAbsenceForPeriod } from "./manual-absence";
      import { attendancePeriodTotals } from "./term-attendance";
      import { resolveAttendanceBasis } from "./attendance-basis";
      export const report = resolveAttendanceBasis({});
    `);
    expect(checkArchitecture(root).violations).toEqual([]);
  });
});
