import type { AttendanceCalendarStatus } from "@operatoros/contracts/attendance";
import type { AuthContext } from "../auth/service";

export const SCHOOL_TIMEZONE = "Asia/Jakarta";
export type SubmissionTimingStatus = "BEFORE_DEADLINE" | "DEADLINE_PASSED" | "DEADLINE_UNKNOWN" | "NOT_APPLICABLE";
export type SubmissionTiming = { status: SubmissionTimingStatus; deadlineLocalTime: string | null; deadlineAt: string | null; authorityAvailable: boolean };

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function validSubmissionDeadlineTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localParts(now: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function resolveAttendanceSubmissionTiming(input: { date: string; expectation: AttendanceCalendarStatus; cutoffTime: string | null | undefined; now: Date }): SubmissionTiming {
  if (input.expectation === "NOT_EXPECTED") return { status: "NOT_APPLICABLE", deadlineLocalTime: null, deadlineAt: null, authorityAvailable: true };
  if (input.expectation !== "EXPECTED" || !validSubmissionDeadlineTime(input.cutoffTime)) return { status: "DEADLINE_UNKNOWN", deadlineLocalTime: null, deadlineAt: null, authorityAvailable: false };
  const current = localParts(input.now);
  const today = `${current.year}-${current.month}-${current.day}`;
  const currentTime = `${current.hour}:${current.minute}:${current.second}`;
  const status = today < input.date || (today === input.date && currentTime <= `${input.cutoffTime}:00`) ? "BEFORE_DEADLINE" : "DEADLINE_PASSED";
  return { status, deadlineLocalTime: input.cutoffTime, deadlineAt: `${input.date}T${input.cutoffTime}:00+07:00`, authorityAvailable: true };
}

export function resolveSubmissionDeadlines(context: AuthContext, input: { academicYearId: number; jenjangIds: number[] }): Map<number, string> {
  const ids = [...new Set(input.jenjangIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = context.database.client.query(`SELECT jenjang_id, cutoff_time FROM attendance_submission_deadlines WHERE academic_year_id = ? AND jenjang_id IN (${placeholders})`).all(input.academicYearId, ...ids) as Array<{ jenjang_id: number; cutoff_time: string }>;
  return new Map(rows.filter((row) => validSubmissionDeadlineTime(row.cutoff_time)).map((row) => [Number(row.jenjang_id), String(row.cutoff_time)]));
}
