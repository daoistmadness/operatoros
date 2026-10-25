import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createApp, t } from "../src/app";
import { defaultAuthConfig, type AuthContext } from "../src/auth/service";
import { actor } from "../src/domains/core";
import { createPreview } from "../src/domains/attendance-import";
import { parseAttendanceWorkbook, readAttendanceWorkbook } from "../src/import/excel-reader";
import { openDatabase } from "@operatoros/db";
import { createAttendanceImportFixture } from "../tests/fixtures/attendance-imports";

const mode = process.env.MODE!;
const dbPath = process.env.DB_PATH!;
const filePath = process.env.FILE_PATH!;
const filename = process.env.FILE_NAME!;
const expectedRows = Number(process.env.EXPECTED_ROWS);
const secret = "operatoros-import-preview-benchmark-secret-32";
const auditDir = `${dbPath}.audit`;
mkdirSync(auditDir, { recursive: true });
createAttendanceImportFixture(dbPath);
const database = openDatabase(dbPath);
const context: AuthContext = { database, config: defaultAuthConfig({ authCookieSecret: secret, auditDir }), now: () => new Date() };
const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
const sourceBytes = new Uint8Array(readFileSync(filePath));
const checksum = createHash("sha256").update(sourceBytes).digest("hex");
function sourceBuffer(): ArrayBuffer { return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer; }

let staged: Awaited<ReturnType<typeof parseAttendanceWorkbook>> | undefined;
if (mode === "stage") {
  staged = await parseAttendanceWorkbook(sourceBuffer(), filename);
  if (staged.totalRows !== expectedRows || staged.rows.length !== expectedRows || staged.invalidRows.length !== 0) throw new Error("stage setup failed workbook correctness");
}

let measuring = false;
let startedAt = 0;
let rssStart = 0;
let rssPeak = 0;
let heapStart = 0;
let heapPeak = 0;
let delays: number[] = [];
let lastBeat = performance.now();
const heartbeat = setInterval(() => {
  const now = performance.now();
  const lag = Math.max(0, now - lastBeat - 10);
  lastBeat = now;
  if (!measuring) return;
  delays.push(lag);
  rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
}, 10);
function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
}

app.post("/__bench/start", () => {
  measuring = true;
  startedAt = performance.now();
  delays = [];
  rssStart = process.memoryUsage.rss();
  rssPeak = rssStart;
  heapStart = process.memoryUsage().heapUsed;
  heapPeak = heapStart;
  return { ready: true };
});
app.post("/__bench/finish", () => {
  measuring = false;
  const rssEnd = process.memoryUsage.rss();
  const heapEnd = process.memoryUsage().heapUsed;
  return {
    elapsedMs: performance.now() - startedAt,
    eventLoopDelayMs: { p50: percentile(delays, 0.5), p95: percentile(delays, 0.95), p99: percentile(delays, 0.99), max: Math.max(0, ...delays) },
    eventLoopSamples: delays.length,
    memoryBytes: { rssStart, rssPeak, rssEnd, rssDelta: rssPeak - rssStart, heapStart, heapPeak, heapEnd, heapDelta: heapPeak - heapStart },
  };
});
app.post("/__bench/parse", async ({ body }) => {
  const bytes = await body.file.arrayBuffer();
  const started = performance.now();
  const parsed = mode === "parse-direct"
    ? await parseAttendanceWorkbook(bytes, body.file.name)
    : await readAttendanceWorkbook(bytes, body.file.name);
  return { parserMs: performance.now() - started, totalRows: parsed.totalRows, logicalRows: parsed.rows.length, invalidRows: parsed.invalidRows.length };
}, { body: t.Object({ file: t.File() }) });
app.post("/__bench/stage", () => {
  if (!staged) throw new Error("stage parser output is missing");
  const started = performance.now();
  const preview = createPreview(context, staged, filename, checksum, "golden-admin");
  return { stageMs: performance.now() - started, summary: preview.summary, outputRows: preview.rows.length };
});
app.post("/__bench/full-direct", async (ctx) => {
  const user = actor(context, ctx, { capability: "import_attendance" });
  if (!user) return { detail: "Insufficient permissions" };
  const file = ctx.body?.file as File | undefined;
  if (!file) { ctx.set.status = 400; return { detail: "file is required" }; }
  const buffer = await file.arrayBuffer();
  const sourceChecksum = createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
  const parserStarted = performance.now();
  const parsed = await parseAttendanceWorkbook(buffer, file.name);
  const parserMs = performance.now() - parserStarted;
  const stageStarted = performance.now();
  const preview = createPreview(context, parsed, file.name, sourceChecksum, user.username);
  return { ...preview, parserMs, stageMs: performance.now() - stageStarted };
}, { body: t.Object({ file: t.File() }) });

app.listen({ hostname: "127.0.0.1", port: 0 });
const port = app.server?.port;
if (!port) throw new Error("benchmark API did not start");
console.log(`READY ${port}`);
process.once("SIGTERM", () => {
  void (async () => {
    clearInterval(heartbeat);
    await app.stop(true);
    database.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(auditDir, { recursive: true, force: true });
    process.exit(0);
  })();
});
