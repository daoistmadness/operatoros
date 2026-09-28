import type { AuthContext } from "../auth/service";

type Row = Record<string, any>;

const profile = new Set(["full_name", "preferred_name", "nipd", "nisn", "nik", "birth_place", "birth_date", "gender", "religion", "student_status"]);
const address = new Set(["address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code"]);
const contact = new Set(["student_phone", "student_email"]);
const addressFields = ["address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code"];
const contactFields = ["student_phone", "student_email", "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"];

function one(context: AuthContext, sql: string, params: any[]): Row | null {
  return (context.database.client.query(sql).get(...params) as Row | null) ?? null;
}

function many(context: AuthContext, sql: string, params: any[]): Row[] {
  return context.database.client.query(sql).all(...params) as Row[];
}

/** Keep only entities this update can mutate; compare the exact post-commit state before compensation. */
export function studentUpdateState(context: AuthContext, studentId: string, fields: string[], academicYearId: number | null): Row {
  const has = (set: Set<string>) => fields.some((field) => set.has(field));
  const extraValues = (columns: string[]) => columns.length ? `CASE WHEN ${columns.map((field) => `${field} IS NOT NULL`).join(" OR ")} THEN 1 ELSE 0 END AS has_other_values` : "0 AS has_other_values";
  const addressFieldsChanged = fields.filter((field) => address.has(field));
  const contactFieldsChanged = fields.filter((field) => contact.has(field));
  const master = has(profile) ? one(context, "SELECT * FROM student_masters WHERE id = ?", [studentId]) : null;
  return {
    studentId, fields, academicYearId,
    master: master && Object.fromEntries(["id", "normalized_name", ...fields.filter((field) => profile.has(field))].map((field) => [field, master[field] ?? null])),
    address: has(address) ? one(context, `SELECT id, ${addressFieldsChanged.join(", ")}, ${extraValues(addressFields.filter((field) => !addressFieldsChanged.includes(field)))} FROM student_addresses WHERE student_master_id = ?`, [studentId]) : null,
    contact: has(contact) ? one(context, `SELECT id, ${contactFieldsChanged.join(", ")}, ${extraValues(contactFields.filter((field) => !contactFieldsChanged.includes(field)))} FROM student_contacts WHERE student_master_id = ?`, [studentId]) : null,
    guardian: fields.some((field) => field.startsWith("guardian_")) ? one(context, "SELECT id, name, phone, CASE WHEN email IS NOT NULL OR occupation IS NOT NULL OR education IS NOT NULL OR address IS NOT NULL THEN 1 ELSE 0 END AS has_other_values FROM student_parent_guardians WHERE student_master_id = ? ORDER BY id LIMIT 1", [studentId]) : null,
    devices: fields.includes("device_identifier") ? many(context, "SELECT id, device_identifier, device_source, legacy_student_id, is_active, effective_from, effective_to FROM student_device_identities WHERE student_master_id = ? ORDER BY id", [studentId]) : null,
    enrollment: fields.includes("academic_class_id") ? one(context, "SELECT id, student_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, effective_to, lifecycle_state, lifecycle_effective_date, lifecycle_reason_code, lifecycle_reason FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ?", [studentId, academicYearId]) : null,
  };
}

function restoreFields(context: AuthContext, table: string, id: number | string, fields: string[], source: Row, user: string): void {
  if (!fields.length) return;
  const assignments = fields.map((field) => `${field} = ?`).join(", ");
  const suffix = table === "student_masters" ? ", updated_by = ?, updated_at = CURRENT_TIMESTAMP" : ", updated_at = CURRENT_TIMESTAMP";
  context.database.client.run(`UPDATE ${table} SET ${assignments}${suffix} WHERE id = ?`, [...fields.map((field) => source[field] ?? null), ...(table === "student_masters" ? [user] : []), id]);
}

/** Called only inside the rollback transaction after the current state matches `after`. */
export function restoreStudentUpdate(context: AuthContext, before: Row, after: Row, user: string, reason: string): void {
  const fields = before.fields as string[];
  const group = (set: Set<string>) => fields.filter((field) => set.has(field));
  restoreFields(context, "student_masters", before.studentId, [...group(profile), ...(fields.includes("full_name") ? ["normalized_name"] : [])], before.master ?? {}, user);

  for (const [table, key, changed] of [["student_addresses", "address", group(address)], ["student_contacts", "contact", group(contact)]] as const) {
    if (!changed.length || !after[key]) continue;
    if (before[key]) restoreFields(context, table, after[key].id, changed as string[], before[key], user);
    else context.database.client.run(`DELETE FROM ${table} WHERE id = ?`, [after[key].id]);
  }

  if (fields.some((field) => field.startsWith("guardian_")) && after.guardian) {
    if (before.guardian) restoreFields(context, "student_parent_guardians", after.guardian.id, ["name", "phone"], before.guardian, user);
    else context.database.client.run("DELETE FROM student_parent_guardians WHERE id = ?", [after.guardian.id]);
  }

  if (fields.includes("device_identifier")) {
    const previous = new Map((before.devices as Row[]).map((device) => [device.id, device]));
    for (const device of after.devices as Row[]) {
      const old = previous.get(device.id);
      if (!old) context.database.client.run("UPDATE student_device_identities SET is_active = 0, effective_to = CURRENT_DATE WHERE id = ?", [device.id]);
    }
    for (const device of before.devices as Row[]) context.database.client.run("UPDATE student_device_identities SET is_active = ?, effective_to = ? WHERE id = ?", [device.is_active, device.effective_to, device.id]);
  }

  if (fields.includes("academic_class_id") && after.enrollment) {
    if (before.enrollment) {
      const restore = ["student_id", "jenjang_id", "academic_class_id", "class_name", "class_assigned", "effective_from", "effective_to", "lifecycle_state", "lifecycle_effective_date", "lifecycle_reason_code", "lifecycle_reason"];
      restoreFields(context, "student_enrollments", after.enrollment.id, restore, before.enrollment, user);
    } else {
      context.database.client.run("UPDATE student_enrollments SET lifecycle_state = 'ENDED', effective_to = CURRENT_DATE, class_assigned = 0, lifecycle_effective_date = CURRENT_DATE, lifecycle_reason_code = 'ROLLBACK', lifecycle_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [reason, after.enrollment.id]);
    }
  }
}
