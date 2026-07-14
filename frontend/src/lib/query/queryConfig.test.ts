import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { shouldRetry } from "./queryConfig";

describe("query retry policy", () => {
  it("does not retry authentication or permission failures", () => {
    expect(shouldRetry(0, new ApiError("Unauthorized", { status: 401 }))).toBe(false);
    expect(shouldRetry(0, new ApiError("Forbidden", { status: 403 }))).toBe(false);
  });

  it("allows only one retry for network and server failures", () => {
    expect(shouldRetry(0, new ApiError("Network"))).toBe(true);
    expect(shouldRetry(0, new ApiError("Server", { status: 500 }))).toBe(true);
    expect(shouldRetry(1, new ApiError("Server", { status: 500 }))).toBe(false);
  });
});
