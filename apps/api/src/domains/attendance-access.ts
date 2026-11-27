import type { AuthContext, CurrentUser } from "../auth/service";

type Row = Record<string, any>;

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

export function hasAttendanceClassAccess(context: AuthContext, userId: number, classId: number, date?: string | null): boolean {
  const where = ["user_id = ?", "academic_class_id = ?", "active = 1"];
  const params: unknown[] = [userId, classId];
  if (date) {
    where.push("(effective_from IS NULL OR effective_from <= ?)", "(effective_to IS NULL OR effective_to >= ?)");
    params.push(date, date);
  }
  return Boolean(row(context, `SELECT id FROM teacher_class_assignments WHERE ${where.join(" AND ")}`, params));
}

export function hasAttendanceRecordAccess(context: AuthContext, user: CurrentUser, attendanceId: number): boolean {
  if (user.role === "admin") return true;
  const attendance = row(context, "SELECT id, date, student_id FROM attendance WHERE id = ?", [attendanceId]);
  if (!attendance) return false;
  return Boolean(row(context, `
    SELECT 1
      FROM student_enrollments e
      JOIN academic_classes c ON (c.id = e.academic_class_id OR (e.academic_class_id IS NULL AND c.class_name = e.class_name))
      JOIN teacher_class_assignments ta ON ta.academic_class_id = c.id
     WHERE e.student_id = ?
       AND ta.user_id = ?
       AND ta.active = 1
       AND (ta.effective_from IS NULL OR ta.effective_from <= ?)
       AND (ta.effective_to IS NULL OR ta.effective_to >= ?)
       AND (e.effective_from IS NULL OR e.effective_from <= ?)
       AND (e.effective_to IS NULL OR e.effective_to >= ?)
       AND e.lifecycle_state = 'ACTIVE'
     LIMIT 1
  `, [attendance.student_id, user.id, attendance.date, attendance.date, attendance.date, attendance.date]));
}

