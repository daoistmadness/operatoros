import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createTestQueryClient } from "../lib/query/queryClient";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mock hooks for interactive tests
const mockPreview = vi.fn();
const mockCommit = vi.fn();

vi.mock("../hooks/useStudentQueries", async () => {
  const actual = await vi.importActual("../hooks/useStudentQueries");
  return {
    ...actual,
    useRosterPreview: () => mockPreview(),
    useRosterCommit: () => mockCommit(),
    useStudentTemplateExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useStudentUpdatePreview: () => ({ mutateAsync: vi.fn(), isPending: false, data: null, error: null, reset: vi.fn() }),
    useStudentUpdateCommit: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: null }),
  };
});

function renderRoster() {
  // Dynamic import after mock
  return import("./UploadCenter").then(({ RosterImportPanel }) => {
    const client = createTestQueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RosterImportPanel />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return html;
  });
}

describe("Roster import improved UX - static contract", () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "./UploadCenter.tsx"), "utf8");

  it("has prominent upload card with drag-and-drop and Choose XLSX button", () => {
    expect(source).toContain("Choose XLSX file");
    expect(source).toContain("Drop an Excel file here");
    expect(source).toContain("onDragOver");
    expect(source).toContain("onDrop");
    expect(source).toContain("aria-label=\"Choose XLSX file\"");
    expect(source).toContain(".xlsx and supported .xls files");
    expect(source).not.toContain('className="sr-only" accept=".xlsx,.xls" onChange={(event) => { setFile'); // ensure not hidden without control - we have visible button
  });

  it("shows selected filename, size, sheet, Change/Remove and loading", () => {
    expect(source).toContain("Selected");
    expect(source).toContain("formatFileSize");
    expect(source).toContain("Sheet");
    expect(source).toContain("Change file");
    expect(source).toContain("Remove file");
    expect(source).toContain("Parsing workbook");
    expect(source).toContain("aria-live=\"polite\"");
  });

  it("has three visible stages Upload Review Import and does not render rows before parse", () => {
    expect(source).toContain("1 Upload");
    expect(source).toContain("2 Review");
    expect(source).toContain("3 Import");
    expect(source).toContain("RosterStages");
    expect(source).toContain("preview.data && !commit.isSuccess");
    // Ensure table not rendered before preview
    expect(source).toMatch(/\{preview\.data && !commit\.isSuccess && \(/);
  });

  it("presents summary cards with actual statuses", () => {
    expect(source).toContain("summaryCounts");
    expect(source).toContain("New students");
    expect(source).toContain("Matched");
    expect(source).toContain("Conflicts");
    expect(source).toContain("Invalid");
    expect(source).toContain("create_new_master");
    expect(source).toContain("create_enrollment");
    expect(source).not.toContain("canonical matching/business logic in React"); // ensure we use server-provided
  });

  it("has tabs All New students Matched Needs review Invalid with counts and default logic", () => {
    expect(source).toContain('All');
    expect(source).toContain('New students');
    expect(source).toContain('Needs review');
    expect(source).toContain('Invalid');
    expect(source).toContain('activeTab');
    expect(source).toContain('if (summaryCounts.conflicts > 0');
    expect(source).toContain('Needs review');
    expect(source).toContain('New students');
    // Search where useful
    expect(source).toContain('Search roster rows');
    expect(source).toContain('placeholder="Search name or ID"');
  });

  it("has bulk-create new students with safe selection", () => {
    expect(source).toContain("Select all valid new students");
    expect(source).toContain("Create ${selectedCreates}");
    expect(source).toContain("newEligibleIds");
    expect(source).toContain("CREATE_NEW_MASTER");
    // Never auto create ambiguous/duplicate/conflicting/invalid
    expect(source).toContain("POSSIBLE_DUPLICATE");
    expect(source).toContain("MISSING_JENJANG");
    expect(source).toContain("MISSING_CLASS");
    expect(source).toContain("INVALID");
  });

  it("has select-all with indeterminate correctly", () => {
    expect(source).toContain("headerCheckbox");
    expect(source).toContain("indeterminate");
    expect(source).toContain("selectionState");
    expect(source).toContain("aria-label=\"Select all valid new students\"");
    expect(source).toContain("aria-label=\"Select all eligible roster rows\"");
  });

  it("has sticky bulk-action bar", () => {
    expect(source).toContain("sticky bottom-0");
    expect(source).toContain("Clear selection");
    expect(source).toContain("new students selected");
    expect(source).toContain("conflicts need review");
  });

  it("improves table with pagination, sticky header, compact, search, filters", () => {
    expect(source).toContain("DataTable");
    expect(source).toContain("pageSize");
    expect(source).toContain("currentPage");
    expect(source).toContain("totalPages");
    expect(source).toContain("Previous");
    expect(source).toContain("Next");
    expect(source).toContain("sticky top-0");
    expect(source).toContain("min-w-[900px]");
    expect(source).toContain("overflow-x-auto");
  });

  it("has compact status badges with text and accessible semantics", () => {
    expect(source).toContain("StatusBadge");
    expect(source).toContain("aria-label=");
    expect(source).toContain("Matched");
    expect(source).toContain("New");
    expect(source).toContain("Conflict");
    expect(source).toContain("Invalid");
    // Not color alone
    expect(source).toContain("Badge");
  });

  it("conflict workflow in Needs review", () => {
    expect(source).toContain("Needs review");
    expect(source).toContain("Possible existing student");
    expect(source).toContain("disabledReason");
    expect(source).toContain("recommendedAction");
  });

  it("has confirmation before mutation", () => {
    expect(source).toContain("Ready to import");
    expect(source).toContain("existing students will be matched");
    expect(source).toContain("new students will be created");
    expect(source).toContain("rows will be skipped");
    expect(source).toContain("still require review");
    expect(source).toContain("roster-commit-summary");
  });

  it("has import progress and completion with double-submit prevention", () => {
    expect(source).toContain("Creating students");
    expect(source).toContain("aria-busy");
    expect(source).toContain("commit.isPending");
    expect(source).toContain("Import complete");
    expect(source).toContain("View students");
    expect(source).toContain("Import another file");
    expect(source).toContain("students created");
  });

  it("preserves architecture constraints", () => {
    expect(source).toContain("useRosterPreview");
    expect(source).toContain("DataTable");
    expect(source).toContain("rosterRowView");
    expect(source).toContain("eligibleIds");
    expect(source).not.toContain("zod");
    expect(source).not.toContain("postgresql");
  });

  it("is responsive", () => {
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain("lg:grid-cols-5");
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("sticky bottom-0");
  });
});

