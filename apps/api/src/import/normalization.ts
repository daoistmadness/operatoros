export type CellValue = unknown;

export function normalizeHeader(value: CellValue): string {
  return value == null ? "" : String(value).trim();
}

function utcDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function excelSerialDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const value = new Date(epoch + Math.floor(serial) * 86400000);
  return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

export function parseExcelDate(value: CellValue, date1904 = false): string | null {
  if (value instanceof Date) return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === "number") return excelSerialDate(value, date1904);
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? utcDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function clockParts(value: string): [number, number] | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (!match || Number(match[1]) > 23) return null;
  return [Number(match[1]), Number(match[2])];
}

export function clockText(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseExcelTime(value: CellValue): string | null {
  if (value instanceof Date) return clockText(value.getUTCHours(), value.getUTCMinutes());
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
    const total = Math.floor(value * 1440 + 1e-9);
    return clockText(Math.floor(total / 60), total % 60);
  }
  if (typeof value !== "string") return null;
  const parts = clockParts(value);
  return parts ? clockText(parts[0], parts[1]) : null;
}

export function parseDuration(value: CellValue): number | null {
  if (value instanceof Date) return (value.getUTCHours() * 60 + value.getUTCMinutes()) * 60;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 60 : null;
}

export function parseOptionalString(value: CellValue): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function parseInteger(value: CellValue): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function normalizeStudentId(value: CellValue): string | null {
  const parsed = parseInteger(value);
  return parsed === null ? null : String(parsed);
}

export function isBlank(value: CellValue): boolean {
  return value == null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
}

export function isAbsentFlagTrue(value: CellValue): boolean {
  if (typeof value === "boolean") return value;
  return value != null && new Set(["true", "1", "yes", "y"]).has(String(value).trim().toLowerCase());
}

export function secondsToTimeText(seconds: number | null): string | null {
  if (seconds == null) return null;
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function parseStoredDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
