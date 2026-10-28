import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from '../test/TestRouter';
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "../lib/query/queryClient";
import type { StaffHistory } from "../api/staff";

const staffApi = vi.hoisted(() => ({
  fetchStaffDetail: vi.fn(),
  fetchStaffHistory: vi.fn<() => Promise<StaffHistory>>(async () => []),
  fetchSchoolUnits: vi.fn(async () => [{ id: 4, name: "North Campus", status: "ACTIVE", version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" }]),
  fetchSensitiveStaff: vi.fn(),
  fetchJenjangOptions: vi.fn(async () => []),
  replaceStaffJenjangs: vi.fn(),
  updateStaffEmployment: vi.fn(),
  createStaffSchoolUnitAssignment: vi.fn(),
  closeStaffSchoolUnitAssignment: vi.fn(),
  cancelStaffSchoolUnitAssignment: vi.fn(),
  createStaffEducation: vi.fn(),
  updateStaffEducation: vi.fn(),
  deleteStaffEducation: vi.fn(),
}));
vi.mock("../api/staff", () => staffApi);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ can: (capability: string) => ["manage_staff", "view_staff", "view_staff_audit"].includes(capability) }) }));

import StaffDetail from "./StaffDetail";

const record = {
  id: 17, education_level: "S1", institution_name: "Synthetic University", major: "Synthetic Studies",
  graduation_year: 2020, notes: null,
};
const member = {
  id: "synthetic-staff-1", source_staff_id: "S-001", full_name: "Synthetic Teacher", employment_status: "ACTIVE",
  job_title: "Teacher", employment_start_date: "2020-01-01", employment_end_date: null, dapodik_status: "ACTIVE",
  nip: null, has_nuptk: false, updated_at: "2026-10-02 00:00:00", identifiers: [], jenjangs: [],
  service_years: 4, service_months: 0, service_duration_status: "CALCULATED",
  highest_education_level: "S1", highest_education_institution: "Synthetic University", education_history: [record],
  school_unit_assignments: [{ id: 31, school_unit_id: 4, school_unit_name: "North Campus", school_unit_status: "ACTIVE", effective_from: "2026-01-01", effective_to: null, ptk_applicability: "UNKNOWN", reason: "Synthetic assignment", created_by: "admin", created_at: "2026-01-01", closed_reason: null, closed_by: null, closed_at: null, cancelled_reason: null, cancelled_by: null, cancelled_at: null, is_current: true }],
};

