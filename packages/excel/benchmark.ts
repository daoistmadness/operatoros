import { performance } from "node:perf_hooks";
import { addWorksheet, appendRow, createWorkbook, writeXlsxWorkbook } from "./src/index";

for (const rows of [1_000, 10_000]) {
  const started = performance.now();
  const workbook = createWorkbook({ exportType: "benchmark" });
  const sheet = addWorksheet(workbook, "Data");
  appendRow(sheet, ["Student ID", "Value", "Date"]);
  for (let index = 1; index <= rows; index += 1) appendRow(sheet, [index, index / 10, "2026-08-29"]);
  const bytes = await writeXlsxWorkbook(workbook);
  console.log(JSON.stringify({ rows, sheets: workbook.worksheets.length, bytes: bytes.byteLength, elapsedMs: Number((performance.now() - started).toFixed(1)) }));
}

console.log("EXCEL_STREAMING_DECISION=NOT_REQUIRED");
