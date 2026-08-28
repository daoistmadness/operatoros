import * as XLSX from "@e965/xlsx";
import { normalizeHeader } from "./normalization";

export type LegacyWorksheetRows = {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  date1904: boolean;
};

export function readLegacyXlsRows(buffer: ArrayBuffer | Uint8Array): LegacyWorksheetRows {
  const input = buffer instanceof ArrayBuffer
    ? Buffer.from(buffer)
    : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const workbook = XLSX.read(input, { type: "buffer", cellDates: true, cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheet");
  const sheet = workbook.Sheets[sheetName]!;
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][];
  const headers = (grid[0] ?? []).map(normalizeHeader);
  const rows = grid.slice(1).filter((row) => row.some((value) => value != null && String(value).trim() !== ""));
  return { sheetName, headers, rows, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
}

export function writeLegacyXlsRows(rows: unknown[][], headers: unknown[], sheetName = "Sheet1"): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return new Uint8Array(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }) as Uint8Array);
}
