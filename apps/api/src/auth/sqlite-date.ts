export function parseSqliteDate(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

export function isAccountUnlocked(lockedUntil: string | null, now = Date.now()): boolean {
  const parsed = parseSqliteDate(lockedUntil);
  return parsed === null || parsed <= now;
}
