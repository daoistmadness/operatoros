import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceCompatibilityRedirect } from "./AttendanceCompatibilityRedirect";

function LocationText() {
  const location = useLocation();
  return <output data-path={location.pathname} data-search={location.search} data-hash={location.hash} />;
}

describe("AttendanceCompatibilityRedirect", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it.each([
    ["/reports/attendance", "report"],
    ["/reports/rekap-absensi", "recap"],
    ["/reports/tardiness", "tardiness"],
  ] as const)("maps %s and retains filter parameters and the fragment", async (path, view) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <MemoryRouter initialEntries={[`${path}?academic_year_id=7&month=2026-08#summary`]}>
        <Routes>
          <Route path={path} element={<AttendanceCompatibilityRedirect view={view} />} />
          <Route path="/analytics/attendance" element={<LocationText />} />
        </Routes>
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container?.querySelector("output")?.dataset.path).toBe("/analytics/attendance"));
    const destination = container.querySelector("output");
    expect(new URLSearchParams(destination?.dataset.search).get("view")).toBe(view);
    expect(new URLSearchParams(destination?.dataset.search).get("academic_year_id")).toBe("7");
    expect(new URLSearchParams(destination?.dataset.search).get("month")).toBe("2026-08");
    expect(destination?.dataset.hash).toBe("#summary");
  });
});
