import { describe, expect, it } from "bun:test";
import * as XLSX from "@e965/xlsx";
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

  it("preserves date and legacy XLS normalization", () => {
    expect(parseExcelDate(46188)).toBe("2026-06-15");
    const sheet = XLSX.utils.aoa_to_sheet([["Date", "Name"], ["15/06/2026", "Andi"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Attendance");
    const bytes = new Uint8Array(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }) as Uint8Array);
    expect(readLegacyXlsRows(bytes)).toMatchObject({ sheetName: "Attendance", headers: ["Date", "Name"], rows: [["15/06/2026", "Andi"]] });
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
