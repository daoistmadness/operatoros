import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function roundHalfEven(value: number): number {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
}

export function calculateAutoHeb(context: AuthContext, jenjang: string, month: number, year: number): Row {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const counts = rows(context, "SELECT s.id, COUNT(a.id) AS present_days FROM students s JOIN attendance a ON a.student_id = s.id WHERE s.jenjang = ? AND a.check_in IS NOT NULL AND a.date >= ? AND a.date <= ? GROUP BY s.id", [jenjang, start, end]).map((value) => Number(value.present_days)).sort((a, b) => b - a).slice(0, 5);
  const middle = counts.length >> 1;
  const median = counts.length ? counts.length % 2 ? counts[middle]! : roundHalfEven((counts[middle - 1]! + counts[middle]!) / 2) : 0;
  return { heb: median, source: "auto", note: null, derived_from: counts, median };
}

export function calculateHeb(context: AuthContext, jenjang: string, month: number, year: number): Row {
  const override = row(context, "SELECT heb_value, note FROM heb_overrides WHERE jenjang = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1", [jenjang, month, year]);
  if (override) return { heb: Number(override.heb_value), source: "manual", note: override.note ?? null, derived_from: null, median: null };
  return calculateAutoHeb(context, jenjang, month, year);
}
