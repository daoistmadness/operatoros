import {
  getCellValue,
  loadXlsxWorkbook,
  readLegacyXlsRows,
  isAbsentFlagTrue,
  isBlank,
  normalizeHeader,
  normalizeStudentId,
  parseDuration,
  parseExcelDate,
  parseExcelTime,
  parseInteger,
  parseOptionalString,
  type CellValue,
  type ExcelWorksheet,
} from "@operatoros/excel";

export const REQUIRED_COLUMNS = [
  "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
  "Terlambat", "Lembur", "Pengecualian", "week",
] as const;

export type AttendanceSourceRow = {
  excelRow: number;
  studentId: number;
  studentIdentifier: string;
  studentName: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  lateRaw: CellValue;
  lateSeconds: number | null;
  overtimeSeconds: number | null;
  exception: string | null;
  week: string | null;
};

export type InvalidSourceRow = {
  excelRow: number;
  noId: string | null;
  name: string | null;
  date: string | null;
  reason: string;
};

export type WorkbookRows = {
  rows: AttendanceSourceRow[];
  invalidRows: InvalidSourceRow[];
  exactDuplicates: Set<string>;
  divergentDuplicates: Set<string>;
  totalRows: number;
};

type RawRow = { excelRow: number; values: Map<string, CellValue> };

function key(studentId: number, date: string): string {
  return `${studentId}\u0000${date}`;
}

function comparable(value: CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function sourceKey(row: RawRow): string | null {
  const studentId = parseInteger(row.values.get("No. ID"));
  const date = parseExcelDate(row.values.get("Tanggal"));
  return studentId !== null && date ? key(studentId, date) : null;
}

function buildDuplicateSets(rawRows: RawRow[]): { exact: Set<string>; divergent: Set<string> } {
  const groups = new Map<string, string[]>();
  for (const raw of rawRows) {
    const rowKey = sourceKey(raw);
    if (!rowKey) continue;
    const comparableRow = REQUIRED_COLUMNS.map((column) => comparable(raw.values.get(column))).join("\u0001");
    groups.set(rowKey, [...(groups.get(rowKey) ?? []), comparableRow]);
  }
  const exact = new Set<string>();
  const divergent = new Set<string>();
  for (const [rowKey, values] of groups) {
    if (values.length > 1) (new Set(values).size === 1 ? exact : divergent).add(rowKey);
  }
  return { exact, divergent };
}

function readRawRows(sheet: ExcelWorksheet, headers: string[]): RawRow[] {
  const rows: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const values = new Map(headers.map((header, index) => [header, getCellValue(row.getCell(index + 1))]));
    if ([...values.values()].every(isBlank)) continue;
    rows.push({ excelRow: rowNumber, values });
  }
  return rows;
}

function readLegacyRawRows(buffer: ArrayBuffer): { rows: RawRow[]; headers: string[]; date1904: boolean } {
  const legacy = readLegacyXlsRows(buffer);
  const rows = legacy.rows.map((values, index) => ({
    excelRow: index + 2,
    values: new Map(legacy.headers.map((header, column) => [header, values[column] ?? null])),
  })).filter((row) => [...row.values.values()].some((value) => !isBlank(value)));
  return { rows, headers: legacy.headers, date1904: legacy.date1904 };
}

export async function readAttendanceWorkbook(buffer: ArrayBuffer, filename: string): Promise<WorkbookRows> {
  const isLegacyXls = filename.toLowerCase().endsWith(".xls");
  if (!isLegacyXls && !filename.toLowerCase().endsWith(".xlsx")) throw new Error("ATTENDANCE_SOURCE_MUST_BE_EXCEL");
  let rawRows: RawRow[];
  let headers: string[];
  let date1904 = false;
  if (isLegacyXls) {
    const legacy = readLegacyRawRows(buffer);
    rawRows = legacy.rows;
    headers = legacy.headers;
    date1904 = legacy.date1904;
  } else {
    const workbook = await loadXlsxWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Attendance workbook has no worksheet");
    const headerValues = sheet.getRow(1).values as CellValue[];
    headers = headerValues.slice(1).map(normalizeHeader);
    rawRows = readRawRows(sheet, headers);
    date1904 = Boolean(workbook.properties.date1904);
  }
  const missing = REQUIRED_COLUMNS.find((column) => !headers.includes(column));
  if (missing) throw new Error(`Missing required column: ${missing}`);
  const duplicates = buildDuplicateSets(rawRows);
  const rows: AttendanceSourceRow[] = [];
  const invalidRows: InvalidSourceRow[] = [];
  const seen = new Map<string, AttendanceSourceRow>();

  for (const raw of rawRows) {
    const idValue = raw.values.get("No. ID");
    const nameValue = raw.values.get("Nama");
    const dateValue = raw.values.get("Tanggal");
    const studentId = parseInteger(idValue);
    const studentIdentifier = normalizeStudentId(idValue);
    const studentName = parseOptionalString(nameValue);
    const date = parseExcelDate(dateValue, date1904);
    if (studentId === null || !studentName || !date) {
      invalidRows.push({
        excelRow: raw.excelRow,
        noId: studentIdentifier ?? (isBlank(idValue) ? null : String(idValue)),
        name: studentName,
        date,
        reason: "Missing or invalid No. ID, Nama, or Tanggal",
      });
      continue;
    }

    const checkIn = parseExcelTime(raw.values.get("Scan Masuk"));
    const checkOut = parseExcelTime(raw.values.get("Scan Pulang"));
    const exception = parseOptionalString(raw.values.get("Pengecualian"));
    const absent = isAbsentFlagTrue(raw.values.get("Absent"));
    if (!checkIn && !checkOut && !absent && !exception) continue;

    const entry: AttendanceSourceRow = {
      excelRow: raw.excelRow,
      studentId,
      studentIdentifier: studentIdentifier ?? String(studentId),
      studentName,
      date,
      checkIn,
      checkOut,
      lateRaw: raw.values.get("Terlambat"),
      lateSeconds: raw.values.get("Terlambat") instanceof Date ? parseDuration(raw.values.get("Terlambat")) : null,
      overtimeSeconds: parseDuration(raw.values.get("Lembur")),
      exception,
      week: parseOptionalString(raw.values.get("week")),
    };
    const rowKey = key(studentId, date);
    const previous = seen.get(rowKey);
    if (!previous || Number(Boolean(checkIn)) + Number(Boolean(checkOut)) > Number(Boolean(previous.checkIn)) + Number(Boolean(previous.checkOut))) seen.set(rowKey, entry);
  }
  rows.push(...seen.values());
  return { rows, invalidRows, exactDuplicates: duplicates.exact, divergentDuplicates: duplicates.divergent, totalRows: rawRows.length };
}
