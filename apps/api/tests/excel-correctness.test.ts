import { describe, expect, it } from "bun:test";
import { addWorksheet, appendRow, createWorkbook, writeLegacyXlsRows, writeXlsxWorkbook } from "@operatoros/excel";
import { parseAttendanceWorkbook } from "../src/import/excel-reader";

const HEADERS = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];

describe("Excel correctness remediation (PR-2)", () => {
  it("propagates date1904 into duplicate keys for both XLS and XLSX (AUD-COR-01)", async () => {
    const xlsBuf = writeLegacyXlsRows(
      [
        [9001, "Andi", 44729, "07:30", "16:00", "", "", "", "25"],
        [9001, "Andi", 44729, "07:30", "16:00", "", "", "", "25"],
        [9002, "Budi", 44729, "07:35", "16:00", "", "", "", "25"],
        [9002, "Budi", 44729, "07:45", "16:00", "", "", "", "25"],
      ],
      HEADERS,
      "Attendance",
      { date1904: true },
    );
    const parsedXls = await parseAttendanceWorkbook(
      xlsBuf.slice().buffer,
      "1904.xls",
    );

    expect(parsedXls.rows.find((r) => r.studentId === 9001)?.date).toBe("2026-06-18");
    expect([...parsedXls.exactDuplicates]).toEqual(["9001\u00002026-06-18"]);
    expect([...parsedXls.divergentDuplicates]).toEqual(["9002\u00002026-06-18"]);

    const wbXlsx = createWorkbook();
    wbXlsx.properties.date1904 = true;
    const wsXlsx = addWorksheet(wbXlsx, "Attendance");
    appendRow(wsXlsx, HEADERS);
    appendRow(wsXlsx, [9001, "Andi", 44729, "07:30", "16:00", "", "", "", "25"]);
    appendRow(wsXlsx, [9001, "Andi", 44729, "07:30", "16:00", "", "", "", "25"]);
    appendRow(wsXlsx, [9002, "Budi", 44729, "07:35", "16:00", "", "", "", "25"]);
    appendRow(wsXlsx, [9002, "Budi", 44729, "07:45", "16:00", "", "", "", "25"]);
    const xlsxU8 = await writeXlsxWorkbook(wbXlsx);
    const parsedXlsx = await parseAttendanceWorkbook(
      xlsxU8.slice().buffer,
      "1904.xlsx",
    );

    expect(parsedXlsx.rows.find((r) => r.studentId === 9001)?.date).toBe("2026-06-18");
    expect([...parsedXlsx.exactDuplicates]).toEqual(["9001\u00002026-06-18"]);
    expect([...parsedXlsx.divergentDuplicates]).toEqual(["9002\u00002026-06-18"]);
  });

  it("reports exact physical Excel row numbers for invalid XLS rows after blank rows (AUD-COR-02)", async () => {
    const xlsBuf = writeLegacyXlsRows(
      [
        [9001, "Andi", "17/06/2026", "07:30", "16:00", "", "", "", "25"],
        [null, null, null, null, null, null, null, null, null],
        [null, "MissingIdRow", "17/06/2026", "07:30", "16:00", "", "", "", "25"],
      ],
      HEADERS,
      "Attendance",
    );
    const parsed = await parseAttendanceWorkbook(
      xlsBuf.slice().buffer,
      "blank-rows.xls",
    );

    expect(parsed.invalidRows).toHaveLength(1);
    expect(parsed.invalidRows[0]?.excelRow).toBe(4);
  });
});