describe("Staff Detail education deletion", () => {
  let host: HTMLDivElement;
  let root: Root;
  let deleted = false;

  beforeEach(() => {
    deleted = false;
    staffApi.fetchStaffDetail.mockImplementation(async () => ({
      ...member,
      education_history: deleted ? [] : [record],
      highest_education_level: deleted ? null : member.highest_education_level,
      highest_education_institution: deleted ? null : member.highest_education_institution,
    }));
    staffApi.fetchJenjangOptions.mockResolvedValue([]);
    staffApi.fetchSchoolUnits.mockResolvedValue([{ id: 4, name: "North Campus", status: "ACTIVE", version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    staffApi.fetchStaffHistory.mockResolvedValue([{ id: "school-unit-assignment-31", action: "STAFF_SCHOOL_UNIT_ASSIGNMENT_PERIOD", effective_date: "2026-01-01", reason: "Synthetic assignment", changed_fields: [], metadata: { school_unit_id: 4, school_unit_name: "North Campus", effective_from: "2026-01-01", effective_to: null, ptk_applicability: "UNKNOWN" }, actor: "admin", created_at: "2026-01-01" }]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  async function renderPage() {
    await act(async () => root.render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/staff/synthetic-staff-1"]}>
          <Routes><Route path="/staff/:id" element={<StaffDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  async function setInputValue(id: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function buttonByLabel(label: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === label);
  }

  function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
  }

  async function openConfirmation() {
    const remove = buttonByLabel("Delete education record S1");
    expect(remove).toBeTruthy();
    await act(async () => remove?.click());
  }

  it("opens an accessible confirmation without invoking delete", async () => {
    await renderPage();
    expect(buttonByLabel("Delete education record S1")).toBeTruthy();
    await openConfirmation();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Delete education record?");
    expect(document.body.textContent).toContain("S1 education record");
    expect(staffApi.deleteStaffEducation).not.toHaveBeenCalled();
  });

  it("cancels without calling the delete API", async () => {
    await renderPage();
    await openConfirmation();
    await act(async () => buttonByText("Cancel")?.click());
    expect(staffApi.deleteStaffEducation).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain("S1 · Synthetic University");
  });

  it("deletes once after confirmation and refreshes the staff detail query", async () => {
    await renderPage();
    staffApi.deleteStaffEducation.mockImplementationOnce(async () => { deleted = true; });
    await openConfirmation();
    await act(async () => buttonByText("Delete record")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(staffApi.deleteStaffEducation).toHaveBeenCalledTimes(1);
    expect(staffApi.deleteStaffEducation).toHaveBeenCalledWith("synthetic-staff-1", 17);
    expect(staffApi.fetchStaffDetail).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("No education records yet.");
    expect(host.textContent).not.toContain("S1 · Synthetic University");
  });

  it("disables confirmation while the mutation is pending", async () => {
    await renderPage();
    let finish!: () => void;
    staffApi.deleteStaffEducation.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = () => { deleted = true; resolve(); };
    }));
    await openConfirmation();
    const confirm = buttonByText("Delete record")!;
    await act(async () => confirm.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(confirm.disabled).toBe(true);
    await act(async () => confirm.click());
    expect(staffApi.deleteStaffEducation).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain("No education records yet.");
  });

  it("keeps the record visible and shows the sanitized error on API failure", async () => {
    await renderPage();
    staffApi.deleteStaffEducation.mockRejectedValueOnce(new Error("Education record could not be deleted."));
    await openConfirmation();
    await act(async () => buttonByText("Delete record")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Education record could not be deleted.");
    expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(host.textContent).toContain("S1 · Synthetic University");
    await act(async () => buttonByText("Cancel")?.click());
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(buttonByLabel("Delete education record S1")).toBeTruthy();
  });

  it("shows explicit unknown eligibility and audit history, and creates a dated unit assignment", async () => {
    await renderPage();
    expect(host.textContent).toContain("North Campus");
    expect(host.textContent).toContain("PTK UNKNOWN");
    expect(host.textContent).toContain("Synthetic assignment");
    expect(host.querySelector('[aria-label="Assignment periods"]')?.querySelectorAll("li")).toHaveLength(1);
    const unit = host.querySelector<HTMLSelectElement>("#assignment-school-unit")!;
    await act(async () => { unit.value = "4"; unit.dispatchEvent(new Event("change", { bubbles: true })); });
    const reason = host.querySelector<HTMLInputElement>("#assignment-reason")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "New unit assignment"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
    const add = buttonByText("Add assignment")!;
    expect(add.disabled).toBe(false);
    staffApi.createStaffSchoolUnitAssignment.mockResolvedValueOnce(member);
    await act(async () => add.click());
    expect(staffApi.createStaffSchoolUnitAssignment).toHaveBeenCalledWith("synthetic-staff-1", expect.objectContaining({ school_unit_id: 4, ptk_applicability: "UNKNOWN", reason: "New unit assignment" }));
  });

  it("defaults assignment dates to the current Jakarta day across midnight UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00Z"));
    await renderPage();
    expect(host.querySelector<HTMLInputElement>("#employment-effective-date")?.value).toBe("2026-10-27");
    expect(host.querySelector<HTMLInputElement>("#assignment-start-date")?.value).toBe("2026-10-27");
    expect(host.querySelector<HTMLInputElement>("#assignment-close-date-31")?.value).toBe("2026-10-27");
  });

  it("shows an upcoming assignment with a required cancellation reason and no close action", async () => {
    staffApi.fetchStaffDetail.mockResolvedValueOnce({ ...member, school_unit_assignments: [{ ...member.school_unit_assignments[0], id: 32, effective_from: "2099-01-01", is_current: false }] });
    await renderPage();
    expect(host.textContent).toContain("Upcoming");
    expect(host.querySelector<HTMLInputElement>("#assignment-close-date-32")).toBeNull();
    expect(host.querySelector("#assignment-cancel-reason-32")).toBeTruthy();
    const cancel = buttonByText("Cancel assignment")!;
    expect(cancel.disabled).toBe(true);
    const reason = host.querySelector<HTMLInputElement>("#assignment-cancel-reason-32")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "Planned assignment withdrawn"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(cancel.disabled).toBe(false);
    staffApi.cancelStaffSchoolUnitAssignment.mockResolvedValueOnce(member);
    await act(async () => cancel.click());
    expect(staffApi.cancelStaffSchoolUnitAssignment).toHaveBeenCalledWith("synthetic-staff-1", 32, { reason: "Planned assignment withdrawn" });
  });

  it("locks the submitted assignment form while creating an assignment", async () => {
    await renderPage();
    const unit = host.querySelector<HTMLSelectElement>("#assignment-school-unit")!;
    await act(async () => { unit.value = "4"; unit.dispatchEvent(new Event("change", { bubbles: true })); });
    await setInputValue("assignment-reason", "New assignment reason");
    let finish!: (value: Awaited<ReturnType<typeof staffApi.createStaffSchoolUnitAssignment>>) => void;
    staffApi.createStaffSchoolUnitAssignment.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => buttonByText("Add assignment")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.querySelector<HTMLSelectElement>("#assignment-school-unit")?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#assignment-reason")?.disabled).toBe(true);
    await act(async () => { finish(member); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector<HTMLInputElement>("#assignment-reason")?.value).toBe("");
  });

  it("preserves other assignment close drafts and locks only the submitted row", async () => {
    const assignments = [member.school_unit_assignments[0]!, { ...member.school_unit_assignments[0]!, id: 32, school_unit_name: "South Campus", reason: "Second assignment" }];
    staffApi.fetchStaffDetail.mockImplementation(async () => ({ ...member, school_unit_assignments: assignments }));
    await renderPage();
    await setInputValue("assignment-close-reason-31", "Close North");
    await setInputValue("assignment-close-reason-32", "Close South");
    let finish!: (value: Awaited<ReturnType<typeof staffApi.closeStaffSchoolUnitAssignment>>) => void;
    staffApi.closeStaffSchoolUnitAssignment.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => buttonByText("Close assignment")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.querySelector<HTMLInputElement>("#assignment-close-reason-31")?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#assignment-close-reason-32")?.disabled).toBe(false);
    await act(async () => { finish(member); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector<HTMLInputElement>("#assignment-close-reason-31")?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>("#assignment-close-reason-32")?.value).toBe("Close South");
  });

  it("preserves other cancellation reasons and locks only the submitted assignment", async () => {
    const assignments = [31, 32].map((id) => ({ ...member.school_unit_assignments[0]!, id, effective_from: "2099-01-01", is_current: false }));
    staffApi.fetchStaffDetail.mockImplementation(async () => ({ ...member, school_unit_assignments: assignments }));
    await renderPage();
    await setInputValue("assignment-cancel-reason-31", "Cancel North");
    await setInputValue("assignment-cancel-reason-32", "Cancel South");
    let finish!: (value: Awaited<ReturnType<typeof staffApi.cancelStaffSchoolUnitAssignment>>) => void;
    staffApi.cancelStaffSchoolUnitAssignment.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => buttonByText("Cancel assignment")?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.querySelector<HTMLInputElement>("#assignment-cancel-reason-31")?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#assignment-cancel-reason-32")?.disabled).toBe(false);
    await act(async () => { finish(member); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector<HTMLInputElement>("#assignment-cancel-reason-31")?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>("#assignment-cancel-reason-32")?.value).toBe("Cancel South");
  });

  it("labels cancelled periods and shows both reasons and the recorded actor and time", async () => {
    staffApi.fetchStaffHistory.mockResolvedValueOnce([{
      id: "school-unit-assignment-32", action: "STAFF_SCHOOL_UNIT_ASSIGNMENT_PERIOD", effective_date: "2026-10-27", reason: "Planned assignment withdrawn", changed_fields: [],
      metadata: { school_unit_id: 4, school_unit_name: "North Campus", effective_from: "2026-10-28", effective_to: null, ptk_applicability: "UNKNOWN", assignment_reason: "Original plan", cancelled_reason: "Planned assignment withdrawn", cancelled_by: "admin", cancelled_at: "2026-10-27 09:00:00" },
      actor: "admin", created_at: "2026-10-27 09:00:00",
    }]);
    await renderPage();
    const history = host.querySelector('[aria-label="Assignment periods"]')!;
    expect(history.textContent).toContain("Cancelled");
    expect(history.textContent).toContain("Original plan");
    expect(history.textContent).toContain("Planned assignment withdrawn");
    expect(history.textContent).toContain("Cancelled by admin at 2026-10-27 09:00:00");
  });
});
