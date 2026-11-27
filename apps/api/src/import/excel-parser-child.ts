import { EXCEL_RESOURCE_LIMITS, parseMachineAttendanceWorkbook, readXlsxWorkbook } from "@operatoros/excel";
import { parseAttendanceWorkbook } from "./excel-reader";

const MAX_CHILD_INPUT_BYTES = EXCEL_RESOURCE_LIMITS.maxFileBytes + 4096;
const MAX_CHILD_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_CHILD_RSS_BYTES = 280 * 1024 * 1024;

type ChildRequestHeader = {
  op: "attendance" | "machine" | "xlsx";
  filename: string;
};

async function readBoundedStdin(maxBytes: number): Promise<Uint8Array> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error("EXCEL_SUBPROCESS_INPUT_LIMIT_EXCEEDED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function writeResponse(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    const errJson = JSON.stringify({
      ok: false,
      errorName: "Error",
      errorMessage: "EXCEL_SUBPROCESS_OUTPUT_LIMIT_EXCEEDED",
    });
    process.stdout.write(errJson);
    return;
  }
  process.stdout.write(json);
}

const rssWatchdog = setInterval(() => {
  if (process.memoryUsage().rss > MAX_CHILD_RSS_BYTES) {
    process.exit(137);
  }
}, 50);
rssWatchdog.unref();

try {
  const raw = await readBoundedStdin(MAX_CHILD_INPUT_BYTES);
  const newlineIdx = raw.indexOf(0x0a);
  if (newlineIdx <= 0) {
    throw new Error("EXCEL_SUBPROCESS_INVALID_HEADER");
  }
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(0, newlineIdx))) as ChildRequestHeader;
  const body = raw.subarray(newlineIdx + 1);

  if (header.op === "attendance") {
    const parsed = await parseAttendanceWorkbook(body, header.filename);
    writeResponse({
      ok: true,
      result: {
        rows: parsed.rows,
        invalidRows: parsed.invalidRows,
        exactDuplicates: [...parsed.exactDuplicates],
        divergentDuplicates: [...parsed.divergentDuplicates],
        totalRows: parsed.totalRows,
      },
    });
  } else if (header.op === "machine") {
    const parsed = await parseMachineAttendanceWorkbook(body);
    writeResponse({ ok: true, result: parsed });
  } else if (header.op === "xlsx") {
    const parsed = await readXlsxWorkbook(body);
    writeResponse({ ok: true, result: parsed });
  } else {
    throw new Error("EXCEL_SUBPROCESS_UNKNOWN_OP");
  }
} catch (error) {
  writeResponse({
    ok: false,
    errorName: error instanceof Error ? error.name : "Error",
    errorCode: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined,
    errorMessage: error instanceof Error ? error.message : "Excel parser subprocess failed.",
  });
} finally {
  clearInterval(rssWatchdog);
}
