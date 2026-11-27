import { describe, expect, it } from "bun:test";
import { addWorksheet, appendRow, createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import {
  createAdmittedXlsxResponse,
  getExcelAdmissionStats,
  withExcelAdmission,
} from "../src/import/excel-admission";
import {
  runAttendanceSubprocess,
  runBoundedExcelSubprocess,
  type SubprocessProcessLike,
} from "../src/import/excel-subprocess";
import {
  admitExcelUploadRequest,
  getExcelUploadAdmissionStats,
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
});
