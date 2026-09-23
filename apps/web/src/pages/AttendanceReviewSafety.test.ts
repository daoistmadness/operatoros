import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance review actor and permission contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/pages/AttendanceReview.tsx"), "utf8");

  it("does not send or render an editable reviewer field", () => {
    expect(source).not.toMatch(/reviewed_by\s*:\s*(user|["'])/);
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
  const source = fs.readFileSync(path.join(process.cwd(), "src/features/machine-import/components/MachineImportWorkflow.tsx"), "utf8");

  it("uses only the canonical machine-import preview and apply routes", () => {
    expect(source).toContain("previewMachineAttendance");
    expect(source).toContain("applyMachineAttendance");
    expect(source).toContain("data.previewDigest");
    expect(source).toContain("../api/machineImport");
    expect(source).not.toContain("/api/uploads/preview");
    expect(source).not.toContain("/api/uploads/upload");
  });

  it("keeps preview read-only and commits only through explicit confirmation", () => {
    expect(source).toContain("Preview only");
    expect(source).toContain("not automatically marked Alfa");
    expect(source).toContain("previewDigest");
    expect(source).toContain("!data.summary.eligibleCreates");
  });
});
