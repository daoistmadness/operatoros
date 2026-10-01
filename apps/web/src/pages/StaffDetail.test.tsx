import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "../lib/query/queryClient";

const staffApi = vi.hoisted(() => ({
  fetchStaffDetail: vi.fn(),
  fetchJenjangOptions: vi.fn(async () => []),
  replaceStaffJenjangs: vi.fn(),
  updateStaffEmployment: vi.fn(),
  createStaffEducation: vi.fn(),
  updateStaffEducation: vi.fn(),
  deleteStaffEducation: vi.fn(),
}));
vi.mock("../api/staff", () => staffApi);

import StaffDetail from "./StaffDetail";

const record = {
  id: 17, education_level: "S1", institution_name: "Synthetic University", major: "Synthetic Studies",
  graduation_year: 2020, notes: null,
};
const member = {
  id: "synthetic-staff-1", source_staff_id: "S-001", full_name: "Synthetic Teacher", employment_status: "ACTIVE",
  job_title: "Teacher", employment_start_date: "2020-01-01", employment_end_date: null, dapodik_status: "ACTIVE",
  nip: null, nuptk: null, birth_place: null, birth_date: null, identifiers: [], contact: null, jenjangs: [],
  age_years: null, service_years: 4, service_months: 0, service_duration_status: "CALCULATED",
  highest_education_level: "S1", highest_education_institution: "Synthetic University", education_history: [record],
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
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
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
});
