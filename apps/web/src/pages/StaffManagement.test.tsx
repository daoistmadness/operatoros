import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLocation } from '@tanstack/react-router';
import { MemoryRouter } from '../test/TestRouter';
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "../lib/query/queryClient";
import StaffManagement from "./StaffManagement";
import * as staffApi from "../api/staff";
import { ApiError } from "../lib/api/errors";

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));

vi.mock("../api/staff", () => ({
  fetchStaff: vi.fn(),
  fetchJenjangOptions: vi.fn(async () => [{ id: 1, name: "Primary", code: "PRI", level: "Primary", active: true }]),
  fetchSchoolUnits: vi.fn(async () => [
    { id: 4, name: "North Campus", status: "ACTIVE" as const, version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: 5, name: "South Campus", status: "ACTIVE" as const, version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" },
  ]),
  fetchStaffPositions: vi.fn(async () => []),
  fetchStaffAnalytics: vi.fn(async () => ({ workforce: { total: 3, active: 1, former: 2, teaching: 1, non_teaching: 1 } })),
  createSchoolUnit: vi.fn(),
  updateSchoolUnit: vi.fn(),
  downloadStaffExcel: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.searchStr}</output>;
}

const response = (status: "ACTIVE" | "FORMER" | "ALL") => ({
  items: [{
    id: "staff-1", source_staff_id: "S-001", full_name: "Synthetic Teacher", employment_status: status,
    job_title: "Teacher", employment_start_date: "2020-01-01", employment_end_date: null,
    dapodik_status: "ACTIVE", nip: "123", has_nuptk: false, jenjangs: [{ id: 1, name: "Primary", code: "PRI", level: "Primary", active: true }],
    service_years: 6, service_months: 0, service_duration_status: "CALCULATED",
    highest_education_level: "S1", highest_education_institution: "Synthetic University",
  }],
  total: 1, page: 1, page_size: 100, total_pages: 1,
  counts: { ACTIVE: 1, FORMER: 2, ALL: 3 },
});

describe("staff directory", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(staffApi.fetchStaff).mockResolvedValue(response("ACTIVE"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => {
      root.render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><StaffManagement /><LocationProbe /></MemoryRouter></QueryClientProvider>);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  async function setInputValue(id: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("defaults to active staff and renders status counts, jenjang badges, and tenure without age", async () => {
    await renderPage();
    expect(container.textContent).toContain("Synthetic Teacher");
    expect(container.textContent).toContain("Primary");
    expect(container.textContent).toContain("6y 0m");
    expect(container.textContent).toContain("Former");
    expect(container.textContent).not.toContain("36y");
  });

  it("changes the primary status filter while preserving the directory UI", async () => {
    await renderPage();
    const former = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Former"));
    expect(former).toBeDefined();
    await act(async () => former?.click());
    expect(former?.getAttribute("aria-pressed")).toBe("true");
  });

  it("serializes the school-unit filter and keeps the catalog controls reachable", async () => {
    await renderPage();
    expect(container.textContent).toContain("School units");
    expect(container.textContent).toContain("North Campus");
    const filter = container.querySelector<HTMLSelectElement>("#staff-school-unit")!;
    await act(async () => { filter.value = "4"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.querySelector('[aria-label="Current location"]')?.textContent).toContain("?school_unit_id=4");
    expect(staffApi.fetchStaff).toHaveBeenLastCalledWith(expect.objectContaining({ school_unit_id: 4 }));
    expect(container.querySelector("#new-school-unit")).toBeTruthy();
  });

  it("keeps a stale school-unit draft visible and gives reload guidance on conflict", async () => {
    await renderPage();
    const name = container.querySelector<HTMLInputElement>("#school-unit-name-4")!;
    const reason = container.querySelector<HTMLInputElement>("#school-unit-reason-4")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Draft Campus");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "Reviewed draft");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(staffApi.updateSchoolUnit).mockRejectedValueOnce(new ApiError("School unit changed since it was opened. Reload the school-unit list and review the current values before saving.", { status: 409 }));
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save unit"))!;
    await act(async () => save.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(staffApi.updateSchoolUnit).toHaveBeenCalledWith(4, expect.objectContaining({ name: "Draft Campus", expected_version: 1, reason: "Reviewed draft" }));
    expect(container.querySelector<HTMLInputElement>("#school-unit-name-4")?.value).toBe("Draft Campus");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Your draft is preserved");
    expect(container.textContent).toContain("Review them before saving again");
  });

  it("keeps other school-unit drafts when one unit saves", async () => {
    await renderPage();
    await setInputValue("school-unit-name-4", "North draft");
    await setInputValue("school-unit-reason-4", "Rename North");
    await setInputValue("school-unit-name-5", "South draft");
    await setInputValue("school-unit-reason-5", "Rename South");
    let finish!: (value: Awaited<ReturnType<typeof staffApi.updateSchoolUnit>>) => void;
    vi.mocked(staffApi.updateSchoolUnit).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const saveNorth = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save unit"))!;
    await act(async () => saveNorth.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.querySelector<HTMLInputElement>("#school-unit-name-4")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#school-unit-name-5")?.disabled).toBe(false);
    await act(async () => { finish({ id: 4, name: "North draft", status: "ACTIVE", version: 2, created_at: "2026-01-01", updated_at: "2026-01-02" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.querySelector<HTMLInputElement>("#school-unit-name-5")?.value).toBe("South draft");
    expect(container.querySelector<HTMLInputElement>("#school-unit-reason-5")?.value).toBe("Rename South");
  });

  it("locks school-unit create fields until the submitted values are saved", async () => {
    await renderPage();
    await setInputValue("new-school-unit", "New Campus");
    await setInputValue("new-school-unit-reason", "Open campus");
    let finish!: (value: Awaited<ReturnType<typeof staffApi.createSchoolUnit>>) => void;
    vi.mocked(staffApi.createSchoolUnit).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const add = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add unit"))!;
    await act(async () => add.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.querySelector<HTMLInputElement>("#new-school-unit")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#new-school-unit-reason")?.disabled).toBe(true);
    await act(async () => { finish({ id: 6, name: "New Campus", status: "ACTIVE", version: 1, created_at: "2026-01-01", updated_at: "2026-01-01" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector<HTMLInputElement>("#new-school-unit")?.value).toBe("");
  });

  it("shows a stale version conflict only on the unit that failed to save", async () => {
    await renderPage();
    await setInputValue("school-unit-name-4", "North draft");
    await setInputValue("school-unit-reason-4", "Rename North");
    vi.mocked(staffApi.updateSchoolUnit).mockRejectedValueOnce(new ApiError("School unit changed since it was opened. Reload the school-unit list and review the current values before saving.", { status: 409 }));
    const saveNorth = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save unit"))!;
    await act(async () => saveNorth.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const northRow = container.querySelector<HTMLInputElement>("#school-unit-name-4")?.closest(".rounded-xl");
    const southRow = container.querySelector<HTMLInputElement>("#school-unit-name-5")?.closest(".rounded-xl");
    expect(northRow?.querySelector('[role="status"]')?.textContent).toContain("Your draft is preserved");
    expect(southRow?.querySelector('[role="status"]')).toBeNull();
  });
});
