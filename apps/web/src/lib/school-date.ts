const schoolDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function schoolLocalDate(at = new Date()): string {
  const parts = Object.fromEntries(schoolDateFormatter.formatToParts(at).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
