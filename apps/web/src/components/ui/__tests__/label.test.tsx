import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Label } from "../label";

describe("Label", () => {
  it("renders a native label associated with its control", () => {
    const html = renderToStaticMarkup(<Label htmlFor="student-name">Student name</Label>);

    expect(html).toContain("<label");
    expect(html).toContain('for="student-name"');
    expect(html).toContain(">Student name</label>");
  });
});
