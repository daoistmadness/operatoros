export type LateSource = "excel" | "calculated" | "none";

export function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour <= 23 ? hour * 60 + Number(match[2]) : null;
}

export function parseExcelDurationMinutes(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.trim().match(/^(\d+):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function deriveAttendanceStatus(checkIn: string | null, checkOut: string | null, lateMinutes: number | null): "on-time" | "late" | "incomplete" | "absent" {
  if (checkIn && checkOut) return (lateMinutes ?? 0) > 0 ? "late" : "on-time";
  if (Boolean(checkIn) !== Boolean(checkOut)) return "incomplete";
  return "absent";
}

export function calculateLateMinutes(checkIn: string | null, terlambat: unknown, jenjang: string | null, cutoffs: Record<string, string | undefined>): [number, LateSource] {
  const excelMinutes = parseExcelDurationMinutes(terlambat);
  if (excelMinutes > 0) return [excelMinutes, "excel"];
  if (!checkIn) return [0, "none"];
  const cutoff = jenjang ? parseClockMinutes(cutoffs[jenjang] ?? cutoffs[jenjang.toUpperCase()]) : null;
  const scan = parseClockMinutes(checkIn);
  if (cutoff === null || scan === null) return [0, "none"];
  return [Math.max(0, scan - cutoff), "calculated"];
}

export interface DepartureRuleInput {
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  dismissal: string | null;
  graceMinutes?: number;
  excused?: boolean;
}

export function deriveDepartureStatus(input: DepartureRuleInput): { classification: string; minutesEarly: number } {
  const status = input.status.toLowerCase();
  if (["sakit", "izin", "alfa", "libur"].includes(status) || !input.checkIn && !input.checkOut) return { classification: "NOT_APPLICABLE", minutesEarly: 0 };
  if (input.checkIn && !input.checkOut) return { classification: "MISSING_CHECKOUT", minutesEarly: 0 };
  const dismissal = parseClockMinutes(input.dismissal);
  const checkOut = parseClockMinutes(input.checkOut);
  if (dismissal === null || checkOut === null) return { classification: "UNKNOWN_POLICY", minutesEarly: 0 };
  const minutesEarly = Math.max(0, dismissal - checkOut);
  if (checkOut < dismissal - (input.graceMinutes ?? 0)) return { classification: input.excused ? "EXCUSED_EARLY_DEPARTURE" : "EARLY_DEPARTURE", minutesEarly };
  return { classification: "ON_TIME_DEPARTURE", minutesEarly: 0 };
}
