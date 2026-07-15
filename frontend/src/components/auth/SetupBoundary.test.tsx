import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/query/queryClient";
import { queryKeys } from "../../lib/query/queryKeys";
import { SetupBoundary } from "./SetupBoundary";

function render(status?: { setup_required: boolean; setup_token_required: boolean }) {
  const client = createTestQueryClient();
  if (status) client.setQueryData(queryKeys.setup.status, status);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter><SetupBoundary><div>Normal authentication</div></SetupBoundary></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("setup bootstrap boundary", () => {
  it("shows setup-status loading before login/auth content", () => {
    const html = render();
    expect(html).toContain("Checking OperatorOS setup");
    expect(html).not.toContain("Normal authentication");
  });

  it("shows setup and hides normal authentication on a fresh database", () => {
    const html = render({ setup_required: true, setup_token_required: false });
    expect(html).toContain("Create administrator");
    expect(html).not.toContain("Normal authentication");
  });

  it("continues normal authentication after setup closes", () => {
    expect(render({ setup_required: false, setup_token_required: false })).toContain("Normal authentication");
  });
});
