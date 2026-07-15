import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function pageSource(filename) {
  return fs.readFileSync(path.resolve(process.cwd(), "src/pages", filename), "utf8");
}

describe("legacy page API contracts", () => {
  it.each([
    ["ClassMapping.js", [
      'api.get("/api/students/classes")',
      'api.get("/api/students"',
      'api.post("/api/students"',
      'api.patch("/api/students/assign-class"',
    ]],
    ["UploadHistory.js", ['api.get("/api/uploads/history")']],
    ["JenjangConfig.jsx", [
      'api.get("/api/config/jenjang")',
      'api.get("/api/config/jenjang/available")',
      'api.put(`/api/config/jenjang/',
      'api.delete(`/api/config/jenjang/',
    ]],
    ["HebConfig.jsx", [
      'api.get("/api/config/jenjang/available")',
      'api.get("/api/analytics/heb"',
      'api.put(`/api/config/heb/',
      'api.delete(`/api/config/heb/',
    ]],
    ["AbsenceReasons.jsx", [
      'api.get("/api/config/absence-reasons"',
      'api.get("/api/analytics/attendance-date-range")',
      'api.post("/api/config/absence-reasons/bulk"',
    ]],
  ])("uses canonical load and mutation routes in %s", (filename, expectedCalls) => {
    const source = pageSource(filename);
    for (const call of expectedCalls) expect(source).toContain(call);
  });
});
