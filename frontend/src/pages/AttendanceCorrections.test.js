import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance correction management safety", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/pages/AttendanceCorrections.jsx"), "utf8");

  it("provides maker-checker comparison and trusted read-only actors", () => {
    expect(source).toContain("Original effective");
    expect(source).toContain("Proposed");
    expect(source).toContain("Requester (session)");
    expect(source).toContain("Self-approval is unavailable");
    expect(source).not.toMatch(/requester\s*:/);
    expect(source).not.toMatch(/approver\s*:/);
  });

  it("covers finalized, reopened, stale, permission, and audit states", () => {
    expect(source).toContain("Finalized");
    expect(source).toContain("Open / reopened");
    expect(source).toContain("ATTENDANCE_CORRECTION_STALE");
    expect(source).toContain("does not have permission");
    expect(source).toContain("Audit timeline");
  });

  it("requires rejection reason and blocks duplicate mutations", () => {
    expect(source).toContain("Rejection reason");
    expect(source).toContain("rejectionReason.trim().length < 5");
    expect(source).toContain("if (busy) return");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("autoFocus");
  });

  it("uses responsive, overflow-safe layout contracts", () => {
    expect(source).toContain("overflow-x-hidden");
    expect(source).toContain("sm:grid-cols-3");
    expect(source).toContain("lg:grid-cols-");
  });
});
