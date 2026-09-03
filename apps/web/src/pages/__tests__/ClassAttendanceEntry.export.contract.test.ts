import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../ClassAttendanceEntry.tsx"), "utf8");

describe("class attendance entry export contract", () => {
  it("gates the export to the new capability and exposes busy/error states", () => {
    expect(source).toContain('can("export_assigned_class_attendance")');
    expect(source).toContain("exportAssignedClassAttendanceExcel");
    expect(source).toContain("aria-busy={exportingExcel}");
    expect(source).toContain("Export gagal");
  });

  it("keeps export state local and downloads via the shared blob flow", () => {
    expect(source).toContain("createDownloadUrl");
    expect(source).toContain("revokeDownloadUrl");
    expect(source).toContain('link.download = `absensi_kelas_${exportMonth}.xlsx`');
  });
});

describe("class attendance entry roster contract", () => {
  it("renders the API's canonical student_name field", () => {
    expect(source).toContain("st.student_name");
    expect(source).not.toContain("st.full_name");
  });

  it("consumes the API's canonical attendance status and scan fields", () => {
    expect(source).toContain("st.effective_status");
    expect(source).toContain("st.scan_in");
    expect(source).toContain("st.scan_out");
    expect(source).not.toContain("st.status");
    expect(source).not.toContain("st.check_in");
    expect(source).not.toContain("st.check_out");
  });
});
