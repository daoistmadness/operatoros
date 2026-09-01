import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AttendanceMachineImportPreview from "./AttendanceMachineImportPreview";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";
import { vi } from "vitest";

vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));

const auth: AuthContextValue = { user: { id: 1, username: "Admin", role: "admin", capabilities: ["import_attendance"] }, loading: false, authenticated: true, can: (value) => value === "import_attendance", login: vi.fn(), logout: vi.fn() };
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }], class_names: [], subjects: [] };

describe("AttendanceMachineImportPreview", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    vi.mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() } as never);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("exposes a labelled preview-only workflow without attendance mutation controls", async () => {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><AuthContext.Provider value={auth}><AttendanceMachineImportPreview /></AuthContext.Provider></MemoryRouter></QueryClientProvider>); });
    expect(container.textContent).toContain("Machine Import Preview");
    expect(container.textContent).toContain("Preview only");
    expect(container.textContent).toContain("No attendance, student, enrollment, calendar, deadline, or mapping records will be changed.");
    expect(container.querySelector('label[for="machine-preview-file"]')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/Import attendance|Commit attendance|automatic Alfa/i);
  });
});
