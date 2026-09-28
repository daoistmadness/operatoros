// Presentation-only duration helpers for accumulated late minutes.
// These never compute business metrics; they only format canonical numeric
// minute values supplied by the API. Hours are NOT wrapped at 24 because the
// values are accumulated durations, not time-of-day.

export function formatDurationMinutes(minutes: number): string {
  const total = Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export type LateDurationSource = {
  late_events: number;
  total_late_minutes: number;
  known_duration_events?: number | null;
  unknown_duration_events?: number | null;
};

export type LateTimeDisplay = {
  /** Formatted duration, or "—" when no duration is known. */
  text: string;
  /** True when the value represents an unavailable (unknown) duration. */
  unavailable: boolean;
  /** Short note for partially/fully unknown durations, e.g. "+ 2 events without duration". */
  note: string | null;
};

export function resolveLateTimeDisplay(source: LateDurationSource): LateTimeDisplay {
  const events = Number(source.late_events) || 0;
  if (events === 0) return { text: "00:00", unavailable: false, note: null };
  const knownRaw = source.known_duration_events;
  const unknownRaw = source.unknown_duration_events;
  // Legacy payloads without duration provenance keep the previous behavior:
  // the server-provided minutes are treated as fully known.
  const known = knownRaw === null || knownRaw === undefined ? events : Number(knownRaw) || 0;
  const unknown = unknownRaw === null || unknownRaw === undefined ? events - known : Number(unknownRaw) || 0;
  if (unknown <= 0) return { text: formatDurationMinutes(source.total_late_minutes), unavailable: false, note: null };
  if (known <= 0) {
    const plural = unknown === 1 ? "event" : "events";
    return { text: "—", unavailable: true, note: `${unknown} late ${plural} without duration` };
  }
  const plural = unknown === 1 ? "event" : "events";
  return { text: formatDurationMinutes(source.total_late_minutes), unavailable: false, note: `+ ${unknown} ${plural} without duration` };
}
