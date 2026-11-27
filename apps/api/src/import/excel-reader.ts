import {
  EXCEL_RESOURCE_LIMITS,
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
import { acquireExcelPermit, withExcelAdmission } from "./excel-admission";
import { runAttendanceSubprocess } from "./excel-subprocess";

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

type ParserWorkerRequest = { id: number; buffer: ArrayBuffer; filename: string };
type ParserWorkerResponse =
  | { id: number; workbook: WorkbookRows }
  | { id: number; errorName: string; errorMessage: string };
const ATTENDANCE_COLUMNS = [...REQUIRED_COLUMNS, "Absent"] as const;
const COL_NO_ID = 0;
const COL_NAMA = 1;
const COL_TANGGAL = 2;
const COL_SCAN_MASUK = 3;
const COL_SCAN_PULANG = 4;
const COL_TERLAMBAT = 5;
const COL_LEMBUR = 6;
const COL_PENGECUALIAN = 7;
const COL_WEEK = 8;
const COL_ABSENT = 9;

type IndexedAttendanceRow = {
  excelRow: number;
  cells: CellValue[];
};

type DuplicateGroupState = {
  firstFields: string[];
  count: number;
  divergent: boolean;
};

function key(studentId: number, date: string): string {
  return `${studentId}\u0000${date}`;
}

function comparable(value: CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compileColumnIndices(headers: string[]): number[] {
  const headerIndex = new Map<string, number>();
  for (let i = 0; i < headers.length; i += 1) {
    headerIndex.set(headers[i]!, i);
  }
  return ATTENDANCE_COLUMNS.map((column) => headerIndex.get(column) ?? -1);
}

function readRawRows(sheet: ExcelWorksheet, headerCount: number, columnIndices: number[]): IndexedAttendanceRow[] {
  const colToSlots = new Map<number, number[]>();
  for (let slot = 0; slot < columnIndices.length; slot += 1) {
    const colIndex = columnIndices[slot]!;
    if (colIndex < 0) continue;
    const list = colToSlots.get(colIndex + 1);
    if (list) list.push(slot);
    else colToSlots.set(colIndex + 1, [slot]);
  }

  const rows: IndexedAttendanceRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 1) return;
    const cells = new Array<CellValue>(ATTENDANCE_COLUMNS.length).fill(null);
    let hasNonBlank = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = getCellValue(cell);
      if (colNumber <= headerCount && !isBlank(value)) {
        hasNonBlank = true;
      }
      const slots = colToSlots.get(colNumber);
      if (slots) {
        for (const slot of slots) cells[slot] = value;
      }
    });
    if (hasNonBlank) {
      rows.push({ excelRow: rowNumber, cells });
    }
  });
  return rows;
}

function readLegacyRawRows(buffer: ArrayBuffer): {
  rows: IndexedAttendanceRow[];
  headers: string[];
  columnIndices: number[];
  date1904: boolean;
} {
  const legacy = readLegacyXlsRows(buffer);
  const columnIndices = compileColumnIndices(legacy.headers);
  const rows: IndexedAttendanceRow[] = [];
  for (let index = 0; index < legacy.rows.length; index += 1) {
    const source = legacy.rows[index]!;
    let hasNonBlank = false;
    for (let col = 0; col < legacy.headers.length; col += 1) {
      if (!isBlank(source[col])) {
        hasNonBlank = true;
        break;
      }
    }
    if (!hasNonBlank) continue;
    const cells = new Array<CellValue>(ATTENDANCE_COLUMNS.length);
    for (let slot = 0; slot < columnIndices.length; slot += 1) {
      const colIndex = columnIndices[slot]!;
      cells[slot] = colIndex >= 0 ? (source[colIndex] ?? null) : null;
    }
    rows.push({
      excelRow: legacy.rowNumbers[index] ?? index + 2,
      cells,
    });
  }
  return { rows, headers: legacy.headers, columnIndices, date1904: legacy.date1904 };
}