export function hasStudentAttendanceAccess(
  context: AuthContext,
  user: CurrentUser,
  studentId: number,
  month?: number,
  year?: number,
): boolean {
  if (user.role === "admin") return true;

  const dateFilter = month === undefined || year === undefined
    ? ""
    : "AND strftime('%m', a.date) = ? AND strftime('%Y', a.date) = ?";
  const params: unknown[] = [studentId];
  if (dateFilter) params.push(String(month).padStart(2, "0"), String(year));
  params.push(user.id);

  const inaccessible = row(context, `
    SELECT a.id
      FROM attendance a
     WHERE a.student_id = ? ${dateFilter}
       AND NOT EXISTS (
         SELECT 1
           FROM student_enrollments e
           JOIN academic_classes c ON (c.id = e.academic_class_id OR (e.academic_class_id IS NULL AND c.class_name = e.class_name))
           JOIN teacher_class_assignments ta ON ta.academic_class_id = c.id
          WHERE e.student_id = a.student_id
            AND ta.user_id = ?
            AND ta.active = 1
            AND (ta.effective_from IS NULL OR ta.effective_from <= a.date)
            AND (ta.effective_to IS NULL OR ta.effective_to >= a.date)
            AND (e.effective_from IS NULL OR e.effective_from <= a.date)
            AND (e.effective_to IS NULL OR e.effective_to >= a.date)
            AND e.lifecycle_state = 'ACTIVE'
       )
     LIMIT 1
  `, params);
  if (inaccessible !== null) return false;

  const reasonPeriodFilter = month === undefined || year === undefined
    ? ""
    : "AND ar.month = ? AND ar.year = ?";
  const reasonParams: unknown[] = [studentId];
  if (reasonPeriodFilter) reasonParams.push(month, year);
  reasonParams.push(user.id);
  const inaccessibleReason = row(context, `
    SELECT ar.id
      FROM absence_reasons ar
     WHERE ar.student_id = ? ${reasonPeriodFilter}
       AND NOT EXISTS (
         SELECT 1
           FROM student_enrollments e
           JOIN academic_classes c ON (c.id = e.academic_class_id OR (e.academic_class_id IS NULL AND c.class_name = e.class_name))
           JOIN teacher_class_assignments ta ON ta.academic_class_id = c.id
          WHERE e.student_id = ar.student_id
            AND c.class_name = ar.class_name
            AND ta.user_id = ?
            AND ta.active = 1
            AND (ta.effective_from IS NULL OR ta.effective_from <= date(printf('%04d-%02d-01', ar.year, ar.month), '+1 month', '-1 day'))
            AND (ta.effective_to IS NULL OR ta.effective_to >= date(printf('%04d-%02d-01', ar.year, ar.month)))
            AND (e.effective_from IS NULL OR e.effective_from <= date(printf('%04d-%02d-01', ar.year, ar.month), '+1 month', '-1 day'))
            AND (e.effective_to IS NULL OR e.effective_to >= date(printf('%04d-%02d-01', ar.year, ar.month)))
            AND date(COALESCE(e.effective_from, '0001-01-01')) <= date(COALESCE(ta.effective_to, '9999-12-31'))
            AND date(COALESCE(ta.effective_from, '0001-01-01')) <= date(COALESCE(e.effective_to, '9999-12-31'))
            AND e.lifecycle_state = 'ACTIVE'
       )
     LIMIT 1
  `, reasonParams);
  if (inaccessibleReason !== null) return false;

  const attendanceParams: unknown[] = [studentId];
  if (dateFilter) attendanceParams.push(String(month).padStart(2, "0"), String(year));
  const attendanceInScope = row(context, `
    SELECT 1
      FROM attendance a
     WHERE a.student_id = ? ${dateFilter}
     LIMIT 1
  `, attendanceParams);
  const reasonInScope = row(context, `
    SELECT 1
      FROM absence_reasons ar
     WHERE ar.student_id = ? ${reasonPeriodFilter}
     LIMIT 1
  `, reasonParams.slice(0, reasonParams.length - 1));
  if (attendanceInScope !== null || reasonInScope !== null) return true;

  // Empty summaries still reveal the student's identity. Allow them only when
  // the requested period intersects an active enrollment and the staff
  // member's assignment to that class.
  const classPeriodFilter = month === undefined || year === undefined
    ? ""
    : `AND date(COALESCE(e.effective_from, '0001-01-01')) <= date(?, '+1 month', '-1 day')
       AND date(COALESCE(e.effective_to, '9999-12-31')) >= date(?)
       AND date(COALESCE(ta.effective_from, '0001-01-01')) <= date(?, '+1 month', '-1 day')
       AND date(COALESCE(ta.effective_to, '9999-12-31')) >= date(?)`;
  const periodStart = month === undefined || year === undefined
    ? []
    : [`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`];
  const classScopeParams: unknown[] = [studentId, user.id];
  if (classPeriodFilter) classScopeParams.push(...periodStart, ...periodStart, ...periodStart, ...periodStart);
  return row(context, `
    SELECT 1
      FROM student_enrollments e
      JOIN academic_classes c ON (c.id = e.academic_class_id OR (e.academic_class_id IS NULL AND c.class_name = e.class_name))
      JOIN teacher_class_assignments ta ON ta.academic_class_id = c.id
     WHERE e.student_id = ?
       AND e.lifecycle_state = 'ACTIVE'
       AND ta.user_id = ?
       AND ta.active = 1
       AND date(COALESCE(e.effective_from, '0001-01-01')) <= date(COALESCE(ta.effective_to, '9999-12-31'))
       AND date(COALESCE(ta.effective_from, '0001-01-01')) <= date(COALESCE(e.effective_to, '9999-12-31'))
       ${classPeriodFilter}
     LIMIT 1
  `, classScopeParams) !== null;
}
