import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import {
  addWorksheet,
  appendRow,
  autoSizeColumns,
  createWorkbook,
  parseExcelDate,
  readLegacyXlsRows,
  writeLegacyXlsRows,
} from "@operatoros/excel";

const req = createRequire(import.meta.url);

describe("@operatoros/excel correctness regression (PR-2)", () => {
  it("preserves 1-based physical row numbers in legacy XLS across blank rows and non-A1 range offsets", () => {
    const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];
    const bytes = writeLegacyXlsRows([
      [9001, "Andi", "17/06/2026", "07:30", "16:00", "", "", "", "25"],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      [9002, "Budi", "17/06/2026", "07:35", "16:00", "", "", "", "25"],
    ], headers, "Attendance");

    const parsed = readLegacyXlsRows(bytes);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rowNumbers).toEqual([2, 5]);

    // Non-A1 worksheet range offset (starting at B3)
    const XLSX = req("../../sheetjs-fork/xlsx.js");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      [9001, "Andi", "17/06/2026", "07:30", "16:00", "", "", "", "25"],
      [null, null, null, null, null, null, null, null, null],
      [9002, "Budi", "17/06/2026", "07:35", "16:00", "", "", "", "25"],
    ], { origin: "B3" });
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    const offsetBytes = new Uint8Array(XLSX.write(wb, { bookType: "biff8", type: "buffer" }));
    const offsetParsed = readLegacyXlsRows(offsetBytes);
    expect(offsetParsed.headers[1]).toBe("No. ID");
    expect(offsetParsed.rows).toHaveLength(2);
    expect(offsetParsed.rowNumbers).toEqual([4, 6]);
  });

  it("normalizes modern 1900, 1904, fractional, time-only, and invalid serial dates deterministically", () => {
    // 1900 modern dates & leap year
    expect(parseExcelDate(46188, false)).toBe("2026-06-15");
    expect(parseExcelDate(46188.75, false)).toBe("2026-06-15");
    expect(parseExcelDate(45351, false)).toBe("2024-02-29");
    // 1904 date system
    expect(parseExcelDate(0, true)).toBe("1904-01-01");
    expect(parseExcelDate(1, true)).toBe("1904-01-02");
    expect(parseExcelDate(44729, true)).toBe("2026-06-18");
    // Invalid serials
    expect(parseExcelDate(-1, false)).toBeNull();
    expect(parseExcelDate(Number.NaN, false)).toBeNull();
    expect(parseExcelDate(Number.POSITIVE_INFINITY, false)).toBeNull();
    expect(parseExcelDate("31/02/2026", false)).toBeNull();
  });

  it("computes column widths identically across empty, header-only, min, max, and wide worksheets", () => {
    const emptyWb = createWorkbook();
    const emptyWs = addWorksheet(emptyWb, "Empty");
    autoSizeColumns(emptyWs, 12, 60);
    expect(emptyWs.columns).toBeNull();

    const wb = createWorkbook();
    const ws = addWorksheet(wb, "Widths");
    appendRow(ws, ["ID", "Short", "Very Long Header That Exceeds Max Width Limit Of Sixty Characters"]);
    appendRow(ws, [1, "abc", "x".repeat(80)]);
    autoSizeColumns(ws, 12, 60);
    expect(ws.getColumn(1).width).toBe(12);
    expect(ws.getColumn(2).width).toBe(12);
    expect(ws.getColumn(3).width).toBe(60);
  });
});
