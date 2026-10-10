import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import UploadCenter from "./UploadCenter";
import { AuthContext, type AuthContextValue } from "../context/AuthContext";
import { createTestQueryClient } from "../lib/query/queryClient";
import * as readinessQueries from "../features/readiness";
import * as analyticsHooks from "../hooks/useAnalyticsQueries";

vi.mock("../features/readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/readiness")>();
  return { ...actual, useReadinessQuery: vi.fn(), invalidateReadiness: vi.fn() };
});
vi.mock("../hooks/useAnalyticsQueries", () => ({ useAnalyticsFiltersQuery: vi.fn() }));
vi.mock("../api/students", () => ({
  previewRoster: vi.fn(), commitRoster: vi.fn(), previewStudentUpdate: vi.fn(), commitStudentUpdate: vi.fn(), exportStudentTemplate: vi.fn(),
}));

const auth: AuthContextValue = {
  user: { id: 1, username: "Admin", role: "admin", capabilities: ["import_attendance"] },
  loading: false, authenticated: true, can: () => true, login: vi.fn(), logout: vi.fn(),
};
const filters = { academic_years: [{ id: 1, label: "2026/2027", is_default: true }], jenjangs: [{ id: 1, name: "SMP" }], class_names: [], subjects: [] };
const readyFeature = { key: "MACHINE_IMPORT", label: "Machine Import", route: "/upload", state: "READY", blockers: [], actions: [] };
const blockedFeature = {
  key: "MACHINE_IMPORT", label: "Machine Import", route: "/upload", state: "BLOCKED",
  blockers: ["academic_year", "jenjang", "calendar"],
  actions: [
    { code: "configure_year", label: "Configure academic year", route: "/academic-management?tab=foundation" },
    { code: "configure_jenjang", label: "Configure programs / jenjang", route: "/academic-management?tab=foundation" },
    { code: "configure_calendar", label: "Configure calendar", route: "/attendance/calendar" },
  ],
};

function renderCenter(capabilities: string[] = ["import_attendance", "import_staff"], initialEntry = "/upload") {
  const context: AuthContextValue = {
    ...auth,
    user: { ...auth.user!, capabilities },
    can: (capability) => capabilities.includes(capability),
  };
  return renderToStaticMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthContext.Provider value={context}>
          <UploadCenter />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Data Import & Export workspace", () => {
  it("shows Employee Import and its route only with the import_staff capability", () => {
    const html = renderCenter(["import_staff"], "/upload?section=employee");
    expect(html).toContain("Employee Import");
    expect(html).toMatch(/role="tab"[^>]*>[\s\S]*?Employee Import[\s\S]*?<\/button>/);
    expect(html).toContain('href="/staff/import"');
  });

  it("hides Employee Import without import_staff and keeps existing navigation", () => {
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({
      data: { overall: {}, foundation: [], operational: [], features: [readyFeature], overall_status: "READY", steps: [] },
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never);
    vi.mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() } as never);
    const html = renderCenter(["import_attendance"], "/upload?section=employee");
    expect(html).not.toContain("Employee Import");
    expect(html).not.toContain("/staff/import");
    expect(html).toContain("Attendance Upload");
    expect(html).toContain("Student Roster Upload");
    expect(html).toContain("Export");
  });

  it("presents the canonical workflow tabs with Attendance Upload active", () => {
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({
      data: { overall: {}, foundation: [], operational: [], features: [readyFeature], overall_status: "READY", steps: [] },
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never);
    vi.mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() } as never);
    const html = renderCenter();
    expect(html).toContain("Data Import &amp; Export");
    expect(html).toContain("Attendance Upload");
    expect(html).toContain("Student Roster Upload");
    expect(html).toContain("Needs Attention");
    expect(html).toContain("History");
    expect(html).toContain("Student Data Update");
    expect(html).toContain("Export");
    expect(html).toContain("Preview only");
    expect(html).toContain("not automatically marked Alfa");
  });

  it("shows the workbook picker when readiness is READY", () => {
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({
      data: { overall: {}, foundation: [], operational: [], features: [readyFeature], overall_status: "READY", steps: [] },
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never);
    vi.mocked(analyticsHooks.useAnalyticsFiltersQuery).mockReturnValue({ data: filters, isPending: false, error: null, refetch: vi.fn() } as never);
    const html = renderCenter();
    expect(html).toContain('id="machine-preview-file"');
    expect(html).toContain("Preview workbook");
  });

  it("shows canonical blockers and no workbook picker when readiness is BLOCKED", () => {
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({
      data: { overall: {}, foundation: [], operational: [], features: [blockedFeature], overall_status: "NOT_READY", steps: [] },
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never);
    const html = renderCenter();
    expect(html).toContain("Attendance Upload");
    expect(html).toContain("Academic year");
    expect(html).toContain("Programs / Jenjang");
    expect(html).toContain("School calendar");
    expect(html).toContain("Configure academic year");
    expect(html).toContain("Configure programs / jenjang");
    expect(html).toContain("Configure calendar");
    expect(html).not.toContain('id="machine-preview-file"');
  });

  it("shows an error instead of setup blockers when readiness fails", () => {
    vi.mocked(readinessQueries.useReadinessQuery).mockReturnValue({
      data: undefined, isPending: false, isError: true, error: new Error("offline"), refetch: vi.fn(),
    } as never);
    const html = renderCenter();
    expect(html).toContain("Import scope unavailable");
    expect(html).not.toContain("Configure academic year");
    expect(html).not.toContain('id="machine-preview-file"');
  });
});
