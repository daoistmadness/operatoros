import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance review actor and permission contract", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/pages/AttendanceReview.tsx"), "utf8");
  const corrections = fs.readFileSync(path.join(process.cwd(), "src/pages/AttendanceCorrections.tsx"), "utf8");
  const classEntry = fs.readFileSync(path.join(process.cwd(), "src/pages/ClassAttendanceEntry.tsx"), "utf8");
  const studentProfile = fs.readFileSync(path.join(process.cwd(), "src/pages/StudentProfile.tsx"), "utf8");

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

  it("exposes dated S/I/A corrections with structured paper-book attribution", () => {
    for (const status of ["sakit", "izin", "alfa"]) {
      expect(source).toContain(`"${status}"`);
      expect(corrections).toContain(`value="${status}"`);
      expect(classEntry).toContain(`"${status === "sakit" ? "sick" : status === "izin" ? "leave" : "alfa"}"`);
    }
    expect(source).toContain("PAPER_BOOK_VERIFICATION");
    expect(corrections).toContain("PAPER_BOOK_VERIFICATION");
    expect(classEntry).toContain("PAPER_BOOK_VERIFICATION");
    expect(classEntry).toContain("Book, month, page (required)");
    expect(classEntry).toContain("const mapped = toFormStatus(st.effective_status)");
    expect(classEntry).toContain('filter(([, state]) => !state.unsupportedStatus)');
    expect(studentProfile).toContain("reported_sakit");
    expect(studentProfile).toContain("row.status === 'sakit'");
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
