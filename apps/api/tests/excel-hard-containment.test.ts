import { describe, expect, it } from "bun:test";
import { addWorksheet, appendRow, createWorkbook, writeLegacyXlsRows, writeXlsxWorkbook } from "@operatoros/excel";
import {
  createAdmittedXlsxResponse,
  getExcelAdmissionStats,
  getExcelExportOutputStats,
  withExcelAdmission,
} from "../src/import/excel-admission";
import { readAttendanceWorkbook } from "../src/import/excel-reader";
import {
  runAttendanceSubprocess,
  runBoundedExcelSubprocess,
  type SubprocessProcessLike,
} from "../src/import/excel-subprocess";
import {
  admitExcelUploadRequest,
  ExcelUploadLimitError,
  getExcelUploadAdmissionStats,
  readBoundedUploadFormData,
  releaseExcelUploadRequest,
} from "../src/import/excel-upload-admission";

const HEADERS = [
  "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
  "Terlambat", "Lembur", "Pengecualian", "week",
];

async function makeValidXlsx(rowCount = 10): Promise<ArrayBuffer> {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Attendance");
  appendRow(ws, HEADERS);
  for (let i = 0; i < rowCount; i += 1) {
    appendRow(ws, [9001 + i, `Siswa ${i}`, "17/06/2026", "07:30", "16:00", "", "", "", "25"]);
  }
  const u8 = await writeXlsxWorkbook(wb);
  return u8.slice().buffer;
}

