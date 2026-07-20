import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitStudentUpdate, createStudent, fetchStudents, previewRoster, previewStudentUpdate, replaceDeviceIdentity, updateStudent } from "./students";
import { queryKeys } from "../lib/query/queryKeys";

describe("student management API domain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 25, total_pages: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  it("uses stable hierarchical query keys", () => {
    expect(queryKeys.students.list({ page: 2 })).toEqual(["students", "list", { page: 2 }]);
    expect(queryKeys.students.detail("uuid-1")).toEqual(["students", "detail", "uuid-1"]);
    expect(queryKeys.students.deviceIdentities("uuid-1")).toEqual(["students", "devices", "uuid-1"]);
    expect(queryKeys.students.enrollments("uuid-1")).toEqual(["students", "enrollments", "uuid-1"]);
  });

  it("uses canonical student routes and server filters", async () => {
    await fetchStudents({ search: "synthetic", page: 2, device_linked: false });
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/student-masters/management/list", search: expect.stringContaining("page=2") }), expect.objectContaining({ method: "GET", credentials: "include" }));
    expect(String((fetch as any).mock.calls[0][0])).toContain("device_linked=false");
  });

  it("creates and patches only through canonical master endpoints", async () => {
    await createStudent({ identity: { full_name: "Synthetic" } });
    expect(String((fetch as any).mock.calls[0][0])).toContain("/api/student-masters");
    expect((fetch as any).mock.calls[0][1].method).toBe("POST");
    await updateStudent("uuid-1", { record_version: "x".repeat(64) });
    expect(String((fetch as any).mock.calls[1][0])).toContain("/api/student-masters/uuid-1/profile");
    expect((fetch as any).mock.calls[1][1].method).toBe("PATCH");
  });

  it("uses separate guarded device and import endpoints", async () => {
    await replaceDeviceIdentity("uuid-1", { device_identifier: "0001" });
    expect(String((fetch as any).mock.calls[0][0])).toContain("/api/student-masters/uuid-1/device-identities");
    const roster = new File(["xlsx"], "roster.xlsx");
    await previewRoster(roster, "Synthetic Registrar", "2026-07-20");
    expect((fetch as any).mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(String((fetch as any).mock.calls[1][0])).toContain("/api/student-enrollments/roster-preview");
    await previewStudentUpdate(roster);
    expect(String((fetch as any).mock.calls[2][0])).toContain("/api/student-masters/management/update-preview");
    await commitStudentUpdate("batch-1", { selected_row_ids: [1], confirmation: "COMMIT_STUDENT_DATA_UPDATE", preview_checksum: "a".repeat(64) });
    expect(String((fetch as any).mock.calls[3][0])).toContain("/api/student-masters/management/update-commit/batch-1");
  });
});
