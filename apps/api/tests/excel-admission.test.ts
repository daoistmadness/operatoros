import { describe, expect, it } from "bun:test";
import {
  EXCEL_ADMISSION_LIMITS,
  ExcelAdmissionError,
  getExcelAdmissionStats,
  withExcelAdmission,
} from "../src/import/excel-admission";

describe("shared Excel admission control", () => {
  it("allows 1 active job, queues up to 2, rejects overflow, and releases permits on error", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const job1 = withExcelAdmission(1024, () => firstGate);
    expect(getExcelAdmissionStats().activeJobs).toBe(1);

    const job2 = withExcelAdmission(1024, async () => "ok2");
    const job3 = withExcelAdmission(1024, async () => "ok3");
    expect(getExcelAdmissionStats().queuedJobs).toBe(2);

    await expect(withExcelAdmission(1024, async () => "overflow")).rejects.toMatchObject({
      code: "EXCEL_ADMISSION_BUSY",
      status: 503,
    });

    releaseFirst();
    expect(await Promise.all([job1, job2, job3])).toEqual([undefined, "ok2", "ok3"]);
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });

    await expect(
      withExcelAdmission(1024, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });

  it("enforces aggregate queued byte budget and AbortSignal cancellation", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const job1 = withExcelAdmission(1024, () => firstGate);

    const controller = new AbortController();
    const job2 = withExcelAdmission(EXCEL_ADMISSION_LIMITS.maxQueuedBytes - 1024, async () => "ok", controller.signal);

    await expect(withExcelAdmission(2048, async () => "too-heavy")).rejects.toBeInstanceOf(ExcelAdmissionError);

    controller.abort();
    await expect(job2).rejects.toMatchObject({ code: "EXCEL_ADMISSION_ABORTED", status: 503 });
    expect(getExcelAdmissionStats().queuedBytes).toBe(0);

    releaseFirst();
    await job1;
    expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
  });
});
