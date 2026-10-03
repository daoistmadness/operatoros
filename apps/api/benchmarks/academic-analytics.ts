import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createApp } from "../src/app";
import { createAcademicBenchmarkFixture } from "../tests/fixtures/academic-benchmark";
import { openDatabase } from "@operatoros/db";

const secret = "astryx-academic-benchmark-cookie-secret-32";

function seed(path: string, studentCount: number): void {
  createAcademicBenchmarkFixture(path, studentCount);
}

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

async function run(studentCount: number): Promise<void> {
  const path = `/tmp/operatoros-academic-benchmark-${studentCount}-${process.pid}.db`;
  seed(path, studentCount);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-academic-benchmark-audit-${process.pid}` } });
  try {
    const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
    const token = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
    if (!token) throw new Error("benchmark login failed");
    const headers = { cookie: `astyx_session=${token}` };
    const query = "?academic_year_id=2";
    const measure = async (pathName: string, consume: (response: Response) => Promise<unknown>, suffix = "") => {
      const samples: number[] = [];
      await consume(await app.handle(new Request(`http://local${pathName}${query}${suffix}`, { headers })));
      for (let index = 0; index < 3; index++) { const start = performance.now(); await consume(await app.handle(new Request(`http://local${pathName}${query}${suffix}`, { headers }))); samples.push(performance.now() - start); }
      return median(samples);
    };
    const overviewMs = await measure("/api/analytics/academic/overview", async (response) => response.json());
    const studentsMs = await measure("/api/analytics/academic/students", async (response) => response.json(), "&page_size=200");
    const exportMs = await measure("/api/analytics/academic/export-excel", async (response) => response.arrayBuffer());
    console.log(JSON.stringify({ students: studentCount, scoreRows: studentCount * 20, overviewMs: Number(overviewMs.toFixed(1)), studentsMs: Number(studentsMs.toFixed(1)), exportMs: Number(exportMs.toFixed(1)), queryFamilies: { overview: 8, students: 3, export: 12 } }));
  } finally { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); }
}

for (const count of [100, 500, 1000]) await run(count);