describe("Gate 5B hard resource containment & automatic recovery", () => {
  it("terminates a stuck parser subprocess with SIGKILL, reaps it, and recovers automatically for the next valid job", async () => {
    const buf = await makeValidXlsx(5);
    const stuckSpawner = () =>
      Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as unknown as SubprocessProcessLike;

    await expect(
      runBoundedExcelSubprocess("attendance", buf, "stuck.xlsx", {
        timeoutMs: 50,
        reapTimeoutMs: 2000,
        spawner: stuckSpawner,
      }),
    ).rejects.toThrow("ATTENDANCE_WORKBOOK_PARSE_TIMEOUT");

    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });

    const valid = await runAttendanceSubprocess(buf, "valid.xlsx");
    expect(valid.totalRows).toBe(5);
    expect(valid.rows).toHaveLength(5);
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("enforces bounded IPC output and client cancellation with confirmed process reaping", async () => {
    const buf = await makeValidXlsx(20);
    await expect(
      runBoundedExcelSubprocess("attendance", buf, "ipc-cap.xlsx", { maxOutputBytes: 64 }),
    ).rejects.toThrow("EXCEL_SUBPROCESS_OUTPUT_LIMIT_EXCEEDED");
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });

    const ac = new AbortController();
    const stuckSpawner = () =>
      Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as unknown as SubprocessProcessLike;

    const promise = runBoundedExcelSubprocess("attendance", buf, "abort.xlsx", {
      signal: ac.signal,
      timeoutMs: 5000,
      spawner: stuckSpawner,
    });
    setTimeout(() => ac.abort(), 30);
    await expect(promise).rejects.toThrow("EXCEL_SUBPROCESS_ABORTED");
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("enforces early upload admission before multipart parsing and releases on completion or abort", () => {
    const oversize = new Request("http://localhost/api/uploads/preview", {
      method: "POST",
      headers: { "content-length": String(26 * 1024 * 1024) },
    });
    expect(admitExcelUploadRequest(oversize)).toMatchObject({ admitted: false, status: 413 });

    const r1 = new Request("http://localhost/api/uploads/preview", {
      method: "POST",
      headers: { "content-length": String(1024) },
    });
    const r2 = new Request("http://localhost/api/attendance/machine-import/preview", {
      method: "POST",
      headers: { "content-length": String(1024) },
    });
    const r3 = new Request("http://localhost/api/student-enrollments/roster-preview", {
      method: "POST",
      headers: { "content-length": String(1024) },
    });

    expect(admitExcelUploadRequest(r1)).toEqual({ admitted: true });
    expect(admitExcelUploadRequest(r2)).toEqual({ admitted: true });
    expect(admitExcelUploadRequest(r3)).toMatchObject({ admitted: false, status: 503 });
    expect(getExcelUploadAdmissionStats()).toEqual({ activeUploads: 2, inFlightBytes: 2048 });

    releaseExcelUploadRequest(r1);
    releaseExcelUploadRequest(r2);
    expect(getExcelUploadAdmissionStats()).toEqual({ activeUploads: 0, inFlightBytes: 0 });
  });

  it("holds shared Excel admission during export build and releases on completion", async () => {
    let releaseBuild!: () => void;
    const buildGate = new Promise<void>((resolve) => { releaseBuild = resolve; });
    const exportPromise = createAdmittedXlsxResponse(async () => {
      await buildGate;
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        headers: { "content-type": "application/octet-stream" },
      };
    });
    expect(getExcelAdmissionStats().activeJobs).toBe(1);

    const queuedImport = withExcelAdmission(1024, async () => "imported");
    expect(getExcelAdmissionStats().queuedJobs).toBe(1);

    releaseBuild();
    const res = await exportPromise;
    const downloaded = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(downloaded)).toEqual([1, 2, 3, 4]);
    await expect(queuedImport).resolves.toBe("imported");
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("retains permit fail-closed in an isolated process if a child refuses to reap after SIGKILL", async () => {
    const res = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
          import { getExcelAdmissionStats } from "./src/import/excel-admission.ts";
          import { runBoundedExcelSubprocess } from "./src/import/excel-subprocess.ts";
          const buf = new ArrayBuffer(128);
          try {
            await runBoundedExcelSubprocess("attendance", buf, "zombie.xlsx", {
              timeoutMs: 20,
              reapTimeoutMs: 40,
              spawner: () => ({
                stdin: { write() {}, end() {} },
                stdout: new ReadableStream({ start() {} }),
                stderr: new ReadableStream({ start(c) { c.close(); } }),
                exited: new Promise(() => {}),
                kill() {},
              }),
            });
          } catch (e) {
            if (e.message !== "ATTENDANCE_WORKBOOK_PARSE_TIMEOUT") process.exit(2);
          }
          if (getExcelAdmissionStats().activeJobs !== 1) process.exit(3);
        `,
      ],
      { cwd: new URL("..", import.meta.url).pathname },
    );
    expect(res.exitCode).toBe(0);
  });

  it("terminates a synchronously blocked child via parent-side RSS supervision and recovers", async () => {
    const buf = await makeValidXlsx(5);
    let pollCount = 0;
    const syncStuckSpawner = () =>
      Bun.spawn([process.execPath, "-e", "while (true) {}"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as unknown as SubprocessProcessLike;

    await expect(
      runBoundedExcelSubprocess("attendance", buf, "sync-rss.xlsx", {
        timeoutMs: 5000,
        reapTimeoutMs: 2000,
        maxRssBytes: 1024 * 1024,
        rssPollIntervalMs: 15,
        readPidRssBytes: () => {
          pollCount += 1;
          return pollCount >= 2 ? 2 * 1024 * 1024 : 512 * 1024;
        },
        spawner: syncStuckSpawner,
      }),
    ).rejects.toThrow("EXCEL_SUBPROCESS_MEMORY_EXCEEDED");

    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });

    const valid = await runAttendanceSubprocess(buf, "after-rss.xlsx");
    expect(valid.totalRows).toBe(5);
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("routes small (< 64 KiB) XLSX and XLS workbooks through the isolated subprocess", async () => {
    const smallXlsx = await makeValidXlsx(3);
    expect(smallXlsx.byteLength).toBeLessThan(64 * 1024);
    const xlsxParsed = await readAttendanceWorkbook(smallXlsx, "small.xlsx");
    expect(xlsxParsed.totalRows).toBe(3);

    const xlsBytes = writeLegacyXlsRows(
      [[9001, "Siswa 1", "17/06/2026", "07:30", "16:00", "", "", "", "25"]],
      HEADERS,
      "Attendance",
    );
    const smallXls = xlsBytes.slice().buffer;
    expect(smallXls.byteLength).toBeLessThan(64 * 1024);
    const xlsParsed = await readAttendanceWorkbook(smallXls, "small.xls");
    expect(xlsParsed.totalRows).toBe(1);
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("enforces actual streaming upload byte bounds even when Content-Length is missing or spoofed, with idempotent release", async () => {
    const chunkSize = 128 * 1024;
    let chunksServed = 0;
    const oversizeStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksServed >= 10) {
          controller.close();
          return;
        }
        chunksServed += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    const spoofedReq = new Request("http://localhost/api/uploads/preview", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----test",
        "content-length": "100",
      },
      body: oversizeStream,
    });

    expect(admitExcelUploadRequest(spoofedReq)).toEqual({ admitted: true });
    await expect(readBoundedUploadFormData(spoofedReq, 128 * 1024)).rejects.toBeInstanceOf(ExcelUploadLimitError);
    // Aborted before draining all 10 chunks (128 KiB limit + 256 KiB envelope = 384 KiB -> stops at <= 4 chunks)
    expect(chunksServed).toBeLessThan(10);

    releaseExcelUploadRequest(spoofedReq);
    releaseExcelUploadRequest(spoofedReq);
    expect(getExcelUploadAdmissionStats()).toEqual({ activeUploads: 0, inFlightBytes: 0 });
  });

  it("accounts for retained export output bytes until stream consumption or cancellation", async () => {
    const res1 = await createAdmittedXlsxResponse(async () => ({
      bytes: new Uint8Array(4096),
      headers: { "content-type": "application/octet-stream" },
    }));
    expect(getExcelAdmissionStats().activeJobs).toBe(0);
    expect(getExcelExportOutputStats().retainedOutputBytes).toBe(4096);

    const res2 = await createAdmittedXlsxResponse(async () => ({
      bytes: new Uint8Array(2048),
      headers: { "content-type": "application/octet-stream" },
    }));
    expect(getExcelExportOutputStats().retainedOutputBytes).toBe(6144);

    await res1.arrayBuffer();
    expect(getExcelExportOutputStats().retainedOutputBytes).toBe(2048);

    await res2.body?.cancel();
    expect(getExcelExportOutputStats().retainedOutputBytes).toBe(0);
  });
});
