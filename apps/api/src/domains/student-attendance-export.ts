import { addWorksheet, appendRow, autoSizeColumns, createWorkbook, safeExportFilename, styleHeader, writeXlsxWorkbook } from "@operatoros/excel";
import { randomUUID } from "node:crypto";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;
type Context = any;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function error(set: any, status: number, detail: string): { detail: string } {
  set.status = status;
  return { detail };
}

function audit(context: AuthContext, user: { username: string; role: string }, operation: string, scope: string, success: boolean, metadata: Row): void {
  context.database.client.run(
    "INSERT INTO operations_audit_events (event_id, actor_id, actor_role, capability, entity_type, entity_reference, operation, risk_level, source, export_scope, success, failure_code, metadata, schema_version) VALUES (?, ?, ?, 'export_student_data', 'STUDENT_EXPORT', ?, ?, 'MEDIUM', 'API', ?, ?, NULL, ?, '1')",
    [randomUUID(), user.username, user.role, `EXPORT_${scope}`, operation, scope, success ? 1 : 0, JSON.stringify(metadata)],
  );
}

function effectiveRows(context: AuthContext, studentIds: number[], month: string | null, year: string | null): Row[] {
  const placeholders = studentIds.map(() => "?").join(",");
  const filters: string[] = [`a.student_id IN (${placeholders})`];
  const params: unknown[] = [...studentIds];
  if (month !== null && year !== null) {
    filters.push("strftime('%m', a.date) = ?", "strftime('%Y', a.date) = ?");
    params.push(month, year);
  }
  return rows(
    context,
    `SELECT a.id, a.student_id, a.date, a.check_in, a.check_out, a.late_duration, a.status AS raw_status,
            o.override_status, o.override_check_in, o.override_check_out, o.note, o.reviewed_by
       FROM attendance a
       LEFT JOIN attendance_overrides o ON o.attendance_id = a.id
      WHERE ${filters.join(" AND ")}
      ORDER BY a.date, a.id`,
    params,
  );
}

function lateDurationMinutes(value: Row): number {
  return Number(value.late_duration ?? 0);
}

function effectiveStatus(value: Row): string {
  if (value.override_status) return String(value.override_status);
  const checkIn = value.check_in !== null && value.check_in !== undefined;
  const checkOut = value.check_out !== null && value.check_out !== undefined;
  if (checkIn && checkOut) return lateDurationMinutes(value) > 0 ? "late" : "on-time";
  if (checkIn !== checkOut) return "incomplete";
  return "absent";
}

function clockText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 5);
}

