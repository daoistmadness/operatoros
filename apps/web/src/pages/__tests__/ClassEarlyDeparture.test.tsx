import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ClassEarlyDeparture } from "../ClassEarlyDeparture";
import { DismissalPolicies } from "../DismissalPolicies";

vi.mock("../../lib/api/client", () => ({
  apiRequest: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../api/earlyDeparture", () => ({
  getDeparturePolicies: vi.fn(() => Promise.resolve([])),
  createDeparturePolicy: vi.fn(),
  deactivateDeparturePolicy: vi.fn(),
  getClassDateDepartures: vi.fn(() => Promise.resolve({ class_id: "7A", date: "2026-07-24", departures: [] })),
  recordDepartureExcuse: vi.fn(),
  revokeDepartureExcuse: vi.fn(),
  getDepartureHistory: vi.fn(),
}));

vi.mock("../../api/teacherClassAssignments", () => ({
  fetchAssignedClasses: vi.fn(() => Promise.resolve([{ id: 1, class_name: "Kelas 7A" }])),
}));

vi.mock("../../api/enrollment", () => ({
  fetchJenjangs: vi.fn(() => Promise.resolve([{ name: "Primary" }])),
}));

const renderHtml = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("ClassEarlyDeparture Workspace Component", () => {
  it("renders header and student status title", () => {
    const html = renderHtml(<ClassEarlyDeparture />);
    expect(html).toContain("Workspace Kepulangan Awal Siswa");
    expect(html).toContain("Status Kepulangan Siswa");
  });
});

describe("DismissalPolicies Component", () => {
  it("renders header and form title", () => {
    const html = renderHtml(<DismissalPolicies />);
    expect(html).toContain("Pengaturan Jam Pulang Sekolah");
    expect(html).toContain("Tambah Kebijakan Jam Pulang Baru");
  });
});
