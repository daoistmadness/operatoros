import { describe, expect, it } from "vitest";
import { mapServerFieldErrors } from "./server-errors";

describe("server form field errors", () => {
  it("maps only allowlisted fields from API paths", () => {
    const mapped = mapServerFieldErrors<{ full_name: string; email: string }>(
      {
        "body.full_name": ["Name is already assigned."],
        "body.email": ["Email is invalid."],
        "body.__proto__": ["Ignore this path."],
        unknown: ["Ignore this field."],
      },
      ["full_name"],
    );

    expect(mapped).toEqual({ full_name: "Name is already assigned." });
  });
});
