import { describe, expect, it } from "vitest";
import { getPageApiError } from "./errors";

describe("page API error classification", () => {
  it.each([
    [401, "session has expired"],
    [403, "does not have permission"],
    [404, "was not found"],
    [405, "was not found"],
    [500, "system administrator"],
  ])("classifies HTTP %s safely", (status, expected) => {
    expect(getPageApiError({ status, response: { status, data: {} } }, "fallback")).toContain(expected);
  });

  it("preserves safe backend validation details", () => {
    expect(getPageApiError({ status: 400, response: { status: 400, data: { detail: "Invalid year" } } }, "fallback"))
      .toBe("Invalid year");
  });

  it("does not expose internal implementation terms in 404 response", () => {
    const msg = getPageApiError({ status: 404, response: { status: 404, data: {} } }, "fallback");
    expect(msg).not.toContain("routing configuration");
    expect(msg).not.toContain("API");
  });

  it("does not expose internal implementation terms in 500 response", () => {
    const msg = getPageApiError({ status: 500, response: { status: 500, data: {} } }, "fallback");
    expect(msg).not.toContain("backend logs");
    expect(msg).not.toContain("console");
  });
});
