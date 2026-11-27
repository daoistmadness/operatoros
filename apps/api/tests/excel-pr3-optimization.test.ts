import { describe, expect, it } from "bun:test";
import { addWorksheet, appendRow, createWorkbook, writeLegacyXlsRows, writeXlsxWorkbook } from "@operatoros/excel";
import { parseAttendanceWorkbook } from "../src/import/excel-reader";

const HEADERS = [
  "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
  "Terlambat", "Absent", "Lembur", "Pengecualian", "week",
];

function makeSyntheticMachineProfile243(): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 243; i += 1) {
    const idx = i === 1 ? 0 : i;
    const id = `2026${String(1000 + (idx % 60)).padStart(4, "0")}`;
    const name = `Siswa Uji ${String(idx % 60).padStart(3, "0")}`;
    const day = 1 + (Math.floor(idx / 60) % 28);
    const date = `${String(day).padStart(2, "0")}/04/2026`;
    const scanIn = `07:${String((idx * 3) % 30).padStart(2, "0")}`;
    const scanOut = `15:${String((idx * 5) % 40).padStart(2, "0")}`;
    const late = idx >= 10 && idx < 14 ? `00:${String(5 + (idx - 10) * 3).padStart(2, "0")}` : "";
    const week = `Minggu ${1 + (Math.floor(idx / 60) % 4)}`;
    rows.push([id, name, date, scanIn, scanOut, late, "", "", "", week]);
  }
  return rows;
}

describe("Excel algorithmic optimization parity & edge cases (PR-3)", () => {
  it("parses synthetic 243-row 10-column machine profile identically across XLSX and XLS", async () => {
    const profileRows = makeSyntheticMachineProfile243();

    const wb = createWorkbook();
    const ws = addWorksheet(wb, "Attendance");
    appendRow(ws, HEADERS);
    for (const r of profileRows) appendRow(ws, r);
    const xlsxBuf = (await writeXlsxWorkbook(wb)).slice().buffer;
    const xlsBuf = writeLegacyXlsRows(profileRows, HEADERS, "Attendance").slice().buffer;

    const parsedXlsx = await parseAttendanceWorkbook(xlsxBuf, "profile243.xlsx");
    const parsedXls = await parseAttendanceWorkbook(xlsBuf, "profile243.xls");

    expect(parsedXlsx.totalRows).toBe(243);
    expect(parsedXlsx.rows).toHaveLength(242);
    expect(parsedXlsx.exactDuplicates.size).toBe(1);
    expect(parsedXlsx.divergentDuplicates.size).toBe(0);
    expect(parsedXls).toEqual(parsedXlsx);
  });

  it("classifies exact, divergent, mixed, interleaved, and delimiter-containing duplicate groups", async () => {
    const rows = [
      // Exact pair (9001)
      ["009001", "Andi", "17/06/2026", "07:30", "16:00", "", "", "", "", "25"],
      ["009001", "Andi", "17/06/2026", "07:30", "16:00", "", "", "", "", "25"],
      // Mixed exact + divergent in one group (9002)
      ["009002", "Budi", "17/06/2026", "07:35", "16:00", "", "", "", "", "25"],
      ["009002", "Budi", "17/06/2026", "07:35", "16:00", "", "", "", "", "25"],
      ["009002", "Budi", "17/06/2026", "07:45", "16:00", "", "", "", "", "25"],
      // Delimiter collision guard: \u0001 inside values must not collide
      ["009003", "Citra\u0001X", "17/06/2026", "07:30", "16:00", "", "", "", "Y", "25"],
      ["009003", "Citra", "17/06/2026", "07:30", "16:00", "", "", "", "X\u0001Y", "25"],
      // Unique (9001 on different date)
      ["009001", "Andi", "18/06/2026", "07:30", "16:00", "", "", "", "", "25"],
    ];

    const wb = createWorkbook();
    const ws = addWorksheet(wb, "Attendance");
    appendRow(ws, HEADERS);
    for (const r of rows) appendRow(ws, r);
    const parsed = await parseAttendanceWorkbook((await writeXlsxWorkbook(wb)).slice().buffer, "dups.xlsx");

    expect([...parsed.exactDuplicates]).toEqual(["9001\u00002026-06-17"]);
    expect([...parsed.divergentDuplicates]).toEqual(["9002\u00002026-06-17", "9003\u00002026-06-17"]);
  });

  it("handles reordered headers, extra columns, duplicate headers (last-wins), and sparse rows", async () => {
    const customHeaders = [
      "Extra1", "week", "No. ID", "Nama", "Tanggal", "Scan Masuk",
      "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "No. ID",
    ];
    const row1 = ["ignore", "25", "9999", "Siswa", "17/06/2026", "07:30", "16:00", "", "", "", "1001"];

    const wb = createWorkbook();
    const ws = addWorksheet(wb, "Attendance");
    appendRow(ws, customHeaders);
    appendRow(ws, row1);
    const parsedXlsx = await parseAttendanceWorkbook((await writeXlsxWorkbook(wb)).slice().buffer, "reordered.xlsx");
    const parsedXls = await parseAttendanceWorkbook(writeLegacyXlsRows([row1], customHeaders, "Attendance").slice().buffer, "reordered.xls");

    expect(parsedXlsx.rows[0]?.studentId).toBe(1001);
    expect(parsedXls.rows[0]?.studentId).toBe(1001);
    expect(parsedXls).toEqual(parsedXlsx);
  });
});
