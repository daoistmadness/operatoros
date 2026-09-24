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

const roster = createWorkbook({ exportType: "e2e-roster-preview-fixture" });
const rosterSheet = addWorksheet(roster, "Roster");
appendRow(rosterSheet, ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"]);
appendRow(rosterSheet, ["999990120", "E2E Roster Preview Student", "2026/2027", "Primary", "P1A", "Primary", "active"]);
appendRow(rosterSheet, ["999990121", "E2E Roster P1B Student", "2026/2027", "Primary", "P1B", "Primary", "active"]);
appendRow(rosterSheet, ["999990122", "E2E Roster Unknown Student", "2026/2027", "Primary", "P1C", "Primary", "active"]);
appendRow(rosterSheet, ["999990123", "E2E Roster Inactive Student", "2026/2027", "Primary", "P1D", "Primary", "active"]);
appendRow(rosterSheet, ["999990124", "E2E Roster Conflict Student", "2026/2027", "Primary", "P1A", "MAIN", "active"]);
appendRow(rosterSheet, ["999990125", "E2E Roster Ambiguous Student", "2026/2027", "Primary", "P1a", "Primary", "active"]);
await Bun.write(join(directory, "student-roster.xlsx"), await writeXlsxWorkbook(roster));
