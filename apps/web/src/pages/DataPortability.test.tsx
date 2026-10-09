import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import DataPortability from "./DataPortability";
import * as dataPortabilityApi from "../api/dataPortability";

describe("DataPortability panel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the existing portability capabilities without a duplicate page heading", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DataPortability initialLoading={false} embedded />
      </MemoryRouter>
    );

    expect(html).not.toContain("<h1");
    expect(html).toContain("Export Data");
    expect(html).toContain("Import Data");
    expect(html).toContain("Templates");
    expect(html).toContain("History");
    expect(html).toContain("CSV data exchange files are for spreadsheet review");
    expect(html).toContain("NOT");
    expect(html).toContain("complete system backup");
    expect(html).toContain('href="/settings/backups"');
  });

  it("keeps enrollment export while hiding unavailable import and template actions", async () => {
    vi.spyOn(dataPortabilityApi, "fetchDatasets").mockResolvedValue([
      { identifier: "student_roster", format_version: "operatoros_csv_v1", required_columns: ["student_id"], optional_columns: [], export_eligible: true, import_eligible: true, requires_sensitive_capability: false, has_sensitive_access: false, update_policy: "safe_upsert_with_preview" },
      { identifier: "student_enrollment", format_version: "operatoros_csv_v1", required_columns: ["student_id"], optional_columns: [], export_eligible: true, import_eligible: false, requires_sensitive_capability: false, has_sensitive_access: false, update_policy: "prohibited" },
    ]);
    vi.spyOn(dataPortabilityApi, "previewExport").mockResolvedValue({ dataset: "student_roster", format_version: "operatoros_csv_v1", estimated_row_count: 2, sensitive_fields_included: false, allowed: true, warnings: [], maximum_permitted_rows: 5000 });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<MemoryRouter><DataPortability initialLoading={false} embedded /></MemoryRouter>);
      });
      expect(container.textContent).toContain("STUDENT ENROLLMENT (Export Only)");

      const tab = (name: string) => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(name))!;
      await act(async () => tab("Import Data").click());
      expect(Array.from(container.querySelectorAll<HTMLOptionElement>("select option")).map((option) => option.value)).toEqual(["student_roster"]);

      await act(async () => tab("Templates").click());
      expect(container.querySelector('a[href="/api/data-portability/templates/student_enrollment"]')).toBeNull();
      expect(container.querySelector('a[href="/api/data-portability/templates/student_roster"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
