import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "../lib/query/queryClient";

const state = vi.hoisted(() => ({ capabilities: new Set<string>() }));
const staffApi = vi.hoisted(() => ({
  commitStaffImport: vi.fn(), fetchStaffImportHistory: vi.fn(), previewStaffImport: vi.fn(),
  fetchStaffAnalytics: vi.fn(), fetchStaffPositions: vi.fn(), updateStaffPosition: vi.fn(),
  createStaff: vi.fn(), fetchSensitiveStaff: vi.fn(), fetchStaffDetail: vi.fn(), updateStaff: vi.fn(),
}));
vi.mock("../api/staff", () => staffApi);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ can: (capability: string) => state.capabilities.has(capability) }) }));

import StaffAnalytics from "./StaffAnalytics";
import StaffForm from "./StaffForm";
import StaffImport from "./StaffImport";

const analytics = {
  as_of_date: "2026-10-02",
  workforce: { total: 2, active: 1, former: 1, unknown_status: 0, status_coverage: { count: 2, percentage: 100 }, teaching: null, non_teaching: null, unclassified_positions: 2 },
  age: { average_years: null, coverage: { count: 0, percentage: 0 }, distribution: [{ label: "Unknown", count: 2, percentage: 100 }] },
  tenure: { average_years: null, median_years: null, coverage: { count: 0, percentage: 0 }, distribution: [{ label: "Unknown", count: 2, percentage: 100 }] },
  dapodik: { coverage: { count: 0, percentage: 0 }, distribution: [{ label: "Unknown / blank", count: 2, percentage: 100 }] },
  nuptk: { with_nuptk: 0, without_nuptk: 2, coverage: { count: 0, percentage: 0 } },
  data_quality: { fields: [{ field: "overall", present: 0, missing: 16, coverage: 0 }], duplicate_identity_count: 0, invalid_identifier_count: 0, unmapped_position_count: 2, unresolved_import_conflict_count: 0 },
  positions: [], joining: [],
};

