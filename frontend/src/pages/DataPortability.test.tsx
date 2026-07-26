import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import DataPortability from "./DataPortability";

describe("DataPortability Page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders tab controls and warning banner separating CSV from Backup", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DataPortability initialLoading={false} />
      </MemoryRouter>
    );

    expect(html).toContain("Data Import &amp; Export Center");
    expect(html).toContain("Export Data");
    expect(html).toContain("Import Data");
    expect(html).toContain("Templates");
    expect(html).toContain("History");
    expect(html).toContain("CSV data exchange files are for spreadsheet review");
    expect(html).toContain("NOT");
    expect(html).toContain("complete system backup");
  });
});
