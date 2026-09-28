import { describe, expect, it } from "vitest";
import { formatDurationMinutes, resolveLateTimeDisplay } from "./duration";

describe("formatDurationMinutes", () => {
  it.each([
    [0, "00:00"],
    [1, "00:01"],
    [15, "00:15"],
    [16, "00:16"],
    [59, "00:59"],
    [60, "01:00"],
    [61, "01:01"],
    [75, "01:15"],
    [76, "01:16"],
    [1500, "25:00"],
    [7813, "130:13"],
  ])("formats %i minutes as %s without wrapping hours at 24", (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected);
  });
});

describe("resolveLateTimeDisplay", () => {
  it("shows 00:00 only when there are no late events", () => {
    expect(resolveLateTimeDisplay({ late_events: 0, total_late_minutes: 0 })).toEqual({ text: "00:00", unavailable: false, note: null });
  });

  it("shows the known accumulated duration when every event has duration", () => {
    expect(resolveLateTimeDisplay({ late_events: 2, total_late_minutes: 16, known_duration_events: 2, unknown_duration_events: 0 })).toEqual({ text: "00:16", unavailable: false, note: null });
  });

  it("never converts a fully unknown duration to 00:00", () => {
    expect(resolveLateTimeDisplay({ late_events: 2, total_late_minutes: 0, known_duration_events: 0, unknown_duration_events: 2 })).toEqual({ text: "—", unavailable: true, note: "2 late events without duration" });
  });

  it("flags partially unknown durations next to the known total", () => {
    expect(resolveLateTimeDisplay({ late_events: 3, total_late_minutes: 15, known_duration_events: 2, unknown_duration_events: 1 })).toEqual({ text: "00:15", unavailable: false, note: "+ 1 event without duration" });
  });
});
