import type ExcelJS from "exceljs";

const INVALID_SHEET_CHARACTERS = /[\\/*?:\[\]]/g;
const FORMULA_PREFIX = /^[=+\-@]/;

export function safeWorksheetName(value: string, existingNames: readonly string[] = []): string {
  const base = value.trim().replace(INVALID_SHEET_CHARACTERS, "-").slice(0, 31) || "Sheet";
  const used = new Set(existingNames.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base.slice(0, 31 - String(suffix).length - 3)} (${suffix})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("EXCEL_SHEET_NAME_COLLISION");
}

export function addWorksheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  return workbook.addWorksheet(safeWorksheetName(name, workbook.worksheets.map((sheet) => sheet.name)));
}

export function safeCellValue(value: unknown): unknown {
  return typeof value === "string" && FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function appendRow(sheet: ExcelJS.Worksheet, values: readonly unknown[]): ExcelJS.Row {
  return sheet.addRow(values.map(safeCellValue));
}

export function appendRows(sheet: ExcelJS.Worksheet, rows: readonly (readonly unknown[])[]): void {
  for (const row of rows) appendRow(sheet, row);
}

export function styleHeader(sheet: ExcelJS.Worksheet, rowNumber = 1): void {
  const row = sheet.getRow(rowNumber);
  row.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: rowNumber }];
}

export function autoSizeColumns(sheet: ExcelJS.Worksheet, min = 12, max = 60): void {
  for (const column of sheet.columns) {
    const lengths = (column.values ?? []).map((value) => String(value ?? "").length + 2);
    column.width = Math.min(max, Math.max(min, ...lengths));
  }
}

export function safeExportFilename(value: string, extension = "xlsx"): string {
  const base = value.trim().replaceAll("\\", "/").split("/").at(-1) ?? "export";
  const sanitized = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${sanitized}.${extension.replace(/^\./, "")}`;
}
