import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EXCEL_EXPORT_FORMAT_VERSION,
  addWorksheet,
  appendRow,
  createWorkbook,
  ExcelWorkbookParseError,
  loadXlsxWorkbook,
  parseExcelDate,
  readXlsxWorkbook,
  readLegacyXlsRows,
  safeExportFilename,
  safeCellValue,
  safeWorksheetName,
  styleHeader,
  writeXlsxWorkbook,
} from "@operatoros/excel";

describe("@operatoros/excel", () => {
  it("writes a versioned workbook with safe values and metadata", async () => {
    const workbook = createWorkbook({ exportType: "security-test", generatedAt: new Date("2026-08-29T00:00:00.000Z") });
    const sheet = addWorksheet(workbook, "Unsafe/[Sheet]");
    appendRow(sheet, ["Name", "Value"]);
    appendRow(sheet, ["=SUM(A1:A2)", 83.35]);
    styleHeader(sheet);

    const bytes = await writeXlsxWorkbook(workbook);
    const loaded = await loadXlsxWorkbook(bytes);
    expect(loaded.creator).toBe("OperatorOS");
    expect(loaded.keywords).toContain(EXCEL_EXPORT_FORMAT_VERSION);
    expect(loaded.worksheets[0]?.name).toBe("Unsafe--Sheet-");
    expect((loaded as unknown as { sheets?: unknown }).sheets).toBeUndefined();
    expect(loaded.worksheets[0]?.getCell("A2").value).toBe("'=SUM(A1:A2)");
    expect(loaded.worksheets[0]?.getCell("B2").value).toBe(83.35);
  });

  it("sanitizes sheet names and export filenames without collisions", () => {
    expect(safeWorksheetName("A/B:C*D?E[F]", [])).toBe("A-B-C-D-E-F-");
    expect(safeWorksheetName("Report", ["Report"])).toBe("Report (2)");
    expect(safeExportFilename("../student report")).toBe("student-report.xlsx");
    expect(["=SUM(A1:A2)", "+text", "-text", "@text"].map(safeCellValue)).toEqual(["'=SUM(A1:A2)", "'+text", "'-text", "'@text"]);
  });

  it("preserves date and legacy XLS normalization from static fixture", () => {
    expect(parseExcelDate(46188)).toBe("2026-06-15");
    const fixturePath = new URL("./fixtures/legacy-attendance.xls", import.meta.url).pathname;
    const bytes = readFileSync(fixturePath);
    const parsed = readLegacyXlsRows(bytes);
    expect(parsed.sheetName).toBe("Attendance");
    expect(parsed.headers).toEqual([
      "No. ID",
      "Nama",
      "Tanggal",
      "Scan Masuk",
      "Scan Pulang",
      "Terlambat",
      "Lembur",
      "Pengecualian",
      "week",
    ]);
    expect(parsed.rows.length).toBe(6);
    expect(parsed.rows[0]).toEqual([9001, "Andi", "17/06/2026", "07:30", "16:00", "00:25", null, null, "25"]);
    expect(parsed.rows[1]?.[1]).toBe("Renée Müller");
    expect(parsed.rows[1]?.[2]).toBeInstanceOf(Date);
    expect(parsed.rows[2]?.[1]).toBe("田中太郎");
    expect(parsed.rows[2]?.[2]).toBe(46188);
  });

  it("normalizes XLSX worksheet data without exposing ExcelJS shapes", async () => {
    const workbook = createWorkbook();
    const roster = workbook.addWorksheet("Roster");
    roster.addRow(["student_identifier", "student_name"]);
    roster.addRow(["1001", "Synthetic Student"]);
    workbook.addWorksheet("Instructions").addRow(["Help", "Use the Roster sheet"]);

    const parsed = await readXlsxWorkbook(await writeXlsxWorkbook(workbook));

    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Roster", "Instructions"]);
    expect(parsed.sheets[0]).toMatchObject({
      headers: ["student_identifier", "student_name"],
      rows: [{ rowNumber: 2, values: ["1001", "Synthetic Student"] }],
    });
  });

  it("converts corrupt XLSX input into a controlled workbook error", async () => {
    await expect(readXlsxWorkbook(Uint8Array.from([0, 1, 2, 3]))).rejects.toBeInstanceOf(ExcelWorkbookParseError);
    await expect(readXlsxWorkbook(Uint8Array.from([0, 1, 2, 3]))).rejects.toMatchObject({ code: "EXCEL_WORKBOOK_PARSE_FAILED" });
  });
});
