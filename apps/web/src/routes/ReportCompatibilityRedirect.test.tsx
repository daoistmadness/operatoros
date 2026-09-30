import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ReportCompatibilityRedirect } from "./ReportCompatibilityRedirect";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
function Destination() { const location = useLocation(); return <output>{location.pathname}{location.search}{location.hash}</output>; }

afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; container = undefined; });

describe("formal report compatibility routes", () => {
  it("preserves Term Review deep-link filters and selects the canonical view", async () => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<MemoryRouter initialEntries={["/analytics/management-review/student-profile?academic_year_id=4&term_id=9#attendance"]}><Routes>
      <Route path="/analytics/management-review/student-profile" element={<ReportCompatibilityRedirect view="term-review" />} />
      <Route path="/reports" element={<Destination />} />
    </Routes></MemoryRouter>));
    const destination = new URL(container.querySelector("output")!.textContent!, "http://local");
    expect(destination.pathname).toBe("/reports");
    expect(destination.searchParams.get("academic_year_id")).toBe("4");
    expect(destination.searchParams.get("term_id")).toBe("9");
    expect(destination.searchParams.get("view")).toBe("term-review");
    expect(destination.hash).toBe("#attendance");
  });
});
