import { describe, expect, it } from "bun:test";
import { appendRow, createWorkbook, parseMachineAttendanceWorkbook, writeXlsxWorkbook } from "../src";

const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Absent", "Lembur", "Pengecualian", "week"];

async function workbook(rows: unknown[][]): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-attendance-test" });
  const sheet = book.addWorksheet("Machine Export");
  appendRow(sheet, headers);
  rows.forEach((row) => appendRow(sheet, row));
  return writeXlsxWorkbook(book);
}

describe("machine attendance XLSX preview parser", () => {
  it("keeps scan evidence separate from attendance status and preserves exact identifiers", async () => {
    const result = await parseMachineAttendanceWorkbook(await workbook([
      ["00123", "Synthetic One", "03/04/2026", "07:00", "15:00", "", "", "", "", "Friday"],
      ["00789", "Synthetic Late", "03/04/2026", "07:10", "15:00", "00:10", "", "", "", "Friday"],
      ["00123", "Synthetic One", "03/04/2026", "07:00", "15:30", "", "", "", "", "Friday"],
      ["00456", "Synthetic Two", "04/04/2026", "", "", "", "", "", "", "Saturday"],
      ["bad-id", "Synthetic Three", "05/04/2026", "bad", "", "", "", "", "", "Sunday"],
    ]));
    expect(result.detectedProfile).toBe("ATTENDANCE_MACHINE_TABULAR_V1");
    expect(result.dateCoverage).toEqual({ from: "2026-04-03", to: "2026-04-04", distinctDates: 2 });
    expect(result.rows[0]).toMatchObject({ machineStudentIdentifier: "00123", date: "2026-04-03", machineEvidence: "MULTIPLE_SCANS", scanTimes: ["07:00", "15:00", "15:30"] });
    expect(result.rows.find((row) => row.machineStudentIdentifier === "00456")).toMatchObject({ date: "2026-04-04", machineEvidence: "NO_SCAN", scanTimes: [] });
    expect(result.rows.find((row) => row.machineStudentIdentifier === "00789")).toMatchObject({ machineEvidence: "SCAN_PRESENT", lateMinutes: 10 });
    expect(result.rows.find((row) => row.machineStudentIdentifier === null)).toMatchObject({ machineEvidence: "INVALID_SCAN_VALUE" });
  });

  it("rejects non-OOXML files and missing machine columns", async () => {
    await expect(parseMachineAttendanceWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    const book = createWorkbook();
    const sheet = book.addWorksheet("Invalid");
    appendRow(sheet, headers.slice(0, -1));
    await expect(parseMachineAttendanceWorkbook(await writeXlsxWorkbook(book))).rejects.toMatchObject({ code: "UNSUPPORTED_STRUCTURE" });
  });
});
