import * as XLSX from "@e965/xlsx";

const rows = [
  ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"],
  [9001, "Andi", "17/06/2026", "07:30", "16:00", "00:25", "", "", "25"],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Attendance");
process.stdout.write(Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" })));
