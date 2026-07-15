import { describe, expect, it } from "vitest";
import { getPageApiError } from "./errors";

describe("page API error classification", () => {
  it.each([
    [401, "session has expired"],
    [403, "does not have permission"],
    [404, "routing configuration"],
    [405, "routing configuration"],
    [500, "backend logs"],
  ])("classifies HTTP %s safely", (status, expected) => {
    expect(getPageApiError({ status, response: { status, data: {} } }, "fallback")).toContain(expected);
  });

  it("preserves safe backend validation details", () => {
    expect(getPageApiError({ status: 400, response: { status: 400, data: { detail: "Invalid year" } } }, "fallback"))
      .toBe("Invalid year");
  });
});
