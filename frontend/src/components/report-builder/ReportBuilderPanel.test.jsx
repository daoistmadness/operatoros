import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReportBuilderPanel, { moveSection } from "./ReportBuilderPanel";

const mockReact = React;

vi.mock("lucide-react", () => {
  const MockIcon = (props) => React.createElement("span", { ...props, "data-icon": "mock" });
  return {
    ArrowDown: MockIcon,
    ArrowUp: MockIcon,
    Copy: MockIcon,
    Eye: MockIcon,
    Loader2: MockIcon,
    Palette: MockIcon,
    Plus: MockIcon,
    RefreshCw: MockIcon,
    Save: MockIcon,
    Settings2: MockIcon,
    Trash2: MockIcon,
    WandSparkles: MockIcon,
  };
});

vi.mock("../../api/reportBuilder", () => ({
  createReportBranding: vi.fn(),
  createReportTemplate: vi.fn(),
  deleteReportTemplate: vi.fn(),
  fetchReportBranding: vi.fn().mockResolvedValue({ items: [], default: null, resolved_default: null }),
  fetchReportSections: vi.fn().mockResolvedValue({
    executive_summary: {
      label: "Executive Summary",
      description: "High-level KPI cards and report context.",
      supports_pdf: true,
      supports_excel: true,
      default_enabled: true,
    },
    attendance: {
      label: "Attendance",
      description: "Attendance breakdown and summary tables.",
      supports_pdf: true,
      supports_excel: true,
      default_enabled: true,
    },
  }),
  fetchReportTemplates: vi.fn().mockResolvedValue([]),
  previewReportBuilder: vi.fn(),
  updateReportBranding: vi.fn(),
  updateReportTemplate: vi.fn(),
}));

describe("ReportBuilderPanel", () => {
  it("renders the report builder shell", () => {
    const markup = renderToStaticMarkup(<ReportBuilderPanel />);
    expect(markup).toContain("Report Builder");
    expect(markup).toContain("Operator templates and branding");
  });

  it("moves sections deterministically", () => {
    expect(moveSection(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveSection(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveSection(["a", "b", "c"], "x", "down")).toEqual(["a", "b", "c"]);
  });
});
