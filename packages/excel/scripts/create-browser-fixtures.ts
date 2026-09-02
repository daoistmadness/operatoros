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

const machineHeaders = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Absent", "Lembur", "Pengecualian", "week"];
const machine = createWorkbook({ exportType: "e2e-machine-preview-fixture" });
const machineSheet = addWorksheet(machine, "Machine Attendance");
appendRow(machineSheet, machineHeaders);
for (const machineRow of [
  ["100001", "E2E Ada", date, "07:10", "14:00", "", "", "", "", "Tuesday"],
  ["100001", "E2E Ada", "10/08/2026", "07:10", "14:00", "", "", "", "", "Monday"],
  ["100001", "E2E Ada", "08/08/2026", "", "", "", "", "", "", "Saturday"],
  ["100001", "E2E Ada", "14/12/2026", "", "", "", "", "", "", "Monday"],
  ["100001", "E2E Ada", "15/12/2026", "", "", "", "", "", "", "Tuesday"],
  ["999999", "E2E Unmapped", "08/08/2026", "07:15", "14:00", "", "", "", "", "Saturday"],
  ["999998", "E2E New Machine Student", "08/08/2026", "07:20", "14:00", "", "", "", "", "Saturday"],
]) appendRow(machineSheet, machineRow);
await Bun.write(join(directory, "machine-attendance.xlsx"), await writeXlsxWorkbook(machine));

await Bun.write(join(directory, "attendance.xls"), writeLegacyXlsRows([row], headers, "Attendance Export"));
