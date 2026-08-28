import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { UploadHistoryPanel } from "./UploadHistoryPanel";


describe("UploadHistoryPanel", () => {
  it("renders filters and safe read-only guidance", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <UploadHistoryPanel />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("Upload History");
    expect(html).toContain("Read-only evidence");
    expect(html).toContain("All workflows");
    expect(html).toContain("All states");
    expect(html).not.toContain("Replay upload");
    expect(html).not.toContain("Undo commit");
    expect(html).not.toContain("Recommit all");
  });
});
