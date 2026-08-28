import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Button } from "@operatoros/ui/components/button";

describe("workspace UI package", () => {
  test("web resolves and renders a package component", () => {
    const markup = renderToStaticMarkup(<Button className="consumer-proof">Workspace button</Button>);

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain("consumer-proof");
    expect(markup).toContain("Workspace button");
  });
});
