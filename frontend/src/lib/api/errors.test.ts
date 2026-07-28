import { describe, expect, it } from "vitest";
import {
  ApiError,
  getApiErrorMessage,
  getPageApiError,
  isApiError,
  isCancelledApiError,
  normalizeApiError,
  shouldRetryQuery,
} from "./errors";

describe("typed API error normalization", () => {
  it.each([
    [400, "validation", false],
    [422, "validation", false],
    [401, "authentication", false],
    [403, "authorization", false],
    [404, "not_found", false],
    [409, "conflict", false],
    [429, "rate_limit", true],
    [500, "server", true],
    [503, "server", true],
  ] as const)("classifies HTTP %s as %s", (status, kind, retryable) => {
    const error = normalizeApiError({ status, data: { detail: "unsafe detail" } });
    expect(error).toMatchObject({ status, kind, retryable });
    expect(isApiError(error)).toBe(true);
  });

  it("normalizes FastAPI validation details into immutable field errors", () => {
    const error = normalizeApiError({
      status: 422,
      data: {
        detail: [
          { loc: ["body", "academic_year"], msg: "Required", type: "missing" },
          { loc: ["body", "score"], msg: "Must be at most 100", type: "range" },
        ],
      },
    });
    expect(error.fieldErrors).toEqual({
      "body.academic_year": ["Required"],
      "body.score": ["Must be at most 100"],
    });
  });

  it("uses safe fixed messages for authentication and authorization", () => {
    expect(getApiErrorMessage({ status: 401, data: { detail: "token=secret" } })).toContain("Sign in");
    expect(getApiErrorMessage({ status: 403, data: { detail: "SQL internal" } })).toContain("permission");
  });

  it("preserves safe operator validation details", () => {
    expect(getPageApiError({ status: 400, data: { detail: "Invalid academic year" } }, "fallback"))
      .toBe("Invalid academic year");
  });

  it("normalizes network and timeout errors", () => {
    expect(normalizeApiError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(normalizeApiError(new Error("Request timed out")).kind).toBe("timeout");
  });

  it("normalizes cancellation without a user-visible message", () => {
    const abort = new DOMException("aborted", "AbortError");
    expect(isCancelledApiError(abort)).toBe(true);
    expect(getApiErrorMessage(abort)).toBe("");
    expect(shouldRetryQuery(0, abort)).toBe(false);
  });

  it("preserves an already normalized error", () => {
    const original = new ApiError("Safe conflict", { kind: "conflict", status: 409 });
    expect(normalizeApiError(original)).toBe(original);
  });

  it("normalizes malformed-response failures as contract errors", () => {
    const error = normalizeApiError(new ApiError("Unexpected response", { kind: "contract" }));
    expect(error.kind).toBe("contract");
    expect(error.retryable).toBe(false);
  });

  it("sanitizes credentials, paths, SQL, HTML, and stack fragments", () => {
    const error = normalizeApiError({
      status: 400,
      data: {
        detail: "<b>Bad</b> token=abc123 /home/operator/private.db SELECT * FROM users at fn (/tmp/app.ts:1:2)",
      },
    });
    expect(error.message).toContain("Bad");
    expect(error.message).not.toMatch(/abc123|private\.db|SELECT|<b>|app\.ts/i);
  });

  it("bounds user-facing messages", () => {
    expect(normalizeApiError({ status: 400, data: { detail: "x".repeat(1000) } }).message.length)
      .toBeLessThanOrEqual(320);
  });

  it("does not serialize unknown thrown objects", () => {
    const error = normalizeApiError({ private: { token: "secret" } }, "Safe fallback");
    expect(error.message).toBe("Safe fallback");
    expect(error.message).not.toContain("secret");
  });

  it("extracts safe code and request identity metadata", () => {
    const error = normalizeApiError({
      status: 409,
      headers: { "x-request-id": "request-001" },
      data: { code: "VERSION_CONFLICT", detail: "Record changed" },
    });
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.requestId).toBe("request-001");
  });

  it("allows one bounded retry only for transient failures", () => {
    for (const kind of ["network", "timeout", "server", "rate_limit"] as const) {
      const error = new ApiError("Transient", { kind });
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(false);
    }
  });

  it("never retries ordinary 4xx or contract failures", () => {
    for (const kind of ["authentication", "authorization", "validation", "conflict", "not_found", "contract"] as const) {
      expect(shouldRetryQuery(0, new ApiError("No retry", { kind }))).toBe(false);
    }
  });
});
