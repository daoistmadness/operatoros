import { expect, mock, test } from "bun:test";
import { getExcelAdmissionStats, withExcelAdmission } from "../src/import/excel-admission";
import { readAttendanceInWorker } from "../src/import/excel-reader";

test("timeout rejects the upload while retaining admission until the parser reports completion", async () => {
  const worker = Object.assign(new EventTarget(), {
    terminate: mock(),
    postMessage: mock(),
  });

  await expect(readAttendanceInWorker(new ArrayBuffer(65_536), "synthetic.xls", () => worker, 0))
    .rejects.toThrow("ATTENDANCE_WORKBOOK_PARSE_TIMEOUT");
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);

  worker.dispatchEvent(new Event("close"));
  const nextJob = mock(async () => "next");
  const next = withExcelAdmission(256, nextJob);
  expect(getExcelAdmissionStats()).toEqual({ activeJobs: 1, queuedJobs: 1, queuedBytes: 256 });
  expect(nextJob).not.toHaveBeenCalled();

  worker.dispatchEvent(new MessageEvent("message", { data: { id: 0 } }));
  expect(nextJob).not.toHaveBeenCalled();
  expect(getExcelAdmissionStats().queuedBytes).toBe(256);

  worker.dispatchEvent(new MessageEvent("message", {
    data: { id: 0, errorName: "Error", errorMessage: "Parser finished" },
  }));
  await expect(next).resolves.toBe("next");
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
});

test("worker construction failure releases admission before any parser is dispatched", async () => {
  const createWorker = () => {
    throw new Error("Worker could not start");
  };
  await expect(readAttendanceInWorker(new ArrayBuffer(65_536), "synthetic.xls", createWorker))
    .rejects.toThrow("Worker could not start");
  expect(getExcelAdmissionStats()).toEqual({ activeJobs: 0, queuedJobs: 0, queuedBytes: 0 });
});