function lateText(value: Row): string {
  const minutes = lateDurationMinutes(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function monthKey(date: unknown): string {
  return String(date).slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${String(month).padStart(2, "0")}/${year}`;
}

function hebValue(context: AuthContext, jenjang: string, key: string, observed: number): number {
  const [year, month] = key.split("-").map(Number);
  const override = rows(context, "SELECT heb_value FROM heb_overrides WHERE jenjang = ? AND month = ? AND year = ?", [jenjang, month, year]);
  if (override.length && override[0]) return Number(override[0].heb_value);
  return observed;
}

export function studentAttendanceExportRoutes(app: any, context: AuthContext): void {
  app.get("/api/student-masters/:student_master_id/attendance-history/export-excel", async (ctx: Context) => {
    const { set, params, query } = ctx;
    const user = actor(context, ctx, { capability: "export_student_data" });
    if (!user) return { detail: "Insufficient permissions" };
    const month = query.month === undefined ? null : String(query.month).padStart(2, "0");
    const year = query.year === undefined ? null : String(query.year);
    if ((month === null) !== (year === null)) return error(set, 400, "month and year must be provided together");
    if (month !== null && (Number(month) < 1 || Number(month) > 12)) return error(set, 400, "month must be between 1 and 12");
    if (year !== null && !/^\d{4}$/.test(year)) return error(set, 400, "year must be a four-digit year");
    if (month !== null && Number(year) < 2020) return error(set, 400, "year must be greater than or equal to 2020");

    const client = context.database.client;
    const master = row(context, params.student_master_id);
    if (!master) return error(set, 404, "Student master not found");
    const students = rows(context, "SELECT s.id, s.name, s.class_name, s.jenjang FROM students s JOIN student_device_identities d ON d.legacy_student_id = s.id WHERE d.student_master_id = ? AND d.is_active = 1 GROUP BY s.id", [params.student_master_id]);
    const studentIds = students.map((value) => Number(value.id));
    const values = effectiveRows(context, studentIds, month, year);
    if (!students.length) return error(set, 404, "No active attendance identity is linked to this student");
    const primary = students[0] as Row;
    const jenjang = String(primary.jenjang || primary.class_name || "Unassigned");
    const studentName = String(master.full_name ?? primary.name ?? "student");

    const periods = [...new Set(values.map((value) => monthKey(value.date)))].sort();
    const recap = periods.map((key) => {
      const monthValues = values.filter((value) => monthKey(value.date) === key);
      const status = (predicate: (value: Row) => boolean) => monthValues.filter(predicate).length;
      const present = status((value) => effectiveStatus(value) === "on-time");
      const late = status((value) => effectiveStatus(value) === "late");
      const incomplete = status((value) => effectiveStatus(value) === "incomplete");
      const absent = status((value) => effectiveStatus(value) === "absent");
      const attended = monthValues.filter((value) => effectiveStatus(value) !== "absent").length;
      const heb = hebValue(context, jenjang, key, attended);
      const reason = rows(context, "SELECT COALESCE(SUM(sakit),0) AS sakit, COALESCE(SUM(izin),0) AS izin, COALESCE(SUM(alfa),0) AS alfa FROM absence_reasons WHERE student_id IN (" + studentIds.map(() => "?").join(",") + ") AND month = ? AND year = ?", [...studentIds, Number(key.slice(5, 7)), Number(key.slice(0, 4))])[0];
      return {
        month_key: key,
        month_label: monthLabel(key),
        present, late, incomplete, absent,
        sakit: Number(reason?.sakit ?? 0),
        izin: Number(reason?.izin ?? 0),
        alfa: Number(reason?.alfa ?? 0),
        heb,
        attendance_rate: heb > 0 ? Number(((present + late) / heb).toFixed(3)) : null,
      };
    });

    const workbook = createWorkbook({ exportType: "student-attendance-history" });
    const recapSheet = addWorksheet(workbook, "Rekap Bulanan");
    appendRow(recapSheet, ["Bulan", "Hadir", "Terlambat", "Tidak Lengkap", "Absen", "Sakit", "Izin", "Alfa", "HEB", "Tingkat Kehadiran"]);
    for (const item of recap) {
      appendRow(recapSheet, [item.month_label, item.present, item.late, item.incomplete, item.absent, item.sakit, item.izin, item.alfa, item.heb, item.attendance_rate ?? ""]);
    }
    styleHeader(recapSheet);
    autoSizeColumns(recapSheet, 10, 22);

    if (month !== null && year !== null) {
      const detailSheet = addWorksheet(workbook, "Rincian Harian");
      appendRow(detailSheet, ["Tanggal", "Status", "Jam Masuk", "Jam Pulang", "Terlambat", "Koreksi Manual", "Catatan", "Direview Oleh"]);
      for (const value of values) {
        appendRow(detailSheet, [
          value.date,
          effectiveStatus(value),
          clockText(value.override_check_in ?? value.check_in),
          clockText(value.override_check_out ?? value.check_out),
          lateText(value),
          value.override_status ? "Ya" : "Tidak",
          value.note ?? "",
          value.reviewed_by ?? "",
        ]);
      }
      styleHeader(detailSheet);
      autoSizeColumns(detailSheet, 10, 24);
    }

    const bytes = await writeXlsxWorkbook(workbook);
    const periodLabel = month !== null && year !== null ? `${month}_${year}` : "semua";
    audit(context, user, "EXPORT_STUDENT_ATTENDANCE_HISTORY", `STUDENT_ATTENDANCE_HISTORY/${String(params.student_master_id)}`, true, {
      student_master_id: String(params.student_master_id),
      student_name: studentName,
      month: month,
      year: year,
      months_exported: recap.length,
      rows_exported: values.length,
    });
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${safeExportFilename(`absensi_${studentName}_${periodLabel}`, "xlsx")}"`,
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }, {
    params: t.Object({ student_master_id: t.String() }),
    query: t.Object({ month: t.Optional(t.String()), year: t.Optional(t.String()) }),
  });
}

function row(context: AuthContext, id: string): Row | null {
  const values = context.database.client.query("SELECT id, full_name FROM student_masters WHERE id = ?").all(id) as Row[];
  return values[0] ?? null;
}
