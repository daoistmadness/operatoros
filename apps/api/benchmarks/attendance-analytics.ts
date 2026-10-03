import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAttendanceBenchmarkFixture } from "../tests/fixtures/attendance-benchmark";

const secret = "operatoros-benchmark-cookie-secret-32-chars";
const dates = Array.from({ length: 20 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);

function seed(path: string, students: number): void {
  createAttendanceBenchmarkFixture(path, students);
}

async function benchmark(students: number) {
  const path = `/tmp/operatoros-attendance-analytics-benchmark-${students}-${process.pid}.db`;
  seed(path, students);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-analytics-benchmark-audit-${process.pid}` } });
  const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "benchmark-admin", password: "benchmark-admin-pass-1" }) }));
  const session = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!session) throw new Error("benchmark login failed");
  const headers = { cookie: `astyx_session=${session}` };
  const query = "academic_year_id=1&date_from=2026-08-01&date_to=2026-08-20";
  const timings: Record<string, number> = {};
  for (const [name, pathSuffix] of [["overview", "overview"], ["classes", "classes"], ["daily", "daily"], ["students", "students?page_size=50"], ["export", "export-excel"]]) {
    const started = performance.now();
    const response = await app.handle(new Request(`http://local/api/analytics/attendance/${pathSuffix}${pathSuffix.includes("?") ? "&" : "?"}${query}`, { headers }));
    if (response.status !== 200) throw new Error(`${name} returned ${response.status}`);
    await response.arrayBuffer();
    timings[name] = Number((performance.now() - started).toFixed(2));
  }
  database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
  return { students, records: students * dates.length, timings };
}

for (const students of [100, 500, 1000]) console.log(JSON.stringify(await benchmark(students)));
