import { describe, expect, it } from "vitest";
import { schoolLocalDate } from "./school-date";

describe("schoolLocalDate", () => {
  it("uses the Asia/Jakarta calendar date across UTC date boundaries", () => {
    expect(schoolLocalDate(new Date("2026-11-01T16:59:59.000Z"))).toBe("2026-11-01");
    expect(schoolLocalDate(new Date("2026-11-01T17:00:00.000Z"))).toBe("2026-11-02");
    expect(schoolLocalDate(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
  });
});
