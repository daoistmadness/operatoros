import { readFileSync } from "node:fs";
import {
  EXCEL_RESOURCE_LIMITS,
  ExcelWorkbookParseError,
  MachineWorkbookError,
  type ParsedExcelWorkbook,
  type MachineWorkbookPreview,
} from "@operatoros/excel";
import { acquireExcelPermit } from "./excel-admission";
import type { AttendanceSourceRow, InvalidSourceRow, WorkbookRows } from "./excel-reader";

export const PARSER_SUBPROCESS_TIMEOUT_MS = 30_000;
export const PARSER_SUBPROCESS_REAP_TIMEOUT_MS = 5_000;
export const PARSER_SUBPROCESS_MAX_RSS_BYTES = 280 * 1024 * 1024;
export const PARSER_SUBPROCESS_RSS_POLL_MS = 50;
export const MAX_PARSER_IPC_OUTPUT_BYTES = 32 * 1024 * 1024;

export type SubprocessProcessLike = {
  pid?: number;
  stdin: { write(chunk: Uint8Array | string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
};

export function readProcPidRssBytes(pid: number): number | null {
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, "utf8").trim().split(/\s+/);
    const residentPages = Number(statm[1]);
    return Number.isFinite(residentPages) && residentPages > 0 ? residentPages * 4096 : null;
  } catch {
    return null;
  }
}

export type SubprocessSpawner = (cmd: string[]) => SubprocessProcessLike;

const CHILD_ENTRYPOINT = new URL("./excel-parser-child.ts", import.meta.url).pathname;

function defaultSpawner(cmd: string[]): SubprocessProcessLike {
  return Bun.spawn(cmd, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as unknown as SubprocessProcessLike;
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("EXCEL_SUBPROCESS_OUTPUT_LIMIT_EXCEEDED");
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

async function confirmTerminatedAndReaped(proc: SubprocessProcessLike, reapTimeoutMs: number): Promise<boolean> {
  try {
    proc.kill("SIGKILL");
  } catch {
    // Process may already be dead; still wait on proc.exited to confirm reaping.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exited = await Promise.race([
      proc.exited.then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), reapTimeoutMs);
      }),
    ]);
    return exited;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBoundedExcelSubprocess<T>(
  op: "attendance" | "machine" | "xlsx",
  buffer: ArrayBuffer,
  filename: string,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    reapTimeoutMs?: number;
    maxOutputBytes?: number;
    maxRssBytes?: number;
    rssPollIntervalMs?: number;
    readPidRssBytes?: (pid: number) => number | null;
    spawner?: SubprocessSpawner;
  },
): Promise<T> {
  const bytes = buffer.byteLength;
  if (bytes === 0 || bytes > EXCEL_RESOURCE_LIMITS.maxFileBytes) {
    throw new Error("EXCEL_FILE_SIZE_OUT_OF_BOUNDS");
  }

  const release = await acquireExcelPermit(bytes, options?.signal);
  let proc: SubprocessProcessLike;
  try {
    const spawner = options?.spawner ?? defaultSpawner;
    proc = spawner([process.execPath, "--smol", CHILD_ENTRYPOINT]);
  } catch (error) {
    release();
    throw error;
  }

  const timeoutMs = options?.timeoutMs ?? PARSER_SUBPROCESS_TIMEOUT_MS;
  const reapTimeoutMs = options?.reapTimeoutMs ?? PARSER_SUBPROCESS_REAP_TIMEOUT_MS;
  const maxOutputBytes = options?.maxOutputBytes ?? MAX_PARSER_IPC_OUTPUT_BYTES;
  const maxRssBytes = options?.maxRssBytes ?? PARSER_SUBPROCESS_MAX_RSS_BYTES;
  const rssPollIntervalMs = options?.rssPollIntervalMs ?? PARSER_SUBPROCESS_RSS_POLL_MS;
  const readPidRssBytes = options?.readPidRssBytes ?? readProcPidRssBytes;

  let timedOut = false;
  let aborted = false;
  let memoryExceeded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rssTimer: ReturnType<typeof setInterval> | undefined;
  let cleanupAbort: (() => void) | undefined;
  let rejectDeadline!: (error: Error) => void;
  const deadlinePromise = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });

  const killFor = (reason: "timeout" | "abort" | "memory") => {
    if (reason === "timeout") timedOut = true;
    else if (reason === "memory") memoryExceeded = true;
    else aborted = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      // Ignore if already exited.
    }
    rejectDeadline(
      new Error(
        reason === "timeout"
          ? "ATTENDANCE_WORKBOOK_PARSE_TIMEOUT"
          : reason === "memory"
            ? "EXCEL_SUBPROCESS_MEMORY_EXCEEDED"
            : "EXCEL_SUBPROCESS_ABORTED",
      ),
    );
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      killFor("abort");
    } else {
      const onAbort = () => killFor("abort");
      options.signal.addEventListener("abort", onAbort, { once: true });
      cleanupAbort = () => options.signal?.removeEventListener("abort", onAbort);
    }
  }

  timer = setTimeout(() => killFor("timeout"), timeoutMs);
  if (typeof proc.pid === "number" && proc.pid > 0 && maxRssBytes > 0) {
    const childPid = proc.pid;
    rssTimer = setInterval(() => {
      const rssBytes = readPidRssBytes(childPid);
      if (rssBytes !== null && rssBytes > maxRssBytes) {
        killFor("memory");
      }
    }, rssPollIntervalMs);
    rssTimer.unref();
  }

  let releasePermit = false;
  try {
    const headerBytes = new TextEncoder().encode(JSON.stringify({ op, filename }) + "\n");
    const bodyBytes = new Uint8Array(buffer);
    try {
      proc.stdin.write(headerBytes);
      proc.stdin.write(bodyBytes);
      proc.stdin.end();
    } catch {
      // Child may exit early on timeout/abort; stdout/exited handling below settles cleanly.
    }

    const [stdoutBytes, stderrBytes, exitCode] = await Promise.race([
      Promise.all([
        readBoundedStream(proc.stdout, maxOutputBytes),
        readBoundedStream(proc.stderr, 64 * 1024).catch(() => new Uint8Array(0)),
        proc.exited,
      ]),
      deadlinePromise,
    ]);

    // proc.exited has resolved, confirming OS process termination and reaping.
    releasePermit = true;

    if (aborted) {
      throw new Error("EXCEL_SUBPROCESS_ABORTED");
    }
    if (memoryExceeded) {
      throw new Error("EXCEL_SUBPROCESS_MEMORY_EXCEEDED");
    }
    if (timedOut) {
      throw new Error("ATTENDANCE_WORKBOOK_PARSE_TIMEOUT");
    }
    if (exitCode !== 0 && stdoutBytes.byteLength === 0) {
      const errText = new TextDecoder().decode(stderrBytes).trim();
      throw new Error(errText || `Excel parser subprocess exited with code ${exitCode}`);
    }

    const parsed = JSON.parse(new TextDecoder().decode(stdoutBytes)) as
      | { ok: true; result: T }
      | { ok: false; errorName?: string; errorCode?: string; errorMessage?: string };

    if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
      throw new Error("Excel parser subprocess returned an unreadable result");
    }
    if (!parsed.ok) {
      if (parsed.errorName === "MachineWorkbookError") {
        const code =
          parsed.errorCode === "FILE_TOO_LARGE"
          || parsed.errorCode === "MALFORMED_WORKBOOK"
          || parsed.errorCode === "UNSUPPORTED_FORMAT"
          || parsed.errorCode === "UNSUPPORTED_STRUCTURE"
            ? parsed.errorCode
            : "MALFORMED_WORKBOOK";
        throw new MachineWorkbookError(
          code,
          parsed.errorMessage || "The attendance-machine workbook could not be previewed safely.",
        );
      }
      if (parsed.errorName === "ExcelWorkbookParseError") {
        const parseErr = new ExcelWorkbookParseError();
        if (parsed.errorMessage) parseErr.message = parsed.errorMessage;
        throw parseErr;
      }
      const err = new Error(parsed.errorMessage || "Excel parser subprocess failed.");
      err.name = parsed.errorName || "Error";
      throw err;
    }
    return parsed.result;
  } catch (error) {
    if (!releasePermit) {
      const reaped = await confirmTerminatedAndReaped(proc, reapTimeoutMs);
      if (reaped) {
        releasePermit = true;
      }
    }
    if (aborted) {
      throw new Error("EXCEL_SUBPROCESS_ABORTED");
    }
    if (memoryExceeded) {
      throw new Error("EXCEL_SUBPROCESS_MEMORY_EXCEEDED");
    }
    if (timedOut) {
      throw new Error("ATTENDANCE_WORKBOOK_PARSE_TIMEOUT");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (rssTimer) clearInterval(rssTimer);
    cleanupAbort?.();
    if (releasePermit) {
      release();
    }
  }
}