export async function parseAttendanceWorkbook(buffer: ArrayBuffer, filename: string): Promise<WorkbookRows> {
  const isLegacyXls = filename.toLowerCase().endsWith(".xls");
  if (!isLegacyXls && !filename.toLowerCase().endsWith(".xlsx")) throw new Error("ATTENDANCE_SOURCE_MUST_BE_EXCEL");
  let rawRows: IndexedAttendanceRow[];
  let headers: string[];
  let columnIndices: number[];
  let date1904 = false;
  if (isLegacyXls) {
    const legacy = readLegacyRawRows(buffer);
    rawRows = legacy.rows;
    headers = legacy.headers;
    columnIndices = legacy.columnIndices;
    date1904 = legacy.date1904;
  } else {
    const workbook = await loadXlsxWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Attendance workbook has no worksheet");
    const headerValues = sheet.getRow(1).values as CellValue[];
    headers = headerValues.slice(1).map(normalizeHeader);
    columnIndices = compileColumnIndices(headers);
    rawRows = readRawRows(sheet, headers.length, columnIndices);
    date1904 = Boolean(workbook.properties.date1904);
  }
  const missingIndex = columnIndices.slice(0, REQUIRED_COLUMNS.length).findIndex((idx) => idx < 0);
  if (missingIndex >= 0) throw new Error(`Missing required column: ${REQUIRED_COLUMNS[missingIndex]}`);

  const duplicateGroups = new Map<string, DuplicateGroupState>();
  const rows: AttendanceSourceRow[] = [];
  const invalidRows: InvalidSourceRow[] = [];
  const seen = new Map<string, AttendanceSourceRow>();

  for (const raw of rawRows) {
    const cells = raw.cells;
    const idValue = cells[COL_NO_ID];
    const nameValue = cells[COL_NAMA];
    const dateValue = cells[COL_TANGGAL];
    const studentId = parseInteger(idValue);
    const studentIdentifier = normalizeStudentId(idValue);
    const studentName = parseOptionalString(nameValue);
    const date = parseExcelDate(dateValue, date1904);

    if (studentId !== null && date) {
      const rowKey = key(studentId, date);
      const group = duplicateGroups.get(rowKey);
      if (!group) {
        const firstFields = new Array<string>(REQUIRED_COLUMNS.length);
        for (let i = 0; i < REQUIRED_COLUMNS.length; i += 1) {
          firstFields[i] = comparable(cells[i]);
        }
        duplicateGroups.set(rowKey, { firstFields, count: 1, divergent: false });
      } else {
        group.count += 1;
        if (!group.divergent) {
          for (let i = 0; i < REQUIRED_COLUMNS.length; i += 1) {
            if (comparable(cells[i]) !== group.firstFields[i]) {
              group.divergent = true;
              break;
            }
          }
        }
      }
    }

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

    const checkIn = parseExcelTime(cells[COL_SCAN_MASUK]);
    const checkOut = parseExcelTime(cells[COL_SCAN_PULANG]);
    const exception = parseOptionalString(cells[COL_PENGECUALIAN]);
    const absent = isAbsentFlagTrue(cells[COL_ABSENT]);
    if (!checkIn && !checkOut && !absent && !exception) continue;

    const lateRaw = cells[COL_TERLAMBAT];
    const entry: AttendanceSourceRow = {
      excelRow: raw.excelRow,
      studentId,
      studentIdentifier: studentIdentifier ?? String(studentId),
      studentName,
      date,
      checkIn,
      checkOut,
      lateRaw,
      lateSeconds: lateRaw instanceof Date ? parseDuration(lateRaw) : null,
      overtimeSeconds: parseDuration(cells[COL_LEMBUR]),
      exception,
      week: parseOptionalString(cells[COL_WEEK]),
    };
    const rowKey = key(studentId, date);
    const previous = seen.get(rowKey);
    if (!previous || Number(Boolean(checkIn)) + Number(Boolean(checkOut)) > Number(Boolean(previous.checkIn)) + Number(Boolean(previous.checkOut))) seen.set(rowKey, entry);
  }

  const exactDuplicates = new Set<string>();
  const divergentDuplicates = new Set<string>();
  for (const [rowKey, group] of duplicateGroups) {
    if (group.count > 1) {
      (group.divergent ? divergentDuplicates : exactDuplicates).add(rowKey);
    }
  }
  rows.push(...seen.values());
  return { rows, invalidRows, exactDuplicates, divergentDuplicates, totalRows: rawRows.length };
}

// shortcut: 64 KiB separates measured 100-row and 5,000-row files; revisit with new import-size benchmarks.
const WORKER_PARSE_THRESHOLD = 64 * 1024;
const PARSER_WORKER_TIMEOUT_MS = 30_000;

export function readAttendanceWorkbook(buffer: ArrayBuffer, filename: string, signal?: AbortSignal): Promise<WorkbookRows> {
  const bytes = buffer.byteLength;
  if (bytes === 0 || bytes > EXCEL_RESOURCE_LIMITS.maxFileBytes) {
    return Promise.reject(new Error("EXCEL_FILE_SIZE_OUT_OF_BOUNDS"));
  }
  if (bytes < WORKER_PARSE_THRESHOLD) {
    return withExcelAdmission(bytes, () => parseAttendanceWorkbook(buffer, filename), signal);
  }

  return runAttendanceSubprocess(buffer, filename, { signal });
}

type AttendanceWorker = Pick<Worker, "addEventListener" | "postMessage" | "terminate">;

export async function readAttendanceInWorker(
  buffer: ArrayBuffer,
  filename: string,
  createWorker: () => AttendanceWorker,
  timeoutMs = PARSER_WORKER_TIMEOUT_MS,
): Promise<WorkbookRows> {
  const release = await acquireExcelPermit(buffer.byteLength);
  let worker: AttendanceWorker;
  try {
    worker = createWorker();
  } catch (error) {
    release();
    throw error;
  }

  // Admission allows one request per worker. Only its terminal reply proves
  // parsing has settled. Bun close can fire before the worker fully exits.
  const id = 0;
  return new Promise((resolve, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timeout);
      worker.terminate();
    };
    const fail = (error: Error) => {
      reject(error);
      stop();
    };
    const timeout = setTimeout(() => fail(new Error("ATTENDANCE_WORKBOOK_PARSE_TIMEOUT")), timeoutMs);
    worker.addEventListener("message", ({ data }: MessageEvent<ParserWorkerResponse>) => {
      if (data?.id !== id) return;
      if ("workbook" in data && data.workbook) {
        resolve(data.workbook);
      } else if ("errorName" in data && typeof data.errorName === "string" && typeof data.errorMessage === "string") {
        const error = new Error(data.errorMessage);
        error.name = data.errorName;
        reject(error);
      } else {
        fail(new Error("Attendance workbook parser worker returned an unreadable result"));
        return;
      }
      stop();
      release();
    });
    worker.addEventListener("error", (event) => fail(new Error(event.message || "Attendance workbook parser worker failed")));
    worker.addEventListener("messageerror", () => fail(new Error("Attendance workbook parser worker returned an unreadable result")));
    worker.addEventListener("close", () => fail(new Error("Attendance workbook parser worker stopped without a result")));
    try {
      worker.postMessage({ id, buffer, filename } satisfies ParserWorkerRequest, [buffer]);
    } catch (error) {
      // A failed synchronous transfer never dispatches the parser.
      release();
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
