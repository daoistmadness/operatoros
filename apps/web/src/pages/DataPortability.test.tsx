import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import DataPortability from "./DataPortability";

describe("DataPortability panel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

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
});
