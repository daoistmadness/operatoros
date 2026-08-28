import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { addWorksheet, appendRow, createWorkbook, writeXlsxWorkbook } from "../src/index";
import { writeLegacyXlsRows } from "../src/legacy";

const [directory, date] = Bun.argv.slice(2);
if (!directory || !date) throw new Error("fixture directory and date are required");
mkdirSync(directory, { recursive: true });

const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];
const row = ["100001", "E2E Ada", date, "07:10", "14:00", "", "", "", "Wednesday"];

const xlsx = createWorkbook({ exportType: "e2e-fixture" });
const xlsxSheet = addWorksheet(xlsx, "Attendance Export");
appendRow(xlsxSheet, headers);
appendRow(xlsxSheet, row);
await Bun.write(join(directory, "attendance.xlsx"), await writeXlsxWorkbook(xlsx));

await Bun.write(join(directory, "attendance.xls"), writeLegacyXlsRows([row], headers, "Attendance Export"));
