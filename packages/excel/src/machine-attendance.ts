import { getCellValue, loadXlsxWorkbook } from "./workbook";
import { isBlank, normalizeHeader, parseExcelDate, parseExcelTime, type CellValue } from "./normalization";

export const MACHINE_ATTENDANCE_HEADERS = [
  "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat",
  "Absent", "Lembur", "Pengecualian", "week",
] as const;

export const MACHINE_ATTENDANCE_PROFILE = "ATTENDANCE_MACHINE_TABULAR_V1" as const;
export type MachineEvidenceState = "SCAN_PRESENT" | "NO_SCAN" | "MULTIPLE_SCANS" | "INVALID_SCAN_VALUE";

export type MachineAttendanceRow = {
  sourceRows: number[];
  machineStudentIdentifier: string | null;
  sourceStudentName: string | null;
  date: string | null;
  scanTimes: string[];
  machineEvidence: MachineEvidenceState;
  invalidReason: string | null;
};

export type MachineWorkbookPreview = {
  detectedProfile: typeof MACHINE_ATTENDANCE_PROFILE;
  sheet: string;
  dimensions: string;
  sourceRows: number;
  dateCoverage: { from: string | null; to: string | null; distinctDates: number };
  warnings: string[];
  rows: MachineAttendanceRow[];
};

export class MachineWorkbookError extends Error {
  constructor(readonly code: "UNSUPPORTED_FORMAT" | "MALFORMED_WORKBOOK" | "UNSUPPORTED_STRUCTURE" | "FILE_TOO_LARGE", message: string) {
    super(message);
  }
}

function text(value: CellValue): string | null {
  if (isBlank(value)) return null;
  const result = String(value).trim();
  return result || null;
}

export function normalizeMachineIdentifier(value: CellValue): string | null {
  if (isBlank(value)) return null;
  if (typeof value === "string") return /^\d+$/.test(value.trim()) ? value.trim() : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

export function isXlsxZipSignature(value: ArrayBuffer | Uint8Array): boolean {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function evidence(scanTimes: string[], invalid: boolean, sourceRowCount: number): MachineEvidenceState {
  if (invalid) return "INVALID_SCAN_VALUE";
  if (sourceRowCount > 1) return "MULTIPLE_SCANS";
  return scanTimes.length ? "SCAN_PRESENT" : "NO_SCAN";
}

function rowKey(identifier: string, date: string): string { return `${identifier}\u0000${date}`; }

export async function parseMachineAttendanceWorkbook(buffer: ArrayBuffer | Uint8Array): Promise<MachineWorkbookPreview> {
  if (!isXlsxZipSignature(buffer)) throw new MachineWorkbookError("UNSUPPORTED_FORMAT", "Only Excel OOXML .xlsx workbooks are supported.");
  let workbook;
  try { workbook = await loadXlsxWorkbook(buffer); } catch { throw new MachineWorkbookError("MALFORMED_WORKBOOK", "The uploaded workbook could not be read safely."); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new MachineWorkbookError("UNSUPPORTED_STRUCTURE", "The workbook has no worksheet.");
  const headers = (sheet.getRow(1).values as CellValue[]).slice(1).map(normalizeHeader);
  const missing = MACHINE_ATTENDANCE_HEADERS.find((header) => !headers.includes(header));
  if (missing) throw new MachineWorkbookError("UNSUPPORTED_STRUCTURE", `The workbook is missing the required attendance column: ${missing}.`);
  const positions = new Map(headers.map((header, index) => [header, index + 1]));
  const groups = new Map<string, MachineAttendanceRow>();
  const invalidRows: MachineAttendanceRow[] = [];
  let sourceRows = 0;
  const dates = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const values = new Map(MACHINE_ATTENDANCE_HEADERS.map((header) => [header, getCellValue(row.getCell(positions.get(header) ?? 0))]));
    if ([...values.values()].every(isBlank)) continue;
    sourceRows++;
    const identifierValue = values.get("No. ID");
    const identifier = normalizeMachineIdentifier(identifierValue);
    const date = parseExcelDate(values.get("Tanggal"), Boolean(workbook.properties.date1904));
    const sourceName = text(values.get("Nama"));
    const scanInValue = values.get("Scan Masuk");
    const scanOutValue = values.get("Scan Pulang");
    const scanIn = isBlank(scanInValue) ? null : parseExcelTime(scanInValue);
    const scanOut = isBlank(scanOutValue) ? null : parseExcelTime(scanOutValue);
    const invalidScan = (!isBlank(scanInValue) && scanIn === null) || (!isBlank(scanOutValue) && scanOut === null);
    if (!identifier || !date) {
      invalidRows.push({ sourceRows: [rowNumber], machineStudentIdentifier: identifier, sourceStudentName: sourceName, date, scanTimes: [scanIn, scanOut].filter((value): value is string => value !== null), machineEvidence: invalidScan ? "INVALID_SCAN_VALUE" : "NO_SCAN", invalidReason: !identifier ? "The machine identifier is missing or invalid." : "The attendance date is missing or invalid." });
      continue;
    }
    dates.add(date);
    const key = rowKey(identifier, date);
    const current = groups.get(key);
    const scanTimes = [...new Set([...(current?.scanTimes ?? []), scanIn, scanOut].filter((value): value is string => value !== null))].sort();
    const merged: MachineAttendanceRow = {
      sourceRows: [...(current?.sourceRows ?? []), rowNumber],
      machineStudentIdentifier: identifier,
      sourceStudentName: current?.sourceStudentName ?? sourceName,
      date,
      scanTimes,
      machineEvidence: evidence(scanTimes, invalidScan || current?.machineEvidence === "INVALID_SCAN_VALUE", (current?.sourceRows.length ?? 0) + 1),
      invalidReason: invalidScan || current?.invalidReason === "The scan time is invalid." ? "The scan time is invalid." : null,
    };
    groups.set(key, merged);
  }
  const rows = [...groups.values(), ...invalidRows].sort((left, right) => (left.date ?? "9999-99-99").localeCompare(right.date ?? "9999-99-99") || (left.machineStudentIdentifier ?? "").localeCompare(right.machineStudentIdentifier ?? ""));
  const duplicateRows = rows.filter((row) => row.sourceRows.length > 1).reduce((total, row) => total + row.sourceRows.length - 1, 0);
  const sortedDates = [...dates].sort();
  return {
    detectedProfile: MACHINE_ATTENDANCE_PROFILE,
    sheet: sheet.name,
    dimensions: String(sheet.dimensions),
    sourceRows,
    dateCoverage: { from: sortedDates[0] ?? null, to: sortedDates[sortedDates.length - 1] ?? null, distinctDates: dates.size },
    warnings: [duplicateRows ? `${duplicateRows} duplicate source row(s) were collapsed by exact machine identifier and date.` : null, rows.some((row) => row.machineEvidence === "INVALID_SCAN_VALUE") ? "Some scan values could not be parsed and remain explicit invalid evidence." : null].filter((value): value is string => value !== null),
    rows,
  };
}
