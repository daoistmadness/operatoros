import ExcelJS from "exceljs";
import type { ExcelWorksheetDto } from "@operatoros/contracts/excel";
import { addWorksheet, appendRow, styleHeader, autoSizeColumns } from "./sheets";
import { normalizeHeader } from "./normalization";

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

export async function loadXlsxWorkbook(value: ArrayBuffer | Uint8Array): Promise<ExcelWorkbook> {
  const workbook = createWorkbook();
  const buffer = toBuffer(value) as unknown as Parameters<ExcelWorkbook["xlsx"]["load"]>[0];
  try {
    await workbook.xlsx.load(buffer);
  } catch (cause) {
    throw new ExcelWorkbookParseError(cause);
  }
  if (!workbook || !Array.isArray(workbook.worksheets)) throw new ExcelWorkbookParseError();
  return workbook;
}

export async function readXlsxWorkbook(value: ArrayBuffer | Uint8Array): Promise<ParsedExcelWorkbook> {
  const workbook = await loadXlsxWorkbook(value);
  const sheets = workbook.worksheets.map((sheet) => {
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => normalizeHeader(getCellValue(sheet.getRow(1).getCell(index + 1))));
    const rows = Array.from({ length: Math.max(0, sheet.rowCount - 1) }, (_, index) => {
      const rowNumber = index + 2;
      const row = sheet.getRow(rowNumber);
      return {
        rowNumber,
        values: Array.from({ length: sheet.columnCount }, (_, column) => getCellValue(row.getCell(column + 1))),
      };
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