describe("employee workflows", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.capabilities = new Set();
    staffApi.fetchStaffAnalytics.mockResolvedValue(analytics);
    staffApi.fetchStaffPositions.mockResolvedValue([]);
    staffApi.fetchStaffImportHistory.mockResolvedValue([]);
    staffApi.previewStaffImport.mockResolvedValue({
      batch_id: "batch-synthetic", file_sha256: "synthetic-hash", source_filename: "synthetic.xlsx", source_sheet: "Data Karyawan Edelweiss",
      column_mapping: { Nama: "full_name", Umur: "IGNORED_DERIVED" },
      summary: { total: 2, valid: 1, new: 1, matched: 0, updates: 0, unchanged: 0, warnings: 0, invalid: 0, conflicts: 1, duplicates: 0 },
      rows: [
        { row_number: 2, state: "NEW", full_name: "Synthetic Employee", employee_code_masked: null, issues: [] },
        { row_number: 3, state: "CONFLICT", full_name: "Synthetic Conflict", employee_code_masked: null, issues: [{ field: "identity", code: "CONFLICTING_MATCHES", severity: "ERROR", message: "Workbook identifiers match multiple existing employee records." }] },
      ],
    });
    staffApi.commitStaffImport.mockResolvedValue({ batch_id: "batch-synthetic", status: "APPLIED", summary: { inserted: 1, updated: 0, unchanged: 0, rejected: 1, failed: 0 }, failed_rows: [] });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); vi.clearAllMocks();
  });

  async function render(node: ReactNode, path = "/") {
    await act(async () => root.render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  it("hides sensitive employee inputs when the capability is absent", async () => {
    state.capabilities = new Set(["manage_staff"]);
    await render(<Routes><Route path="/staff/new" element={<StaffForm />} /></Routes>, "/staff/new");
    expect((host.querySelector('input[name="full_name"]') as HTMLInputElement | null)?.required).toBe(true);
    expect(host.querySelector('input[name="nik"]')).toBeNull();
    expect(host.textContent).toContain("Identifiers remain text");
  });

  it("loads and submits raw position and DAPODIK values separately from display values", async () => {
    state.capabilities = new Set(["manage_staff", "edit_sensitive_staff_fields", "view_staff_sensitive"]);
    staffApi.fetchStaffDetail.mockResolvedValue({
      id: "staff-raw", source_staff_id: "TEST-RAW", full_name: "Synthetic Employee", employment_status: "ACTIVE", job_title: "Teacher", job_title_raw: "Teacher A",
      employment_start_date: "2020-01-01", employment_end_date: null, dapodik_status: "ACTIVE", dapodik_status_raw: "AKTIF", nip: null, has_nuptk: false,
      jenjangs: [], service_years: null, service_months: null, highest_education_level: null, highest_education_institution: null, updated_at: "2026-10-02 10:00:00",
      identifiers: [], education_history: [],
    });
    staffApi.fetchSensitiveStaff.mockResolvedValue({ birth_place: null, birth_date: null, identifiers: [], contact: null });
    staffApi.updateStaff.mockResolvedValue({ id: "staff-raw" });
    await render(<Routes><Route path="/staff/:id/edit" element={<StaffForm />} /></Routes>, "/staff/staff-raw/edit");
    expect((host.querySelector('input[name="job_title_raw"]') as HTMLInputElement).value).toBe("Teacher A");
    expect((host.querySelector("#dapodik_status_raw") as HTMLSelectElement).value).toBe("AKTIF");
    const name = host.querySelector('input[name="full_name"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Synthetic Renamed Employee");
    await act(async () => name.dispatchEvent(new Event("input", { bubbles: true })));
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes("Save employee"));
    await act(async () => button?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(staffApi.updateStaff).toHaveBeenCalledWith("staff-raw", expect.objectContaining({ full_name: "Synthetic Renamed Employee", job_title_raw: "Teacher A", dapodik_status_raw: "AKTIF" }));
  });

  it("shows server aggregate values and unknown coverage in analytics", async () => {
    state.capabilities = new Set(["view_staff_analytics"]);
    await render(<StaffAnalytics />);
    expect(host.textContent).toContain("Active employees");
    expect(host.textContent).toContain("Former employees");
    expect(host.textContent).toContain("Unknown");
    expect(host.textContent).toContain("Overall field completeness: 0.0%");
  });

  it("previews rows, retains validation errors, and commits accepted rows only", async () => {
    state.capabilities = new Set(["import_staff", "view_staff_audit"]);
    await render(<StaffImport />);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["synthetic workbook"], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const button = (label: string) => Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
    await act(async () => button("Preview import")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.textContent).toContain("Synthetic Employee");
    expect(host.textContent).toContain("Workbook identifiers match multiple existing employee records.");
    expect(host.textContent).toContain("Ignored derived value");
    await act(async () => button("Commit 1 accepted rows")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(staffApi.commitStaffImport).toHaveBeenCalledWith("batch-synthetic", [2]);
    expect(host.textContent).toContain("1 inserted");
  });

  it("shows deterministic stale-preview row failures after commit", async () => {
    state.capabilities = new Set(["import_staff"]);
    staffApi.commitStaffImport.mockResolvedValueOnce({ batch_id: "batch-synthetic", status: "APPLIED", summary: { inserted: 0, updated: 0, unchanged: 0, rejected: 0, failed: 1 }, failed_rows: [{ row_number: 2, code: "STALE_UNMATCHED_MATCH" }] });
    await render(<StaffImport />);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic workbook"], "synthetic.xlsx")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const button = (label: string) => Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
    await act(async () => button("Preview import")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => button("Commit 1 accepted rows")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.textContent).toContain("1 require a new preview");
    expect(host.textContent).toContain("Row 2: STALE UNMATCHED MATCH");
  });
});
