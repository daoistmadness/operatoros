import { mkdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "../../backend-ts/node_modules/exceljs";
import * as XLSX from "../../backend-ts/node_modules/@e965/xlsx";

const [directory, date] = Bun.argv.slice(2);
if (!directory || !date) throw new Error("fixture directory and date are required");
mkdirSync(directory, { recursive: true });

const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];
const row = ["100001", "E2E Ada", date, "07:10", "14:00", "", "", "", "Wednesday"];

const xlsx = new ExcelJS.Workbook();
const xlsxSheet = xlsx.addWorksheet("Attendance Export");
xlsxSheet.addRow(headers);
xlsxSheet.addRow(row);
await xlsx.xlsx.writeFile(join(directory, "attendance.xlsx"));

const xlsSheet = XLSX.utils.aoa_to_sheet([headers, row]);
const xls = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(xls, xlsSheet, "Attendance Export");
await Bun.write(join(directory, "attendance.xls"), XLSX.write(xls, { bookType: "biff8", type: "buffer" }) as Uint8Array);
