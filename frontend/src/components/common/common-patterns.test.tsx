import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, DataTableBody, DataTableCell, DataTableContainer, DataTableHead, DataTableHeader, DataTableRow } from "./data-table";
import { ActionGroup, FilterBar } from "./filter-bar";
import { PageHeader } from "./page-header";
import { EmptyState, ErrorState, LoadingState } from "./state-message";

describe("shared application patterns", () => {
  it("renders one semantic page heading and labeled actions", () => {
    const html = renderToStaticMarkup(<PageHeader title="Backups" description="Manage local backups" actions={<button>Run</button>} />);
    expect(html).toContain("<h1");
    expect(html).toContain('aria-label="Page actions"');
  });

  it("labels filter and action regions", () => {
    const html = renderToStaticMarkup(<FilterBar><ActionGroup><button>Apply</button></ActionGroup></FilterBar>);
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain('role="group"');
  });

  it("exposes loading and errors to assistive technology", () => {
    expect(renderToStaticMarkup(<LoadingState title="Loading" />)).toContain('role="status"');
    expect(renderToStaticMarkup(<ErrorState title="Failed" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<EmptyState title="Empty" />)).toContain("Empty");
  });

  it("preserves semantic table headers", () => {
    const html = renderToStaticMarkup(<DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Name</DataTableHead></DataTableRow></DataTableHeader><DataTableBody><DataTableRow><DataTableCell>Ada</DataTableCell></DataTableRow></DataTableBody></DataTable></DataTableContainer>);
    expect(html).toContain('scope="col"');
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
  });
});
