import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { StaffSchoolUnitAssignmentDto } from "@operatoros/contracts/staff";

type AssignmentRow = {
  id: number;
  school_unit_id: number;
  school_unit_name: string;
  school_unit_status: "ACTIVE" | "INACTIVE";
  effective_from: string;
  effective_to: string | null;
  ptk_applicability: "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN";
  reason: string;
  created_by: string;
  created_at: string;
  closed_reason: string | null;
  closed_by: string | null;
  closed_at: string | null;
  cancelled_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
};

export type StaffSchoolUnitEligibility = { staff_member_id: string; school_unit_id: number };

export function appendCurrentSchoolUnitFilter(
  where: string[],
  params: SQLQueryBindings[],
  schoolUnitId: string | undefined,
  asOfDate: string,
): boolean {
  if (schoolUnitId === undefined || schoolUnitId === "") return true;
  const id = Number(schoolUnitId);
  if (!Number.isSafeInteger(id) || id < 1) return false;
  where.push("EXISTS (SELECT 1 FROM staff_school_unit_assignment_versions a WHERE a.staff_member_id=s.id AND a.school_unit_id=? AND a.cancelled_at IS NULL AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>=?))");
  params.push(id, asOfDate, asOfDate);
  return true;
}

function assignmentRows(db: Database, staffMemberId: string, currentDate?: string): StaffSchoolUnitAssignmentDto[] {
  const currentFilter = currentDate === undefined ? "" : " AND a.cancelled_at IS NULL AND (a.effective_to IS NULL OR a.effective_to>=?)";
  const params = currentDate === undefined ? [staffMemberId] : [staffMemberId, currentDate];
  const assignments = db.query(`
    SELECT a.id, a.school_unit_id, u.name AS school_unit_name, u.status AS school_unit_status,
      a.effective_from, a.effective_to, a.ptk_applicability, a.reason, a.created_by, a.created_at,
      a.closed_reason, a.closed_by, a.closed_at, a.cancelled_reason, a.cancelled_by, a.cancelled_at
    FROM staff_school_unit_assignment_versions a
    JOIN school_units u ON u.id=a.school_unit_id
    WHERE a.staff_member_id=?${currentFilter}
    ORDER BY a.effective_from DESC, a.id DESC
  `).all(...params) as AssignmentRow[];
  return assignments.map((assignment) => ({
    ...assignment,
    is_current: currentDate !== undefined && assignment.cancelled_at === null && assignment.effective_from <= currentDate && (assignment.effective_to === null || assignment.effective_to >= currentDate),
  }));
}

export function staffSchoolUnitAssignments(
  db: Database,
  staffMemberId: string,
  asOfDate: string,
): StaffSchoolUnitAssignmentDto[] {
  return assignmentRows(db, staffMemberId, asOfDate);
}

export function staffSchoolUnitAssignmentHistory(db: Database, staffMemberId: string): StaffSchoolUnitAssignmentDto[] {
  return assignmentRows(db, staffMemberId);
}

export function eligibleStaffBySchoolUnitForMonth(db: Database, monthStart: string, monthEnd: string): StaffSchoolUnitEligibility[] {
  return db.query(`
    SELECT DISTINCT staff_member_id, school_unit_id
    FROM staff_school_unit_assignment_versions
    WHERE ptk_applicability='APPLICABLE'
      AND effective_from<=?
      AND (effective_to IS NULL OR effective_to>=?)
      AND cancelled_at IS NULL
    ORDER BY school_unit_id, staff_member_id
  `).all(monthEnd, monthStart) as StaffSchoolUnitEligibility[];
}
