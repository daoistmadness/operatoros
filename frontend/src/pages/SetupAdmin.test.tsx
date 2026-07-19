import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../lib/query/queryClient";
import SetupAdmin from "./SetupAdmin";

function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter><SetupAdmin /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("first administrator setup screen", () => {
  it("renders labeled password confirmation and accessible visibility control", () => {
    const html = render();
    expect(html).toContain("Create administrator");
    expect(html).toContain('aria-label="Administrator username"');
    expect(html).toContain('aria-label="Confirm password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).not.toContain("Deployment setup token");
  });

  it("never renders deployment authorization as a user field", () => {
    const html = render();
    expect(html).not.toContain("Deployment setup token");
    expect(html).toContain("This local installation is authorized for initial setup.");
  });
});
