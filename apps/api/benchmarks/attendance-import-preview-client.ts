const base = process.env.API_BASE!;
const mode = process.env.MODE!;
const format = process.env.FORMAT!;
const repeat = Number(process.env.REPEAT);
const filePath = process.env.FILE_PATH!;
const filename = process.env.FILE_NAME!;
const expectedRows = Number(process.env.EXPECTED_ROWS);
const uploadBytes = Number(await Bun.file(filePath).size);
const origin = "http://localhost:5173";
const secret = "operatoros-import-preview-benchmark-secret-32";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
}
function latencySummary(values: number[]) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), maxMs: Math.max(0, ...values) };
}

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
});
if (login.status !== 200) throw new Error(`synthetic login failed with ${login.status}`);
const cookie = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[0];
if (!cookie) throw new Error("synthetic session cookie missing");

const samples: Array<{ phase: string; latencyMs: number; status: number }> = [];
let phase = "baseline";
let inFlight = 0;
let maxInFlight = 0;
async function ping() {
  if (inFlight >= 8) return;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const sentPhase = phase;
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${base}/api/auth/me`, { headers: { cookie, origin } });
    status = response.status;
    await response.arrayBuffer();
  } catch { status = 0; }
  samples.push({ phase: sentPhase, latencyMs: performance.now() - started, status });
  inFlight -= 1;
}

const pingTimer = setInterval(() => { void ping(); }, 10);
void ping();
await sleep(1000);
const baselinePings = samples.filter((sample) => sample.phase === "baseline");
const start = await fetch(`${base}/__bench/start`, { method: "POST" });
if (!start.ok) throw new Error("benchmark measurement could not start");
phase = "workload";
const workloadStarted = performance.now();
let response: Response;
if (mode === "stage") {
  response = await fetch(`${base}/__bench/stage`, { method: "POST" });
} else {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const form = new FormData();
  const type = filename.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  form.append("file", new File([bytes], filename, { type }));
  const route = mode === "parse-direct" || mode === "parse-route"
    ? "/__bench/parse"
    : mode === "full-direct" ? "/__bench/full-direct" : "/api/uploads/preview";
  const authenticated = mode === "full-direct" || mode === "full-route";
  response = await fetch(`${base}${route}`, { method: "POST", headers: authenticated ? { cookie, origin } : {}, body: form });
}
const workloadMs = performance.now() - workloadStarted;
const payload = await response.json() as Record<string, unknown>;
phase = "settle";
await sleep(250);
const metrics = await (await fetch(`${base}/__bench/finish`, { method: "POST" })).json();
clearInterval(pingTimer);
while (inFlight > 0) await sleep(1);

const workloadPings = samples.filter((sample) => sample.phase === "workload");
const failures = samples.filter((sample) => sample.status !== 200).length;
if (failures) throw new Error(`${failures} authenticated API pings failed`);
let rows: number;
let invalidRows: number;
let classifications: number | null = null;
if (mode === "parse-direct" || mode === "parse-route") {
  rows = Number(payload.logicalRows);
  invalidRows = Number(payload.invalidRows);
  if (Number(payload.totalRows) !== expectedRows) throw new Error(`parser rows ${payload.totalRows}, expected ${expectedRows}`);
} else if (mode === "stage") {
  rows = Number(payload.outputRows);
  const summary = payload.summary as Record<string, number>;
  invalidRows = summary.invalid_rows;
  classifications = summary.new_rows + summary.update_rows + summary.unchanged_rows + summary.conflicts + summary.invalid_rows;
} else {
  rows = Array.isArray(payload.rows) ? payload.rows.length : 0;
  const summary = payload.summary as Record<string, number>;
  invalidRows = summary.invalid_rows;
  classifications = summary.new_rows + summary.update_rows + summary.unchanged_rows + summary.conflicts + summary.invalid_rows;
}
if (response.status !== 200 || rows !== expectedRows || invalidRows !== 0 || (classifications !== null && classifications !== expectedRows)) {
  throw new Error(`correctness failed ${mode}/${expectedRows}: ${JSON.stringify({ status: response.status, rows, invalidRows, classifications })}`);
}
console.log(JSON.stringify({
  repeat, rows: expectedRows, format, mode, status: response.status, workloadMs,
  parserMs: typeof payload.parserMs === "number" ? payload.parserMs : null,
  stageMs: typeof payload.stageMs === "number" ? payload.stageMs : null,
  uploadBytes,
  baselinePings: latencySummary(baselinePings.map((sample) => sample.latencyMs)),
  workloadPings: latencySummary(workloadPings.map((sample) => sample.latencyMs)),
  nonSuccessPingCount: failures, maxInFlight, serverMetrics: metrics,
}));
