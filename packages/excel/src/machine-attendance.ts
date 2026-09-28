import { getCellValue, loadXlsxWorkbook } from "./workbook";
import { isBlank, normalizeHeader, parseDuration, parseExcelDate, parseExcelTime, parseOptionalString, type CellValue } from "./normalization";

export const MACHINE_ATTENDANCE_HEADERS = [
  "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat",
  "Absent", "Lembur", "Pengecualian", "week",
] as const;

export const MACHINE_ATTENDANCE_PROFILE = "ATTENDANCE_MACHINE_TABULAR_V1" as const;
export type MachineEvidenceState = "SCAN_PRESENT" | "NO_SCAN" | "MULTIPLE_SCANS" | "INVALID_SCAN_VALUE" | "UNSUPPORTED_SOURCE_STATUS";
export type MachineFieldState = "VALID" | "BLANK" | "INVALID";
type MachineField = { state: MachineFieldState; value: unknown };
type MachineSourceFields = {
  scanIn: MachineField;
  scanOut: MachineField;
  sourceLate: MachineField;
  absent: MachineField;
  overtime: MachineField;
  exception: MachineField;
};
export type MachineSourceEvidence = {
  sourceRow: number;
  values: Record<string, unknown>;
  fields: MachineSourceFields;
};

export type MachineAttendanceRow = {
  sourceRows: number[];
  sourceEvidence: MachineSourceEvidence[];
  machineStudentIdentifier: string | null;
  sourceStudentName: string | null;
  sourceIdentityConflict: boolean;
  date: string | null;
  checkIn: string | null;
  checkOut: string | null;
  sourceLateMinutes: number | null;
  scanTimes: string[];
  qualityWarnings: string[];
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

function rawValue(value: unknown): unknown {
  if (value instanceof Date) return { type: "date", value: value.toISOString() };
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}

function field(value: CellValue, parse: (value: CellValue) => unknown): { state: MachineFieldState; value: unknown } {
  if (isBlank(value)) return { state: "BLANK", value: null };
  const normalized = parse(value);
  return normalized == null ? { state: "INVALID", value: null } : { state: "VALID", value: normalized };
}

function absentValue(value: CellValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return null;
}

function sourceEvidence(rowNumber: number, headers: string[], positions: Map<string, number>, get: (column: number) => CellValue): MachineSourceEvidence {
  const values = Object.fromEntries(headers.map((header, index) => [header, rawValue(get(positions.get(header) ?? index + 1))]));
  const read = (header: string) => get(positions.get(header) ?? 0);
  return {
    sourceRow: rowNumber,
    values,
    fields: {
      scanIn: field(read("Scan Masuk"), parseExcelTime),
      scanOut: field(read("Scan Pulang"), parseExcelTime),
      sourceLate: field(read("Terlambat"), (value) => parseDuration(value)),
      absent: field(read("Absent"), absentValue),
      overtime: field(read("Lembur"), (value) => parseDuration(value)),
      exception: field(read("Pengecualian"), (value) => parseOptionalString(value)),
    },
  };
}

function key(identifier: string, date: string): string { return `${identifier}\u0000${date}`; }

function mergeRows(current: MachineAttendanceRow | undefined, next: MachineAttendanceRow): MachineAttendanceRow {
  const sourceEvidence = [...(current?.sourceEvidence ?? []), ...next.sourceEvidence];
  const names = new Set(sourceEvidence.map((value) => text(value.values["Nama"])).filter((value): value is string => value !== null));
  const arrivals = sourceEvidence.map((value) => value.fields.scanIn.value).filter((value): value is string => typeof value === "string").sort();
  const departures = sourceEvidence.map((value) => value.fields.scanOut.value).filter((value): value is string => typeof value === "string").sort();
  const sourceLate = sourceEvidence.map((value) => value.fields.sourceLate.value).find((value): value is number => typeof value === "number");
  const warnings = new Set([...(current?.qualityWarnings ?? []), ...next.qualityWarnings]);
  if (sourceEvidence.length > 1) warnings.add("DUPLICATE_SOURCE_ROWS_MERGED");
  if (names.size > 1) warnings.add("SOURCE_IDENTITY_CONFLICT");
  if (sourceEvidence.some((value) => value.fields.scanIn.state === "INVALID")) warnings.add("INVALID_SCAN_IN");
  if (sourceEvidence.some((value) => value.fields.scanOut.state === "INVALID")) warnings.add("INVALID_SCAN_OUT");
  if (sourceEvidence.some((value) => value.fields.sourceLate.state === "INVALID")) warnings.add("INVALID_SOURCE_LATENESS");
  if (sourceEvidence.some((value) => value.fields.absent.state === "INVALID")) warnings.add("INVALID_ABSENT_FIELD");
  if (sourceEvidence.some((value) => value.fields.overtime.state === "INVALID")) warnings.add("INVALID_OVERTIME");
  const checkIn = arrivals[0] ?? null;
  const checkOut = departures.at(-1) ?? null;
  const machineEvidence: MachineEvidenceState = sourceEvidence.length > 1 && arrivals.length ? "MULTIPLE_SCANS" : checkIn ? "SCAN_PRESENT" : sourceEvidence.some((value) => value.fields.scanIn.state === "INVALID") ? "INVALID_SCAN_VALUE" : "NO_SCAN";
  return {
    sourceRows: sourceEvidence.map((value) => value.sourceRow),
    sourceEvidence,
    machineStudentIdentifier: next.machineStudentIdentifier,
    sourceStudentName: names.values().next().value ?? null,
    sourceIdentityConflict: names.size > 1,
    date: next.date,
    checkIn,
    checkOut,
    sourceLateMinutes: typeof sourceLate === "number" ? Math.floor(sourceLate / 60) : null,
    scanTimes: [...new Set([...arrivals, ...departures])].sort(),
    qualityWarnings: [...warnings],
    machineEvidence,
    invalidReason: !next.machineStudentIdentifier ? "The machine identifier is missing or invalid." : !next.date ? "The attendance date is missing or invalid." : null,
  };
}

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
  const standalone: MachineAttendanceRow[] = [];
  let sourceRows = 0;
  const dates = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const get = (column: number) => getCellValue(row.getCell(column));
    if (headers.every((_, index) => isBlank(get(index + 1)))) continue;
    sourceRows++;
    const identifier = normalizeMachineIdentifier(get(positions.get("No. ID")!));
    const date = parseExcelDate(get(positions.get("Tanggal")!), Boolean(workbook.properties.date1904));
    if (date) dates.add(date);
    const evidence = sourceEvidence(rowNumber, headers, positions, get);
    const base: MachineAttendanceRow = {
      sourceRows: [rowNumber], sourceEvidence: [evidence], machineStudentIdentifier: identifier,
      sourceStudentName: text(get(positions.get("Nama")!)), sourceIdentityConflict: false, date,
      checkIn: typeof evidence.fields.scanIn.value === "string" ? evidence.fields.scanIn.value : null,
      checkOut: typeof evidence.fields.scanOut.value === "string" ? evidence.fields.scanOut.value : null,
      sourceLateMinutes: typeof evidence.fields.sourceLate.value === "number" ? Math.floor(Number(evidence.fields.sourceLate.value) / 60) : null,
      scanTimes: [evidence.fields.scanIn.value, evidence.fields.scanOut.value].filter((value): value is string => typeof value === "string").sort(),
      qualityWarnings: [],
      machineEvidence: evidence.fields.scanIn.state === "VALID" ? "SCAN_PRESENT" : evidence.fields.scanIn.state === "INVALID" ? "INVALID_SCAN_VALUE" : "NO_SCAN",
      invalidReason: !identifier ? "The machine identifier is missing or invalid." : !date ? "The attendance date is missing or invalid." : null,
    };
    const invalidField = Object.entries(evidence.fields).filter(([, value]) => value.state === "INVALID").map(([name]) => name);
    base.qualityWarnings.push(...invalidField.map((name) => `INVALID_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`));
    if (!identifier || !date) { standalone.push(base); continue; }
    const groupKey = key(identifier, date);
    groups.set(groupKey, mergeRows(groups.get(groupKey), base));
  }
  const rows = [...groups.values(), ...standalone].sort((left, right) => (left.date ?? "9999-99-99").localeCompare(right.date ?? "9999-99-99") || (left.machineStudentIdentifier ?? "").localeCompare(right.machineStudentIdentifier ?? "") || left.sourceRows[0]! - right.sourceRows[0]!);
  const duplicateRows = rows.filter((row) => row.sourceRows.length > 1).reduce((total, row) => total + row.sourceRows.length - 1, 0);
  const sortedDates = [...dates].sort();
  return {
    detectedProfile: MACHINE_ATTENDANCE_PROFILE,
    sheet: sheet.name,
    dimensions: String(sheet.dimensions),
    sourceRows,
    dateCoverage: { from: sortedDates[0] ?? null, to: sortedDates[sortedDates.length - 1] ?? null, distinctDates: dates.size },
    warnings: [duplicateRows ? `${duplicateRows} duplicate source row(s) were merged and retained individually.` : null, rows.some((row) => row.qualityWarnings.length) ? "Some field values need review; valid Scan Masuk evidence remains available." : null].filter((value): value is string => value !== null),
    rows,
  };
}
