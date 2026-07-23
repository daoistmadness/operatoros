import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance review actor and permission contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/pages/AttendanceReview.js"), "utf8");

  it("does not send or render an editable reviewer field", () => {
    expect(source).not.toMatch(/reviewed_by\s*:/);
    expect(source).not.toMatch(/setReviewer|massReviewer/);
    expect(source).toContain("Reviewer (session)");
    expect(source).toContain("user?.username");
  });

  it("guards mutation controls with the attendance capability", () => {
    expect(source).toContain('can("manage_attendance")');
    expect(source).toContain("canManageAttendance ?");
  });
});

describe("attendance import UI safety contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/pages/Upload.js"), "utf8");

  it("uses only preview and preview commit routes", () => {
    expect(source).toContain('api.post("/api/uploads/preview"');
    expect(source).toContain("`/api/uploads/preview/${batchId}/commit`");
    expect(source).not.toContain('"/api/uploads/upload"');
  });

  it("exposes unresolved identities and blocks duplicate submission", () => {
    expect(source).toContain("Unmatched device identities");
    expect(source).toContain("!COMMITTABLE.has(row.classification)");
    expect(source).toContain("if (!preview || selected.length === 0 || busy) return");
    expect(source).toContain("disabled={busy || selected.length === 0}");
  });
});
