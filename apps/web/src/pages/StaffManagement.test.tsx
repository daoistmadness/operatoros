import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffManagement from "./StaffManagement";
import * as staffApi from "../api/staff";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryKey[1] === "jenjangs"
    ? { isPending: false, isError: false, data: [{ id: 1, name: "Primary", code: "PRI", level: "Primary", active: true }] }
    : { isPending: false, isError: false, data: response((queryKey[2] as { status: "ACTIVE" | "FORMER" | "ALL" }).status) },
}));

vi.mock("../api/staff", () => ({
  fetchStaff: vi.fn(),
  fetchJenjangOptions: vi.fn(),
}));

const response = (status: "ACTIVE" | "FORMER" | "ALL") => ({
  items: [{
    id: "staff-1", source_staff_id: "S-001", full_name: "Synthetic Teacher", employment_status: status,
    job_title: "Teacher", employment_start_date: "2020-01-01", employment_end_date: null,
    dapodik_status: "ACTIVE", nip: "123", nuptk: null, jenjangs: [{ id: 1, name: "Primary", code: "PRI", level: "Primary", active: true }],
    age_years: 36, service_years: 6, service_months: 0, service_duration_status: "CALCULATED",
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
    vi.mocked(staffApi.fetchJenjangOptions).mockResolvedValue([{ id: 1, name: "Primary", code: "PRI", level: "Primary", active: true }]);
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
      root.render(<MemoryRouter><StaffManagement /></MemoryRouter>);
    });
  }

  it("defaults to active staff and renders status counts, jenjang badges, age, and service", async () => {
    await renderPage();
    expect(container.textContent).toContain("Synthetic Teacher");
    expect(container.textContent).toContain("Primary");
    expect(container.textContent).toContain("36y");
    expect(container.textContent).toContain("6y 0m");
    expect(container.textContent).toContain("Former");
  });

  it("changes the primary status filter while preserving the directory UI", async () => {
    await renderPage();
    const former = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Former"));
    expect(former).toBeDefined();
    await act(async () => former?.click());
    expect(former?.getAttribute("aria-pressed")).toBe("true");
  });
});
