import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttendanceReconciliation from "./AttendanceReconciliation";
import * as reportQueries from "../hooks/useReportQueries";
import * as reconciliationQueries from "../hooks/useAttendanceReconciliationQuery";
import type { AttendanceReconciliationResponse } from "@operatoros/contracts/analytics";

vi.mock("../hooks/useReportQueries", () => ({ useReportFilters: vi.fn() }));
vi.mock("../hooks/useAttendanceReconciliationQuery", () => ({ useAttendanceReconciliationQuery: vi.fn(), useAttendanceReviewMutations: vi.fn() }));

const response: AttendanceReconciliationResponse = {
  academic_year: { id: 2, label: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30" },
  class: { id: 8, name: "P2-B", grade: "Grade 2", program: "Primary", jenjang: "SD" },
  month: "2026-09", scope: "combined", period: { start_date: "2026-09-01", end_date: "2026-09-30" },
  review: { status: "NOT_REVIEWED", revision: 0, evidence_version: `sha256:${"a".repeat(64)}`, decision: null,
    reviewed_by: null, reviewed_at: null, note: null,
    evidence_references: { attendance_ids: [], override_history_ids: [], attendance_import_row_ids: [], enrollment_ids: [],
      enrollment_class_history_ids: [], enrollment_lifecycle_audit_ids: [], calendar_rule_ids: [], calendar_exception_ids: [], ledger_revision_id: null }, history: [] },
  calendar: { expected_school_days: 22, non_school_days: 8, unknown_dates: [] },
  canonical: { expected_student_days: 22, recorded_student_days: 21, unrecorded_student_days: 1, hadir_count: 18, sakit_count: 1, izin_count: 1, alfa_count: 1, late_count: 0, other_status_count: 0, coverage_rate: 95.45, hadir_rate: 81.8, sakit_rate: 4.5, izin_rate: 4.5, alfa_rate: 4.5, attendance_rate: 81.8, recorded_attendance_rate: 85.7 },
  machine_evidence: { coverage_status: "NOT_TRACKED", recorded_student_days: 1 },
  ledger: { state: "MISSING", entry_mode: null, reported: { sakit: null, izin: null, alfa: null }, comparison: { status: "NOT_REPORTED", reason_code: "LEDGER_NOT_SUBMITTED", differences: { sakit: null, izin: null, alfa: null } } },
  evidence: { status: "INCOMPLETE", unresolved_student_days: 1, contradictory_student_days: 0, unresolved_class_evidence: 0, unknown_calendar_dates: [] },
  summary: { applicable_students: 1, students_needing_review: 1, matching_students: 0, mismatched_students: 0, unresolved_student_days: 1, missing_book_reports: 1, machine_recorded_student_days: 1, contradictory_student_days: 0 },
  students: [{ enrollment_id: 31, student_name: "Synthetic Student", expected_student_days: 22,
    machine_records: [{ date: "2026-09-01", status: "late", scan_in: "07:55", scan_out: null, source_state: "CONFLICT" }],
    daily_evidence: [{ date: "2026-09-01", raw_status: "on-time", override_status: null, effective_status: "on-time", machine_recorded: true }, { date: "2026-09-02", raw_status: null, override_status: null, effective_status: null, machine_recorded: false }],
    effective: { present: 18, sakit: 1, izin: 1, alfa: 1, unresolved: 1 }, book_totals: { sakit: null, izin: null, alfa: null },
    differences: { sakit: null, izin: null, alfa: null }, comparison: { status: "NOT_REPORTED", reason_code: "LEDGER_NOT_SUBMITTED" },
    unresolved_dates: ["2026-09-02"], unknown_calendar_dates: [], contradictory_dates: [], first_review_date: "2026-09-02" }],
};

const reportFilters = {
  academic_years: [{ id: 2, name: "2026/2027", start_date: "2026-07-01", end_date: "2027-06-30", is_default: true }],
  default_academic_year_id: 2, months: [{ value: "2026-09", label: "September 2026" }],
  scopes: [{ value: "combined", label: "All programs" }], classes: ["P2-B"], class_options: [{ id: 8, name: "P2-B" }], subjects: [],
};
const mocked = (value: unknown) => value as { mockReturnValue: (result: unknown) => void };

describe("AttendanceReconciliation", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocked(reportQueries.useReportFilters).mockReturnValue({ data: reportFilters, isPending: false, error: null });
    mocked(reconciliationQueries.useAttendanceReconciliationQuery).mockReturnValue({ data: response, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
    mocked(reconciliationQueries.useAttendanceReviewMutations).mockReturnValue({
      decision: { isPending: false, mutateAsync: vi.fn().mockResolvedValue(response) },
      reopen: { isPending: false, mutateAsync: vi.fn().mockResolvedValue(response) },
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("distinguishes unreported book totals, unresolved days, and retained machine sources", async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/attendance/reconciliation?academic_year_id=2&scope=combined&class_id=8&month=2026-09"]}><AttendanceReconciliation /></MemoryRouter>));
    expect(container.textContent).toContain("Monthly Attendance Reconciliation");
    expect(container.textContent).toContain("coverage is not tracked");
    expect(container.textContent).toContain("Missing scans remain unresolved");
    expect(container.textContent).toContain("Teacher-book totals are not submitted");
    expect(container.textContent).toContain("Book totals not reported");
    expect(container.textContent).toContain("1 unresolved · 0 conflicts");
    expect(container.textContent).toContain("Machine source retained");
    expect(container.textContent).toContain("Conflicting import");
    expect(container.querySelector('a[href="/attendance/class-entry?class_id=8&date=2026-09-02"]')).not.toBeNull();
    expect(container.querySelector('a[href="/attendance/monthly-recap?academic_year_id=2&month=2026-09&class_id=8"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Alfa: 1 missing");
    expect(reconciliationQueries.useAttendanceReconciliationQuery).toHaveBeenCalledWith({ academic_year_id: "2", class_id: "8", month: "2026-09", scope: "combined" });
  });

  it("does not pick an arbitrary correction date from a monthly totals mismatch", async () => {
    const mismatch = structuredClone(response);
    mismatch.students[0]!.effective.unresolved = 0;
    mismatch.students[0]!.unresolved_dates = [];
    mismatch.students[0]!.comparison = { status: "MISMATCH", reason_code: "SIA_REASON_MISMATCH" };
    mismatch.students[0]!.first_review_date = null;
    mocked(reconciliationQueries.useAttendanceReconciliationQuery).mockReturnValue({ data: mismatch, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
    await act(async () => root.render(<MemoryRouter initialEntries={["/attendance/reconciliation?academic_year_id=2&scope=combined&class_id=8&month=2026-09"]}><AttendanceReconciliation /></MemoryRouter>));
    expect(container.textContent).toContain("Monthly totals do not identify a date to correct.");
    expect(container.textContent).not.toContain("Attendance entry");
  });

  it("requires an explicit confirmation and a note to record unresolved issues", async () => {
    const decision = vi.fn().mockResolvedValue(response);
    mocked(reconciliationQueries.useAttendanceReviewMutations).mockReturnValue({
      decision: { isPending: false, mutateAsync: decision }, reopen: { isPending: false, mutateAsync: vi.fn() },
    });
    await act(async () => root.render(<MemoryRouter initialEntries={["/attendance/reconciliation?academic_year_id=2&scope=combined&class_id=8&month=2026-09"]}><AttendanceReconciliation /></MemoryRouter>));
    const open = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Mark reviewed with issues");
    expect(open).toBeDefined();
    await act(async () => open?.click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    const note = document.querySelector<HTMLTextAreaElement>("#attendance-review-note");
    expect(note).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(note, "Waiting for two dated marks.");
      note?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")).find((button) => button.textContent === "Mark reviewed with issues");
    await act(async () => confirm?.click());
    expect(decision).toHaveBeenCalledWith(expect.objectContaining({ decision: "REVIEWED_WITH_ISSUES", note: "Waiting for two dated marks.", expected_revision: 0, evidence_version: response.review.evidence_version }));
  });
});
