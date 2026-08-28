import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "CanonicalStudentProfile.tsx"), "utf8");

describe("canonical student legacy identity contract", () => {
  it("exposes all canonical link states", () => {
    expect(source).toContain("Linked");
    expect(source).toContain("Not Linked");
    expect(source).toContain("Review Required");
  });

  it("gates candidate review and linking controls to the resolver capability", () => {
    expect(source).toContain('can("resolve_student_duplicates")');
    expect(source).toContain("Review / link");
    expect(source).toContain("LINK_LEGACY_STUDENT");
  });
});
