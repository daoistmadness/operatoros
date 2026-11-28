import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statfsSync } from "node:fs";
import { openDatabase } from "@operatoros/db";
import { createWorkbook, loadXlsxWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { getExcelAdmissionStats, getExcelExportOutputStats } from "../src/import/excel-admission";
import { REQUIRED_COLUMNS, readAttendanceWorkbook } from "../src/import/excel-reader";
import { getExcelUploadAdmissionStats } from "../src/import/excel-upload-admission";
import { createAttendanceViewFixture } from "./fixtures/attendance-views";

const scenario = process.argv[2];
const root = "/sys/fs/cgroup";
const limit = 536870912;
const log = (event: string, data: unknown) => console.log(JSON.stringify({ scenario, event, data }));
const read = (name: string) => readFileSync(`${root}/${name}`, "utf8").trim();
const events = () => Object.fromEntries(read("memory.events").split("\n").map(line => {
  const [key, val] = line.split(" ");
  return [key!, Number(val)];
}));
const metrics = () => ({ current: Number(read("memory.current")), peak: Number(read("memory.peak")), events: events() });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const tasks = () => readdirSync("/proc/self/task");
function children() {
  return [...new Set(tasks().flatMap(task => {
    try {
      return readFileSync(`/proc/self/task/${task}/children`, "utf8").trim().split(/\s+/).filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }))];
}
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    assert(performance.now() < deadline, label);
    await Bun.sleep(2);
  }
}
function cleanAdmission() {
  const jobs = getExcelAdmissionStats();
  const uploads = getExcelUploadAdmissionStats();
  const output = getExcelExportOutputStats();
  log("admission", { jobs, uploads, output, children: children() });
  assert.deepEqual(jobs, { activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  assert.deepEqual(uploads, { activeUploads: 0, inFlightBytes: 0 });
  assert.equal(output.retainedOutputBytes, 0);
  assert.equal(children().length, 0);
}

assert.equal(process.versions.bun, "1.4.5");
assert.equal(read("memory.max"), String(limit));
const [quota, period] = read("cpu.max").split(" ").map(Number);
assert(quota === period && quota! > 0, "CPU quota must equal one CPU");
const ownCgroup = readFileSync("/proc/self/cgroup", "utf8").trim();
assert.equal(ownCgroup, "0::/");
assert.equal(statfsSync("/scratch").type, 0x01021994, "scratch must be tmpfs");
for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "DATABASE_URL", "OPERATOROS_DATA_DIR", "AUTH_COOKIE_SECRET"]) {
  assert.equal(process.env[key], undefined, `unexpected environment variable ${key}`);
}
const probeChild = Bun.spawn([process.execPath, "-e", 'console.log(await Bun.file("/proc/self/cgroup").text())'], { stdout: "pipe" });
assert.equal((await new Response(probeChild.stdout).text()).trim(), ownCgroup);
assert.equal(await probeChild.exited, 0, "cgroup inheritance probe");
const start = metrics();
assert(Number.isFinite(start.peak));
for (const key of ["max", "oom", "oom_kill"]) assert(Number.isSafeInteger(start.events[key]));
log("preflight", { bun: process.versions.bun, memoryMax: limit, cpuMax: read("cpu.max"), ownCgroup, start });

if (scenario === "prepare") {
  const book = createWorkbook({ exportType: "bun-worker-smoke", generatedAt: new Date("2026-11-28T00:00:00Z") });
  const sheet = book.addWorksheet("Attendance");
  sheet.addRow([...REQUIRED_COLUMNS]);
  for (let id = 1; id <= 5000; id++) {
    sheet.addRow([id, `Synthetic Student ${id}`, "12/11/2026", "07:00", "13:00", 0, 0, "", "week-1"]);
  }
  const bytes = await writeXlsxWorkbook(book);
  assert(bytes.byteLength >= 65536);
  assert.equal(sheet.rowCount, 5001);
  assert.equal(sheet.columnCount, 9);
  let populated = 0;
  sheet.eachRow(row => row.eachCell(cell => {
    assert(typeof cell.value === "string" || typeof cell.value === "number");
    if (cell.value !== "") populated++;
  }));
  assert(populated <= 45009);
  await Bun.write("/output/attendance.xlsx", bytes);
  log("fixture", { sha256: hash(bytes), bytes: bytes.byteLength, populated, dataRows: 5000, columns: 9, sheets: 1 });
  process.exit(0);
}

