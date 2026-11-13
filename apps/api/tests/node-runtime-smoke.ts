import { createWorkbook, readXlsxWorkbook, writeXlsxWorkbook, readLegacyXlsRows, writeLegacyXlsRows } from "@operatoros/excel";
import { readAttendanceWorkbook, REQUIRED_COLUMNS } from "../src/import/excel-reader";

const workbook = createWorkbook({ exportType: "node-image-smoke" });
const sheet = workbook.addWorksheet("Synthetic");
sheet.addRow(["student_identifier", "student_name"]);
sheet.addRow(["SYN-001", "Synthetic Student"]);
const xlsx = await readXlsxWorkbook(await writeXlsxWorkbook(workbook));
if (xlsx.sheets[0]?.rows[0]?.values[1] !== "Synthetic Student") throw new Error("XLSX round trip failed");

const xls = readLegacyXlsRows(
  writeLegacyXlsRows([["SYN-001", "Synthetic Student"]], ["student_identifier", "student_name"], "Synthetic"),
);
if (xls.rows[0]?.[1] !== "Synthetic Student") throw new Error("legacy XLS round trip failed");

const attendanceWorkbook = createWorkbook({ exportType: "node-worker-smoke" });
const attendanceSheet = attendanceWorkbook.addWorksheet("Attendance");
attendanceSheet.addRow([...REQUIRED_COLUMNS]);
for (let id = 1; id <= 5000; id++) {
  attendanceSheet.addRow([id, `Synthetic Student ${id}`, "12/11/2026", "07:00", "13:00", 0, 0, "", "week-1"]);
}
const attendanceBuffer = await writeXlsxWorkbook(attendanceWorkbook);
if (attendanceBuffer.byteLength < 64 * 1024) throw new Error("Attendance fixture did not exercise the worker threshold");
const attendanceArrayBuffer = new Uint8Array(attendanceBuffer).buffer as ArrayBuffer;
const parsed = await readAttendanceWorkbook(attendanceArrayBuffer, "attendance.xlsx");
if (parsed.rows.length !== 5000) {
  throw new Error(`Node attendance parser worker returned ${parsed.rows.length} valid rows, ${parsed.invalidRows.length} invalid rows, and ${parsed.totalRows} total rows`);
}

console.log("PASS Node XLSX, legacy XLS, and attendance parser worker smoke checks");
