import { expect, test } from "bun:test";
import { createBundleReport, findRouteBudgetViolations } from "./frontend-bundle-report.mjs";

const manifest = {
  "src/routes/_authenticated/analytics.tsx?tsr-split=component": {
    file: "assets/ManagementAnalytics.js",
    isDynamicEntry: true,
    imports: ["src/shared.js"],
  },
  "src/routes/_authenticated/upload-center.tsx?tsr-split=component": {
    file: "assets/UploadCenter.js",
    isDynamicEntry: true,
    imports: ["src/shared.js"],
  },
  "src/components/charts/AttendanceStatusChart.tsx": {
    file: "assets/AttendanceStatusChart.js",
    isDynamicEntry: true,
    imports: [],
  },
  "src/shared.js": {
    file: "assets/shared.js",
    isEntry: false,
    imports: [],
  },
};

const assets = new Map([
  ["assets/ManagementAnalytics.js", Buffer.from("management")],
  ["assets/UploadCenter.js", Buffer.from("upload")],
  ["assets/AttendanceStatusChart.js", Buffer.from("chart")],
  ["assets/shared.js", Buffer.from("shared")],
]);

test("reports page entry bytes and a deduplicated static import closure", () => {
  const report = createBundleReport(manifest, (file) => assets.get(file));
  const management = report.routeEntries.find(({ source }) => source === "src/routes/_authenticated/analytics.tsx?tsr-split=component");

  expect(report.routeEntries).toHaveLength(2);
  expect(management?.rawBytes).toBe(Buffer.byteLength("management"));
  expect(management?.staticClosure.rawBytes).toBe(Buffer.byteLength("managementshared"));
  expect(report.javascriptFileCount).toBe(4);
});

test("checks raw and gzip page entry limits", () => {
  const oversized = [
    { source: "src/routes/LargeRawRoute.tsx?tsr-split=component", rawBytes: 160_001, gzipBytes: 20_000 },
    { source: "src/routes/LargeGzipRoute.tsx?tsr-split=component", rawBytes: 40_000, gzipBytes: 40_001 },
  ];
  expect(findRouteBudgetViolations(oversized, { rawBytes: 160_000, gzipBytes: 40_000 })).toEqual(oversized);
});
