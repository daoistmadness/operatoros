import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/errors";
import type { StaffMonthlyActivityItemDto, StaffMonthlyActivityListResponseDto } from "@operatoros/contracts/staff";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";
import StaffMonthlyActivities from "./StaffMonthlyActivities";
import * as monthlyApi from "../api/staffMonthlyActivities";
import * as staffApi from "../api/staff";

vi.mock("../api/staffMonthlyActivities", () => ({
  downloadStaffMonthlyActivities: vi.fn(),
  fetchStaffMonthlyActivities: vi.fn(),
  fetchStaffMonthlyActivityHistory: vi.fn(),
  fetchStaffMonthlyActivitySummary: vi.fn(),
  generateStaffMonthlyActivities: vi.fn(),
  updateStaffMonthlyActivity: vi.fn(),
}));
vi.mock("../api/staff", () => ({ fetchSchoolUnits: vi.fn() }));

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
};
const item: StaffMonthlyActivityItemDto = {
  id: 12,
  staff_member_id: "synthetic-staff-12",
  staff_code: "PTK-12",
  staff_name: "Synthetic Employee",
  school_unit_id: 8,
  school_unit_name: "Synthetic Unit",
  month: currentMonth(),
  status: "PENDING",
  confirmation_date: null,
  confirmed_by: null,
  processing_notes: null,
  version: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};
const list: StaffMonthlyActivityListResponseDto = {
  period: { month: item.month, generated: true, generated_at: "2026-10-01T00:00:00.000Z", generated_by: "synthetic-admin" },
  summary: { month: item.month, school_unit_id: null, school_unit_name: null, total_activities: 1, total_applicable: 1, completed: 0, pending: 1, needs_correction: 0, not_applicable: 0, completion_percentage: 0 },
  items: [item],
};
const auth: AuthContextValue = {
  user: { id: 1, username: "synthetic-admin", role: "admin", capabilities: ["view_staff_analytics", "manage_staff", "export_staff"] },
  loading: false,
  authenticated: true,
  can: (capability) => ["view_staff_analytics", "manage_staff", "export_staff"].includes(capability),
  login: vi.fn(),
  logout: vi.fn(),
};
let container: HTMLDivElement;
let root: Root;
const queryClient = createTestQueryClient();

function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function flush(): Promise<void> { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

async function renderPage(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><StaffMonthlyActivities /></AuthContext.Provider></QueryClientProvider></MemoryRouter>));
  await flush();
}

async function setSelect(id: string, value: string): Promise<void> {
  const select = container.querySelector(`#${id}`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Missing select ${id}`);
  await act(async () => changeValue(select, value));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  vi.mocked(monthlyApi.fetchStaffMonthlyActivities).mockResolvedValue(list);
  vi.mocked(monthlyApi.fetchStaffMonthlyActivitySummary).mockResolvedValue({ items: [] });
  vi.mocked(monthlyApi.fetchStaffMonthlyActivityHistory).mockResolvedValue({ items: [] });
  vi.mocked(monthlyApi.generateStaffMonthlyActivities).mockResolvedValue({ month: item.month, generated_count: 1, already_generated: false });
  vi.mocked(monthlyApi.updateStaffMonthlyActivity).mockResolvedValue({ ...item, status: "COMPLETED", confirmation_date: "2026-10-27", confirmed_by: "synthetic-admin", version: 2 });
  vi.mocked(staffApi.fetchSchoolUnits).mockResolvedValue([{ id: 8, name: "Synthetic Unit", status: "ACTIVE", version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" }]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe("StaffMonthlyActivities page", () => {
  it("filters the server query and shows the reporting summary and activity row", async () => {
    await renderPage();
    expect(container.textContent).toContain("Monthly PTK activity");
    expect(container.textContent).toContain("Synthetic Employee");
    expect(container.textContent).toContain("Completed ÷ (Completed + Pending + Needs Correction)");

    await setSelect("ptk-school-unit", "8");
    await setSelect("ptk-status", "PENDING");
    expect(monthlyApi.fetchStaffMonthlyActivities).toHaveBeenLastCalledWith({ month: item.month, school_unit_id: 8, status: "PENDING" });
  });

  it("sends a confirmed completion with the current version and shows a refresh path on conflict", async () => {
    await renderPage();
    await setSelect("ptk-status-12", "COMPLETED");
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save activity"));
    if (!save) throw new Error("Save activity button is missing.");
    await act(async () => save.click());
    await flush();
    expect(monthlyApi.updateStaffMonthlyActivity).toHaveBeenCalledWith(12, expect.objectContaining({ expected_version: 1, status: "COMPLETED", confirmation_date: expect.any(String) }));

    vi.mocked(monthlyApi.updateStaffMonthlyActivity).mockRejectedValueOnce(new ApiError("This activity changed in another edit.", { status: 409 }));
    await setSelect("ptk-status-12", "NEEDS_CORRECTION");
    const reason = container.querySelector<HTMLInputElement>("#ptk-reason-12");
    if (!reason) throw new Error("Correction reason input is missing.");
    await act(async () => changeValue(reason, "Synthetic correction"));
    const correctionSave = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save activity"));
    if (!correctionSave) throw new Error("Save activity button is missing.");
    await act(async () => correctionSave.click());
    await flush();
    expect(container.textContent).toContain("Reload current activity");
  });
});