if (scenario === "verify-exports") {
  for (const pair of [1, 2]) {
    const bytes = await Bun.file(`/input/export-${pair}.xlsx`).bytes();
    const workbook = await loadXlsxWorkbook(bytes);
    const recap = workbook.getWorksheet("Rekap Siswa");
    const detail = workbook.getWorksheet("Rincian Harian");
    assert.equal(recap?.rowCount, 3);
    assert.equal(recap.getRow(2).getCell(1).value, "Class Student A");
    assert.equal(recap.getRow(2).getCell(2).value, 2);
    assert.equal(recap.getRow(2).getCell(3).value, 0);
    assert.equal(recap.getRow(2).getCell(9).value, 1);
    assert.equal(recap.getRow(2).getCell(12).value, 20);
    assert(detail);
    log("export_correctness", { pair, bytes: bytes.length, sha256: hash(bytes), assertions: 7 });
  }
  process.exit(0);
}

assert(["A", "B", "C", "D"].includes(scenario ?? ""));
assert.deepEqual(readdirSync("/scratch"), []);
const dbPath = "/scratch/synthetic.db";
mkdirSync("/scratch/audit", { mode: 0o700 });
createAttendanceViewFixture(dbPath, "assigned-export");
const database = openDatabase(dbPath);
const isLegacy = scenario === "B";
const expectedRows = isLegacy ? 1000 : 5000;
database.client.transaction(() => {
  for (let index = 0; index < expectedRows; index++) {
    const id = isLegacy ? 20000000 + index : index + 1;
    const name = `Synthetic Student ${isLegacy ? index : id}`;
    const master = `capacity-${id}`;
    database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,'SMP','Synthetic Import')", [id, name]);
    database.client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [master, name, name.toLowerCase()]);
    database.client.run("INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES (?,?,?,'attendance_device','2026-01-01',1)", [master, id, String(id)]);
  }
})();
assert.equal((database.client.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
log("database", { medium: "fresh tmpfs SQLite", fixture: "assigned-export plus synthetic import identities", identities: expectedRows });
const app = createApp({ databaseHandle: database, auth: {
  authCookieSecret: randomBytes(32).toString("hex"), auditDir: "/scratch/audit",
} });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.handle(request) });
const base = `http://127.0.0.1:${server.port}`;
const snapshot = () => ({
  attendance: database.client.query("SELECT COUNT(*) AS count FROM attendance").get(),
  batches: database.client.query("SELECT COUNT(*) AS count FROM attendance_import_batches").get(),
});
const samples: Array<{ ms: number; status: number; phase: string }> = [];
let httpErrors = 0;
function requireStatus(response: Response, code: number, label: string) {
  if (response.status !== code) httpErrors++;
  assert.equal(response.status, code, label);
}
try {
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
  });
  requireStatus(login, 200, "synthetic login");
  const cookie = login.headers.get("set-cookie")?.match(/astyx_session=[^;]+/)?.[0];
  assert(cookie, "synthetic session missing");
  await login.arrayBuffer();
  const headers = { cookie, origin: "http://localhost:5173" };
  const probe = async (phase: string) => {
    const start = performance.now();
    try {
      const response = await fetch(base + "/api/reports/filters", { headers });
      await response.arrayBuffer();
      samples.push({ phase, status: response.status, ms: performance.now() - start });
      requireStatus(response, 200, "authenticated filters read");
    } catch (e) {
      if (samples.at(-1)?.phase !== phase) {
        httpErrors++;
        samples.push({ phase, status: 0, ms: performance.now() - start });
      }
      throw e;
    }
  };
  const checkHealth = async () => {
    const health = await fetch(base + "/health");
    requireStatus(health, 200, "health");
    assert.equal((await health.json() as {status: string}).status, "ok");
    const ready = await fetch(base + "/ready");
    requireStatus(ready, 200, "readiness");
    assert.equal((await ready.json() as {ready: boolean; persistence: string}).ready, true);
  };
  await checkHealth();
  await probe("baseline");
  const bytes = new Uint8Array(await Bun.file(isLegacy ? "/repo/.github/excel-capacity/attendance.xls" : "/input/attendance.xlsx").arrayBuffer());
  const digest = hash(bytes);
  if (isLegacy) {
    assert.equal(bytes.byteLength, 237568);
    assert.equal(digest, "778ee003d9e091c3657525d5f2e90fdd1f5b0928bccb1cd4b298ff9f28ba82eb");
  } else {
    assert.equal(digest, (await Bun.file("/input/xlsx.sha256").text()).trim());
  }
  log("input", { sha256: digest, bytes: bytes.byteLength, persisted: snapshot() });
  const preview = async (commit = true) => {
    const form = new FormData();
    form.set("file", new File([bytes], isLegacy ? "attendance.xls" : "attendance.xlsx", {
      type: isLegacy ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const response = await fetch(base + "/api/uploads/preview", { method: "POST", headers, body: form });
    requireStatus(response, 200, "staged attendance preview");
    const result = await response.json() as { batch_id: string; checksum: string; status: string; summary: { total_rows: number; invalid_rows: number; conflicts: number }; rows: { id: number }[] };
    assert.equal(result.status, "preview");
    assert.equal(result.checksum, digest);
    assert.equal(result.summary.total_rows, expectedRows);
    assert.equal(result.summary.invalid_rows, 0);
    assert.equal(result.rows.length, result.summary.total_rows);
    log("import", { status: response.status, summary: result.summary });
    assert.equal(result.summary.conflicts, 0);
    if (!commit) return result;
    return commitBatch(result);
  };
  const commitBatch = async (result: { batch_id: string; rows: { id: number }[] }) => {
    const response = await fetch(base + `/api/uploads/preview/${result.batch_id}/commit`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ selected_row_ids: result.rows.map(row => row.id), confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: digest }),
    });
    requireStatus(response, 200, "commit attendance preview");
    const commit = await response.json() as { status: string; rows_inserted: number; rows_updated: number; rows_unchanged: number };
    assert.equal(commit.status, "committed");
    const { rows_inserted, rows_updated, rows_unchanged } = commit;
    assert.equal(rows_inserted + rows_updated + rows_unchanged, expectedRows);
    log("commit", { rows_inserted, rows_updated, rows_unchanged });
    return result;
  };
  const exportClass = async () => {
    const response = await fetch(base + "/api/attendance/classes/1/attendance/export-excel?month=8&year=2026", { headers });
    requireStatus(response, 200, "assigned-class export");
    assert(response.headers.get("content-type")?.includes("spreadsheetml"));
    return new Uint8Array(await response.arrayBuffer());
  };
  const before = snapshot();
  if (scenario === "C") {
    for (let pair = 1; pair <= 2; pair++) {
      log("before_pair", { pair, metrics: metrics() });
      let uploadFinished = false;
      const upload = preview(false).finally(() => { uploadFinished = true; });
      void upload.catch(() => {});
      await until(() => getExcelAdmissionStats().activeJobs === 1 || uploadFinished, "active import");
      assert(!uploadFinished, "import completed before export could overlap");
      const output = exportClass();
      void output.catch(() => {});
      await until(() => getExcelAdmissionStats().queuedJobs === 1 || uploadFinished, "queued export");
      assert.equal(getExcelAdmissionStats().queuedJobs, 1, "export did not queue behind import");
      const overlap = probe(`pair-${pair}-overlap`);
      const [result, , exported] = await Promise.all([upload, overlap, output]);
      await commitBatch(result);
      log("after_pair", { pair, metrics: metrics() });
      // Decode in a separate disposable cgroup so verification allocations do not inflate the API peak.
      await Bun.write(`/output/export-${pair}.xlsx`, exported);
      cleanAdmission();
    }
  } else if (scenario === "D") {
    const abort = new AbortController();
    const parsing = readAttendanceWorkbook(bytes.buffer, "attendance.xlsx", abort.signal);
    void parsing.catch(() => {});
    let child: string | undefined;
    try {
      await until(() => Boolean((child = children()[0])), "parser child did not start");
      assert(child);
      assert.equal(readFileSync(`/proc/${child}/cgroup`, "utf8").trim(), ownCgroup);
      log("cancellation", { child, cgroup: ownCgroup, metrics: metrics() });
    } finally {
      abort.abort();
    }
    await assert.rejects(parsing, /EXCEL_SUBPROCESS_ABORTED/);
    assert.throws(() => readFileSync(`/proc/${child}/stat`), { code: "ENOENT" });
    assert.deepEqual(snapshot(), before);
    cleanAdmission();
    await probe("after-cancel");
    await preview();
  } else {
    await preview();
  }
  await probe("after");
  await checkHealth();
  cleanAdmission();
  const after = snapshot();
  assert.equal((after.attendance as { count: number }).count, (before.attendance as { count: number }).count + expectedRows);
  assert.equal((database.client.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.deepEqual(database.client.query("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(after.batches, { count: scenario === "C" ? 2 : 1 });
  log("persisted", { before, after });
} finally {
  try {
    await server.stop(true);
  } finally {
    database.close();
    const end = metrics();
    const deltas = Object.fromEntries(["max", "oom", "oom_kill"].map(key => [key, end.events[key]! - start.events[key]!]));
    const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
    log("summary", { end, headroom: limit - end.peak, deltas, samples,
      min: sorted[0], median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null,
      max: sorted.at(-1), httpErrors });
    for (const value of Object.values(deltas)) assert.equal(value, 0, "cgroup pressure event");
  }
}
