export type LateSource = "excel" | "calculated" | "manual" | "none";

export function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour <= 23 ? hour * 60 + Number(match[2]) : null;
}

export function parseExcelDurationMinutes(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.trim().match(/^(\d+):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function deriveJenjangFromClassName(className: string | null): string {
  const normalized = className?.trim() ?? "";
  if (!normalized) return "Unassigned";
  const alnum = normalized.match(/^([A-Za-z]+\d+)/);
  if (alnum?.[1]) return alnum[1].toUpperCase();
  const alpha = normalized.match(/^([A-Za-z]+)/);
  if (alpha?.[1]) return alpha[1][0]!.toUpperCase() + alpha[1].slice(1).toLowerCase();
  const digit = normalized.match(/^(\d+)/);
  if (digit?.[1]) return digit[1];
  return normalized.split("-")[0]?.trim().toUpperCase() ?? "";
}

export function deriveAttendanceStatus(checkIn: string | null, checkOut: string | null, lateMinutes: number | null): "on-time" | "late" | "incomplete" | "absent" {
  if (checkIn && checkOut) return (lateMinutes ?? 0) > 0 ? "late" : "on-time";
  if (Boolean(checkIn) !== Boolean(checkOut)) return "incomplete";
  return "absent";
}

export function insertCanonicalAttendanceRecord(client: any, input: { studentId: number; date: string; checkIn: string | null; checkOut: string | null; lateDuration: number; lateSource: LateSource; status: string }): number {
  const result = client.run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [input.studentId, input.date, input.checkIn, input.checkOut, input.lateDuration, input.lateSource, ["absent", "sakit", "izin", "alfa"].includes(input.status) ? 1 : 0, input.status]);
  return Number(result.lastInsertRowid);
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
