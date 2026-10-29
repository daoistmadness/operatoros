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
    const loading = renderToStaticMarkup(<LoadingState title="Loading" />);
    const error = renderToStaticMarkup(<ErrorState title="Failed" />);
    const empty = renderToStaticMarkup(<EmptyState title="Empty" />);

    expect(loading).toContain('role="status"');
    expect(loading).toContain("motion-safe:animate-spin");
    expect(error).toContain('role="alert"');
    expect(error).toContain("bg-danger-surface");
    expect(empty).toContain("Empty");
    expect(empty).toContain("bg-surface-muted");
  });

  it("preserves semantic table headers", () => {
    const html = renderToStaticMarkup(<DataTableContainer><DataTable><DataTableHeader><DataTableRow><DataTableHead>Name</DataTableHead></DataTableRow></DataTableHeader><DataTableBody><DataTableRow><DataTableCell>Ada</DataTableCell></DataTableRow></DataTableBody></DataTable></DataTableContainer>);
    expect(html).toContain('scope="col"');
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
  });
});
