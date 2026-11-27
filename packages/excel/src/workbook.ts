import ExcelJS from "exceljs";
import type { ExcelWorksheetDto } from "@operatoros/contracts/excel";
import { addWorksheet, appendRow, styleHeader, autoSizeColumns } from "./sheets";
import { normalizeHeader } from "./normalization";
import { resolveExcelLimits, validateXlsxContainer, type ExcelResourceLimits } from "./limits";

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const EXCEL_EXPORT_FORMAT_VERSION = "operatoros-excel-v1";

export type ExcelWorkbook = ExcelJS.Workbook;
export type ExcelWorksheet = ExcelJS.Worksheet;
export type ExcelCell = ExcelJS.Cell;

export type ExcelWorksheetData = {
  name: string;
  headers: string[];
  rows: Array<{ rowNumber: number; values: unknown[] }>;
};

export type ParsedExcelWorkbook = {
  sheets: ExcelWorksheetData[];
  date1904: boolean;
};

export const EXCEL_WORKBOOK_PARSE_FAILED = "EXCEL_WORKBOOK_PARSE_FAILED" as const;

export class ExcelWorkbookParseError extends Error {
  readonly code = EXCEL_WORKBOOK_PARSE_FAILED;

  constructor(cause?: unknown) {
    super("Unable to read this workbook. Verify that it is a valid supported Excel file.");
    this.name = "ExcelWorkbookParseError";
    this.cause = cause;
  }
}

export type WorkbookMetadata = {
  exportType?: string;
  sourceSchemaVersion?: string;
  generatedAt?: Date;
};

export function createWorkbook(metadata: WorkbookMetadata = {}): ExcelWorkbook {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = metadata.generatedAt ?? new Date();
  workbook.creator = "OperatorOS";
  workbook.lastModifiedBy = "OperatorOS";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.company = "OperatorOS";
  workbook.subject = metadata.exportType ? `OperatorOS ${metadata.exportType}` : "OperatorOS export";
  workbook.title = metadata.exportType ?? "OperatorOS export";
  workbook.keywords = [EXCEL_EXPORT_FORMAT_VERSION, metadata.sourceSchemaVersion].filter(Boolean).join(", ");
  return workbook;
}

function toBuffer(value: ArrayBuffer | Uint8Array): Buffer {
  return value instanceof ArrayBuffer
    ? Buffer.from(value)
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export async function loadXlsxWorkbook(
  value: ArrayBuffer | Uint8Array,
  limits?: ExcelResourceLimits,
): Promise<ExcelWorkbook> {
  const resolved = resolveExcelLimits(limits);
  try {
    validateXlsxContainer(value, resolved);
  } catch (cause) {
    throw new ExcelWorkbookParseError(cause);
  }
  const workbook = createWorkbook();
  const buffer = toBuffer(value) as unknown as Parameters<ExcelWorkbook["xlsx"]["load"]>[0];
  try {
    await workbook.xlsx.load(buffer);
  } catch (cause) {
    throw new ExcelWorkbookParseError(cause);
  }
  if (!workbook || !Array.isArray(workbook.worksheets) || !workbook.worksheets.length) {
    throw new ExcelWorkbookParseError();
  }
  if (workbook.worksheets.length > resolved.maxSheets) {
    throw new ExcelWorkbookParseError(new Error("EXCEL_SHEET_LIMIT_EXCEEDED"));
  }
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > resolved.maxRowsPerSheet || sheet.columnCount > resolved.maxColumnsPerSheet) {
      throw new ExcelWorkbookParseError(new Error("EXCEL_WORKSHEET_DIMENSIONS_EXCEEDED"));
    }
  }
  return workbook;
}

export async function readXlsxWorkbook(
  value: ArrayBuffer | Uint8Array,
  limits?: ExcelResourceLimits,
): Promise<ParsedExcelWorkbook> {
  const resolved = resolveExcelLimits(limits);
  const workbook = await loadXlsxWorkbook(value, resolved);
  let totalPopulatedCells = 0;
  const sheets = workbook.worksheets.map((sheet) => {
    const columnCount = sheet.columnCount;
    const headerRow = sheet.getRow(1);
    const headers = Array.from({ length: columnCount }, (_, index) =>
      normalizeHeader(getCellValue(headerRow.getCell(index + 1))),
    );
    const rows: Array<{ rowNumber: number; values: unknown[] }> = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 1) return;
      const values = new Array<unknown>(columnCount).fill(null);
      let hasPopulated = false;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber < 1 || colNumber > columnCount) return;
        totalPopulatedCells += 1;
        if (totalPopulatedCells > resolved.maxPopulatedCells) {
          throw new ExcelWorkbookParseError(new Error("EXCEL_CELL_BUDGET_EXCEEDED"));
        }
        values[colNumber - 1] = getCellValue(cell);
        hasPopulated = true;
      });
      if (hasPopulated) {
        rows.push({ rowNumber, values });
      }
    });
    return { name: sheet.name, headers, rows };
  });
  if (!sheets.length) throw new ExcelWorkbookParseError();
  return { sheets, date1904: Boolean(workbook.properties.date1904) };
}

export async function writeXlsxWorkbook(workbook: ExcelWorkbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function getCellValue(cell: ExcelCell): unknown {
  const value = cell.value as unknown;
  return value && typeof value === "object" && "result" in value
    ? (value as { result: unknown }).result
    : value;
}

export function appendWorksheetTable(workbook: ExcelWorkbook, table: ExcelWorksheetDto): ExcelWorksheet {
  const sheet = addWorksheet(workbook, table.name);
  appendRow(sheet, table.headers);
  styleHeader(sheet);
  for (const row of table.rows) appendRow(sheet, row);
  autoSizeColumns(sheet);
  return sheet;
}
