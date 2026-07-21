import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSibling = (name) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

describe("terminology harmonization copy", () => {
  it("keeps Grade Ledger user-facing copy free of implementation terms", () => {
    const source = readSibling("GradeLedger.tsx");
    expect(source).toContain("Grade data could not be processed. Check your connection and retry.");
    expect(source).toContain("Grade Ledger could not be displayed");
    expect(source).not.toContain("integritas payload");
    expect(source).not.toContain("Grade Ledger API");
  });

  it("keeps the Settings reset error user-directed", () => {
    const source = readSibling("Settings.js");
    expect(source).toContain("Data reset could not be completed. Retry or contact the system administrator.");
    expect(source).not.toContain("Check console for details");
  });

  it("uses the canonical Jenjang column label", () => {
    const source = readSibling("JenjangConfig.jsx");
    expect(source).toContain(">Jenjang<");
    expect(source).not.toContain("Jenjang siswa");
  });
});
