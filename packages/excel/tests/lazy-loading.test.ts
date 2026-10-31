import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("@operatoros/excel lazy loading & golden parity", () => {
  it("keeps SheetJS unloaded during normal XLSX execution and matches golden JSON on legacy XLS read", () => {
    const workerScript = `
      import { createWorkbook, writeXlsxWorkbook, readLegacyXlsRows } from "@operatoros/excel";
      import { readFileSync } from "node:fs";
      import path from "node:path";

      function getLoadedSheetJsModules() {
        return Object.keys(require.cache).filter(
          (k) => k.includes("sheetjs-fork") || k.includes("@e965")
        );
      }

      // 1. Initial import of @operatoros/excel must NOT load SheetJS
      if (getLoadedSheetJsModules().length > 0) {
        console.error("SheetJS eagerly loaded on import:", getLoadedSheetJsModules());
        process.exit(1);
      }

      // 2. Normal XLSX workbook generation must NOT load SheetJS
      const wb = createWorkbook();
      const ws = wb.addWorksheet("Test");
      ws.addRow(["A", 1]);
      await writeXlsxWorkbook(wb);

      if (getLoadedSheetJsModules().length > 0) {
        console.error("SheetJS loaded during XLSX workflow:", getLoadedSheetJsModules());
        process.exit(2);
      }

      // 3. Legacy XLS reading triggers lazy load
      const fixturePath = path.resolve("./packages/excel/tests/fixtures/legacy-attendance.xls");
      const bytes = readFileSync(fixturePath);
      const parsed = readLegacyXlsRows(bytes);

      const loadedAfter = getLoadedSheetJsModules();
      if (!loadedAfter.some((k) => k.includes("sheetjs-fork"))) {
        console.error("sheetjs-fork was not loaded in require.cache after readLegacyXlsRows");
        process.exit(3);
      }
      if (loadedAfter.some((k) => k.includes("@e965"))) {
        console.error("@e965/xlsx appeared in require.cache after dependency swap");
        process.exit(4);
      }

      // 4. Parity verification against structural golden snapshot
      function serializeCell(val) {
        if (val === null) return { $t: "null" };
        if (val === undefined) return { $t: "undefined" };
        if (val instanceof Date) return { $t: "date", v: val.toISOString() };
        if (typeof val === "number") {
          if (!Number.isFinite(val)) throw new Error("Non-finite number encountered");
          return { $t: "number", v: val };
        }
        if (typeof val === "boolean") return { $t: "bool", v: val };
        if (typeof val === "string") return { $t: "string", v: val };
        throw new Error("Unexpected cell type in serializer: " + typeof val);
      }

      const serialized = {
        sheetName: parsed.sheetName,
        headers: parsed.headers.map(serializeCell),
        rows: parsed.rows.map((row) => row.map(serializeCell)),
      };

      const goldenPath = path.resolve("./packages/excel/tests/fixtures/legacy-attendance.golden.json");
      const goldenText = readFileSync(goldenPath, "utf8");
      const currentText = JSON.stringify(serialized, null, 2) + "\\n";

      if (currentText !== goldenText) {
        console.error("Parsed structural output does not match golden snapshot exactly");
        process.exit(5);
      }

      process.exit(0);
    `;

    const res = spawnSync("bun", ["-e", workerScript], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      encoding: "utf8",
    });

    if (res.status !== 0) {
      console.error(res.stderr || res.stdout);
    }
    expect(res.status).toBe(0);
  });
});
