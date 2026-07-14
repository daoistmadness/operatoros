import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../lib/query/queryClient";
import SetupAdmin from "./SetupAdmin";

function render(required: boolean) {
  return renderToStaticMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter><SetupAdmin setupTokenRequired={required} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("first administrator setup screen", () => {
  it("renders labeled password confirmation and accessible visibility control", () => {
    const html = render(false);
    expect(html).toContain("Create administrator");
    expect(html).toContain('aria-label="Administrator username"');
    expect(html).toContain('aria-label="Confirm password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).not.toContain("Deployment setup token");
  });

  it("shows the deployment token only when the status requires it", () => {
    const html = render(true);
    expect(html).toContain("Deployment setup token");
    expect(html).toContain('aria-label="Deployment setup token"');
  });
});