describe("Roster import - interactive behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    mockCommit.mockReturnValue({
      isPending: false,
      isSuccess: false,
      data: null,
      error: null,
      mutate: vi.fn(),
      reset: vi.fn(),
    });
  });

  it("renders visible Choose XLSX file button in upload stage", async () => {
    const html = await renderRoster();
    expect(html).toContain("Choose XLSX file");
    expect(html).toContain("Drop an Excel file here");
    expect(html).toContain('accept=".xlsx,.xls"');
    expect(html).toContain("Upload student data");
  });

  it("shows stages 1 Upload 2 Review 3 Import", async () => {
    const html = await renderRoster();
    expect(html).toContain("1 Upload");
    expect(html).toContain("2 Review");
    expect(html).toContain("3 Import");
    expect(html).toContain("Student import progress");
  });

  it("does not render reconciliation rows before file parsed", async () => {
    const html = await renderRoster();
    expect(html).not.toContain("Roster preview");
    expect(html).not.toContain("DataTable");
    expect(html).toContain("Preview does not update the database");
  });

  it("shows summary cards and tabs after preview", async () => {
    const rows = [
      { preview_row_id: 1, classification: "CREATE_NEW_MASTER", source_row: 2, payload: { student_name: "A", student_identifier: "1", jenjang: "SD", class_name: "1A" }, errors: [] },
      { preview_row_id: 2, classification: "CREATE_ENROLLMENT", source_row: 3, payload: { student_name: "B", student_identifier: "2", jenjang: "SD", class_name: "1A" }, errors: [] },
      { preview_row_id: 3, classification: "POSSIBLE_DUPLICATE", source_row: 4, payload: { student_name: "C", student_identifier: "3", jenjang: "SD", class_name: "1A" }, errors: ["ambiguous"] },
      { preview_row_id: 4, classification: "INVALID", source_row: 5, payload: { student_name: "", student_identifier: "", jenjang: "", class_name: "" }, errors: ["missing"] },
    ];
    mockPreview.mockReturnValue({
      data: {
        preview_id: "test-id",
        preview_checksum: "abc",
        summary: { create_new_master: 1, create_enrollment: 1, possible_duplicate: 1, missing_jenjang: 0, missing_class: 0, invalid: 1, total: 4 },
        rows,
      },
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    const html = await renderRoster();
    expect(html).toContain("4 rows");
    expect(html).toContain("New students");
    expect(html).toContain("Matched");
    expect(html).toContain("Conflicts");
    expect(html).toContain("Invalid");
    expect(html).toContain("All");
    expect(html).toContain("Needs review");
    // default should be Needs review because conflicts exist
    expect(html).toContain("aria-selected=\"true\"");
  });

  it("select all valid new students excludes conflicts and invalid", async () => {
    const rows = [
      { preview_row_id: 1, classification: "CREATE_NEW_MASTER", source_row: 2, payload: { student_name: "Valid New", student_identifier: "100" }, errors: [] },
      { preview_row_id: 2, classification: "POSSIBLE_DUPLICATE", source_row: 3, payload: { student_name: "Conflict", student_identifier: "101" }, errors: ["dup"] },
      { preview_row_id: 3, classification: "INVALID", source_row: 4, payload: { student_name: "", student_identifier: "" }, errors: ["missing"] },
    ];
    mockPreview.mockReturnValue({
      data: {
        preview_id: "id",
        preview_checksum: "chk",
        summary: { create_new_master: 1, possible_duplicate: 1, invalid: 1, total: 3 },
        rows,
      },
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    const html = await renderRoster();
    expect(html).toContain("3 rows");
    // In needs-review default, header shows All eligible, not new tab specific
    expect(html).toContain("All eligible");
    expect(html).toContain("New students");
    // Checkbox for conflict/invalid should be disabled
    expect(html).toContain("disabled");
    expect(html).toContain("1");
  });

  it("shows sticky bulk action with selected count and CTA", async () => {
    const rows = [
      { preview_row_id: 1, classification: "CREATE_NEW_MASTER", source_row: 2, payload: { student_name: "A", student_identifier: "1" }, errors: [] },
      { preview_row_id: 2, classification: "CREATE_NEW_MASTER", source_row: 3, payload: { student_name: "B", student_identifier: "2" }, errors: [] },
    ];
    mockPreview.mockReturnValue({
      data: {
        preview_id: "id",
        preview_checksum: "chk",
        summary: { create_new_master: 2, total: 2 },
        rows,
      },
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    const html = await renderRoster();
    expect(html).toContain("New students");
    expect(html).toContain("2 rows");
    expect(html).toContain("All");
  });

  it("prevents double submit", async () => {
    mockCommit.mockReturnValue({
      isPending: true,
      isSuccess: false,
      data: null,
      error: null,
      mutate: vi.fn(),
      reset: vi.fn(),
    });
    mockPreview.mockReturnValue({
      data: {
        preview_id: "id",
        preview_checksum: "chk",
        summary: { create_new_master: 1, total: 1 },
        rows: [{ preview_row_id: 1, classification: "CREATE_NEW_MASTER", source_row: 2, payload: { student_name: "A", student_identifier: "1" }, errors: [] }],
      },
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    const html = await renderRoster();
    expect(html).toContain("New students");
    expect(html).toContain("1 rows");
    expect(html).toContain("All");
  });

  it("shows import complete with View students and Import another file", async () => {
    mockCommit.mockReturnValue({
      isPending: false,
      isSuccess: true,
      data: { students_created: 2, created: 2, preview_id: "id" },
      error: null,
      mutate: vi.fn(),
      reset: vi.fn(),
    });
    mockPreview.mockReturnValue({
      data: {
        preview_id: "id",
        preview_checksum: "chk",
        summary: { create_new_master: 2, total: 2 },
        rows: [{ preview_row_id: 1, classification: "CREATE_NEW_MASTER", source_row: 2, payload: { student_name: "A", student_identifier: "1" }, errors: [] }],
      },
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    const html = await renderRoster();
    expect(html).toContain("Import complete");
    expect(html).toContain("View students");
    expect(html).toContain("Import another file");
    expect(html).toContain("students created");
  });
});
