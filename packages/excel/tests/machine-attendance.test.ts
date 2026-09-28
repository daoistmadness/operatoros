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
    expect(result.dateCoverage).toEqual({ from: "2026-04-03", to: "2026-04-05", distinctDates: 3 });
    expect(result.rows[0]).toMatchObject({ machineStudentIdentifier: "00123", date: "2026-04-03", checkIn: "07:00", checkOut: "15:30", machineEvidence: "MULTIPLE_SCANS", scanTimes: ["07:00", "15:00", "15:30"], sourceRows: [2, 4] });
    expect(result.rows[0]?.sourceEvidence).toHaveLength(2);
    expect(result.rows[0]?.sourceEvidence[0]?.values["No. ID"]).toBe("00123");
    expect(result.rows[0]?.qualityWarnings).toContain("DUPLICATE_SOURCE_ROWS_MERGED");
    expect(result.rows.find((row) => row.machineStudentIdentifier === "00456")).toMatchObject({ date: "2026-04-04", machineEvidence: "NO_SCAN", scanTimes: [] });
    expect(result.rows.find((row) => row.machineStudentIdentifier === "00789")).toMatchObject({ machineEvidence: "SCAN_PRESENT", sourceLateMinutes: 10 });
    expect(result.rows.find((row) => row.machineStudentIdentifier === null)).toMatchObject({ machineEvidence: "INVALID_SCAN_VALUE" });
  });

  it("normalizes source fields independently and retains invalid raw values", async () => {
    const result = await parseMachineAttendanceWorkbook(await workbook([
      ["00123", "Synthetic One", "03/04/2026", "07:21", "14", "14", "14", "14", "14", "Friday"],
      ["00123", "Synthetic One", "03/04/2026", "07:18", "14:10", "00:18", "", "", "", "Friday"],
      ["00456", "Synthetic Two", "04/04/2026", "14", "14:05", "00:03", "", "", "", "Saturday"],
    ]));
    const merged = result.rows.find((row) => row.machineStudentIdentifier === "00123");
    expect(merged).toMatchObject({ checkIn: "07:18", checkOut: "14:10", sourceRows: [2, 3], sourceLateMinutes: 18 });
    expect(merged?.qualityWarnings).toEqual(expect.arrayContaining(["DUPLICATE_SOURCE_ROWS_MERGED", "INVALID_SCAN_OUT", "INVALID_SOURCE_LATENESS", "INVALID_ABSENT", "INVALID_OVERTIME"]));
    expect(merged?.sourceEvidence[0]?.values["Scan Pulang"]).toBe("14");
    expect(merged?.sourceEvidence[0]?.fields.scanOut).toEqual({ state: "INVALID", value: null });
    const invalidIn = result.rows.find((row) => row.machineStudentIdentifier === "00456");
    expect(invalidIn).toMatchObject({ checkIn: null, checkOut: "14:05", machineEvidence: "INVALID_SCAN_VALUE" });
    expect(invalidIn?.sourceEvidence[0]?.values["Scan Masuk"]).toBe("14");
  });

  it("flags conflicting source names instead of silently merging identity evidence", async () => {
    const result = await parseMachineAttendanceWorkbook(await workbook([
      ["00123", "Synthetic One", "03/04/2026", "07:10", "", "", "", "", "", "Friday"],
      ["00123", "Different Person", "03/04/2026", "07:12", "", "", "", "", "", "Friday"],
    ]));
    expect(result.rows[0]).toMatchObject({ checkIn: "07:10", sourceIdentityConflict: true, sourceRows: [2, 3] });
    expect(result.rows[0]?.qualityWarnings).toContain("SOURCE_IDENTITY_CONFLICT");
  });

  it("rejects non-OOXML files and missing machine columns", async () => {
    await expect(parseMachineAttendanceWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    const book = createWorkbook();
    const sheet = book.addWorksheet("Invalid");
    appendRow(sheet, headers.slice(0, -1));
    await expect(parseMachineAttendanceWorkbook(await writeXlsxWorkbook(book))).rejects.toMatchObject({ code: "UNSUPPORTED_STRUCTURE" });
  });
});
