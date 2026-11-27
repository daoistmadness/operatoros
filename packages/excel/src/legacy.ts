import { createRequire } from "node:module";
import type * as XLSXTypes from "@operatoros/sheetjs-fork";
import { normalizeHeader } from "./normalization";
import { resolveExcelLimits, validateLegacyXlsContainer, type ExcelResourceLimits } from "./limits";

export type LegacyWorksheetRows = {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  date1904: boolean;
};

let _xlsx: typeof XLSXTypes | null = null;

function getXlsx(): typeof XLSXTypes {
  if (!_xlsx) {
    const req = typeof require === "function" ? require : createRequire(__filename);
    _xlsx = req("@operatoros/sheetjs-fork") as typeof XLSXTypes;
  }
  return _xlsx;
}

export function readLegacyXlsRows(
  buffer: ArrayBuffer | Uint8Array,
  limits?: ExcelResourceLimits,
): LegacyWorksheetRows {
  const resolved = resolveExcelLimits(limits);
  validateLegacyXlsContainer(buffer, resolved);
  const XLSX = getXlsx();
  const input = buffer instanceof ArrayBuffer
    ? Buffer.from(buffer)
    : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const workbook = XLSX.read(input, { type: "buffer", cellDates: true, cellFormula: true });
  if (workbook.SheetNames.length > resolved.maxSheets) {
    throw new Error("EXCEL_SHEET_LIMIT_EXCEEDED");
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheet");
  const sheet = workbook.Sheets[sheetName]!;
  if (sheet["!ref"]) {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r + 1 > resolved.maxRowsPerSheet || range.e.c + 1 > resolved.maxColumnsPerSheet) {
      throw new Error("EXCEL_WORKSHEET_DIMENSIONS_EXCEEDED");
    }
  }
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true }) as unknown[][];
  const headers = (grid[0] ?? []).map(normalizeHeader);
  const rows = grid.slice(1).filter((row) => row.some((value) => value != null && String(value).trim() !== ""));
  return { sheetName, headers, rows, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
}

export function writeLegacyXlsRows(rows: unknown[][], headers: unknown[], sheetName = "Sheet1"): Uint8Array {
  const XLSX = getXlsx();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return new Uint8Array(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }) as Uint8Array);
}
