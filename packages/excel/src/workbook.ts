import ExcelJS from "exceljs";
import type { ExcelWorksheetDto } from "@operatoros/contracts/excel";
import { addWorksheet, appendRow, styleHeader, autoSizeColumns } from "./sheets";

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const EXCEL_EXPORT_FORMAT_VERSION = "operatoros-excel-v1";

export type ExcelWorkbook = ExcelJS.Workbook;
export type ExcelWorksheet = ExcelJS.Worksheet;
export type ExcelCell = ExcelJS.Cell;

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
  await workbook.xlsx.load(buffer);
  return workbook;
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