type SerializedWorkbookRows = {
  rows: AttendanceSourceRow[];
  invalidRows: InvalidSourceRow[];
  exactDuplicates: string[];
  divergentDuplicates: string[];
  totalRows: number;
};

export async function runAttendanceSubprocess(
  buffer: ArrayBuffer,
  filename: string,
  options?: Parameters<typeof runBoundedExcelSubprocess>[3],
): Promise<WorkbookRows> {
  const raw = await runBoundedExcelSubprocess<SerializedWorkbookRows>("attendance", buffer, filename, options);
  return {
    rows: raw.rows,
    invalidRows: raw.invalidRows,
    exactDuplicates: new Set(raw.exactDuplicates),
    divergentDuplicates: new Set(raw.divergentDuplicates),
    totalRows: raw.totalRows,
  };
}

export function runMachineAttendanceSubprocess(
  buffer: ArrayBuffer,
  filename: string,
  options?: Parameters<typeof runBoundedExcelSubprocess>[3],
): Promise<MachineWorkbookPreview> {
  return runBoundedExcelSubprocess<MachineWorkbookPreview>("machine", buffer, filename, options);
}

const ISO_UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function runXlsxReadSubprocess(
  buffer: ArrayBuffer,
  filename: string,
  options?: Parameters<typeof runBoundedExcelSubprocess>[3],
): Promise<ParsedExcelWorkbook> {
  const workbook = await runBoundedExcelSubprocess<ParsedExcelWorkbook>("xlsx", buffer, filename, options);
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (let i = 0; i < row.values.length; i += 1) {
        const value = row.values[i];
        if (typeof value === "string" && ISO_UTC_DATE_PATTERN.test(value)) {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) {
            row.values[i] = date;
          }
        }
      }
    }
  }
  return workbook;
}
