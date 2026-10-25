import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { appendRow, createWorkbook, writeLegacyXlsRows, writeXlsxWorkbook } from "@operatoros/excel";

const root = `/dev/shm/operatoros-import-preview-benchmark-${process.pid}-${randomUUID()}`;
const directory = dirname(Bun.fileURLToPath(import.meta.url));
const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];
const sizes = [100, 5000] as const;
const formats = ["xlsx", "xls"] as const;
const modes = ["parse-direct", "parse-route", "stage", "full-direct", "full-route"] as const;
const repeats = Number(process.env.IMPORT_PREVIEW_BENCH_REPEATS ?? "3");

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function generateFiles(): Promise<Map<string, string>> {
  mkdirSync(root, { recursive: true });
  const files = new Map<string, string>();
  for (const size of sizes) {
    const rows = Array.from({ length: size }, (_, index) => [
      9001 + (index % 4 === 3 ? 100 : index % 4),
      ["Andi", "Beta", "Citra", "Diana"][index % 4],
      46205 + index,
      "07:30", "16:00", "", "", "", "27",
    ]);
    const workbook = createWorkbook({ generatedAt: new Date("2026-10-01T00:00:00Z") });
    const sheet = workbook.addWorksheet("Attendance");
    appendRow(sheet, headers);
    for (const row of rows) appendRow(sheet, row);
    const xlsxPath = `${root}/synthetic-attendance-${size}.xlsx`;
    const xlsPath = `${root}/synthetic-attendance-${size}.xls`;
    await Bun.write(xlsxPath, await writeXlsxWorkbook(workbook));
    await Bun.write(xlsPath, writeLegacyXlsRows(rows, headers, "Attendance"));
    files.set(`${size}:xlsx`, xlsxPath);
    files.set(`${size}:xls`, xlsPath);
  }
  return files;
}

async function runCase(size: number, format: "xlsx" | "xls", mode: typeof modes[number], repeat: number, filePath: string): Promise<unknown> {
  const dbPath = `${root}/case-${size}-${format}-${mode}-${repeat}.sqlite`;
  const env = { ...process.env, MODE: mode, FORMAT: format, REPEAT: String(repeat), DB_PATH: dbPath, FILE_PATH: filePath, FILE_NAME: filePath.split("/").at(-1)!, EXPECTED_ROWS: String(size) } as Record<string, string>;
  const server = Bun.spawn([process.execPath, `${directory}/attendance-import-preview-server.ts`], { env, stdout: "pipe", stderr: "pipe" });
  const reader = server.stdout.getReader();
  let output = "";
  let port = 0;
  try {
    while (!port) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`server exited before ready: ${await collect(server.stderr)}`);
      output += new TextDecoder().decode(value);
      const match = output.match(/READY (\d+)/);
      if (match) port = Number(match[1]);
    }
    const serverErrors = collect(server.stderr);
    const client = Bun.spawn([process.execPath, `${directory}/attendance-import-preview-client.ts`], {
      env: { ...env, API_BASE: `http://127.0.0.1:${port}` }, stdout: "pipe", stderr: "pipe",
    });
    const [result, clientErrors, clientExit] = await Promise.all([collect(client.stdout), collect(client.stderr), client.exited]);
    server.kill("SIGTERM");
    const [serverErrorText, serverExit] = await Promise.all([serverErrors, server.exited]);
    if (clientExit !== 0) throw new Error(`client failed ${size}/${format}/${mode}/${repeat}: ${clientErrors}\n${result}\n${serverErrorText}`);
    if (serverExit !== 0) throw new Error(`server failed ${size}/${format}/${mode}/${repeat}: ${serverErrorText}`);
    return JSON.parse(result.trim());
  } catch (error) {
    server.kill("SIGTERM");
    await server.exited;
    throw error;
  }
}

if (!Number.isInteger(repeats) || repeats < 1) throw new Error("IMPORT_PREVIEW_BENCH_REPEATS must be a positive integer");
const files = await generateFiles();
try {
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const sizeOrder = repeat % 2 ? sizes : [...sizes].reverse();
    const formatOrder = repeat % 2 ? formats : [...formats].reverse();
    const modeOrder = repeat % 2 ? modes : [...modes].reverse();
    for (const size of sizeOrder) for (const format of formatOrder) for (const mode of modeOrder) {
      const filePath = files.get(`${size}:${format}`)!;
      console.log(JSON.stringify(await runCase(size, format, mode, repeat, filePath)));
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
