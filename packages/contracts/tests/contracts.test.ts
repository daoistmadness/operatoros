import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  AttendanceCorrectionRequestSchema,
  AttendanceImportCommitRequestSchema,
} from "@operatoros/contracts/attendance";
import {
  AuthUserSchema,
  LoginRequestSchema,
} from "@operatoros/contracts/auth";
import {
  GradeGridSaveRequestSchema,
  GradeSaveResponseSchema,
} from "@operatoros/contracts/grades";
import { ReportQuerySchema } from "@operatoros/contracts/reports";
import { AnalyticsOverviewResponseSchema, ManagementOverviewResponseSchema } from "@operatoros/contracts/analytics";
import { ExcelWorksheetDtoSchema } from "@operatoros/contracts/excel";
import { ReadinessResponseSchema } from "@operatoros/contracts/readiness";
import {
  CreateEnrollmentRequestSchema,
  ManagedStudentSchema,
  StudentListResponseSchema,
} from "@operatoros/contracts/students";

describe("@operatoros/contracts", () => {
  it("accepts valid auth and grade boundary values", () => {
    expect(Value.Check(LoginRequestSchema, { username: "admin", password: "secret" })).toBe(true);
    expect(Value.Check(AuthUserSchema, { id: 1, username: "admin", role: "admin", capabilities: [] })).toBe(true);
    expect(Value.Check(GradeGridSaveRequestSchema, {
      enrollment_id: 1,
      assessment_session_id: null,
      grades: [{ subject_id: 2, component_id: 3, score: null }],
    })).toBe(true);
    expect(Value.Check(GradeSaveResponseSchema, {
      status: "success",
      inserted: 1,
      updated: 0,
      saved: 1,
      grades: [{ id: 4, enrollment_id: 1, subject_id: 2, component_id: 3, assessment_session_id: 7, score: 88 },],
    })).toBe(true);
    expect(Value.Check(CreateEnrollmentRequestSchema, {
      academic_year_id: 1,
      academic_class_id: 2,
      effective_from: "2026-07-01",
    })).toBe(true);
    expect(Value.Check(ManagedStudentSchema, {
      id: "student-1",
      full_name: "Student One",
      profile_completeness: 1,
      student_status: "active",
      quality_flags: [],
    })).toBe(true);
    expect(Value.Check(StudentListResponseSchema, {
      items: [], total: 0, page: 1, page_size: 25, total_pages: 0,
    })).toBe(true);
    expect(Value.Check(AttendanceCorrectionRequestSchema, {
      attendance_id: 1,
      proposed_status: "late",
      reason_code: "SCAN_REVIEW",
      explanation: "Review the scan record",
    })).toBe(true);
    expect(Value.Check(AttendanceImportCommitRequestSchema, {
      selected_row_ids: [1],
      confirmation: "COMMIT_ATTENDANCE_IMPORT",
      preview_checksum: "a".repeat(64),
    })).toBe(true);
    expect(Value.Check(ReportQuerySchema, {
      academic_year_id: 1,
      scope: "combined",
      class_name: null,
      subject_id: null,
    })).toBe(true);
    expect(Value.Check(AnalyticsOverviewResponseSchema, {
      contract_version: "analytics.v1",
      filters: { academic_year_id: 1, academic_year_label: "2026/2027", start_date: "2026-01-01", end_date: "2026-01-31", jenjang_id: null, class_name: null, subject_id: null },
      metric_definitions: [],
      summary: {
        student_count: 0,
        attendance_counts: { present: 0, sakit: 0, izin: 0, alfa: 0, late: 0 },
        attendance_rate: { value: null, numerator: 0, denominator: 0, unit: "percent", status: "unavailable" },
        grade_average: { value: null, numerator: 0, denominator: 0, unit: "score", status: "unavailable" },
      },
      cohorts: [],
    })).toBe(true);
    expect(Value.Check(ManagementOverviewResponseSchema, {
      scope: { academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: null, classId: null, attendanceDateFrom: "2026-07-01", attendanceDateTo: "2027-06-30" },
      school: {
        students: { status: "available", activeStudents: 0, jenjangCount: 0, classCount: 0, byJenjang: [] },
        staff: { status: "unavailable", reason: "unauthorized" },
      },
      attendance: { status: "unavailable", reason: "unauthorized" },
      academic: { status: "unavailable", reason: "unauthorized" },
      dataQuality: { students: { status: "unavailable", reason: "unauthorized" }, staff: { status: "unavailable", reason: "unauthorized" } },
      links: { recapitulation: "/analytics/recapitulation", attendance: "/analytics/attendance", academic: "/analytics/academic", dataQuality: "/analytics/data-quality" },
    })).toBe(true);
    expect(Value.Check(ExcelWorksheetDtoSchema, { name: "Attendance", headers: ["ID"], rows: [[1]] })).toBe(true);
    expect(Value.Check(ReadinessResponseSchema, {
      overall: { state: "READY", summary: "The configured foundation is ready." },
      foundation: [{ key: "jenjang", label: "Programs / Jenjang", state: "READY", summary: "Configured.", actions: [] }],
      operational: [],
      features: [{ key: "MACHINE_IMPORT", label: "Machine Import", route: "/attendance/machine-import", state: "READY", blockers: [], actions: [] }],
      overall_status: "READY_WITH_RECOMMENDATIONS",
      steps: [],
    })).toBe(true);
  });

  it("rejects invalid values without changing optional and null semantics", () => {
    expect(Value.Check(LoginRequestSchema, { username: "", password: "secret" })).toBe(false);
    expect(Value.Check(AuthUserSchema, { id: 1, username: "admin", role: "owner", capabilities: [] })).toBe(false);
    expect(Value.Check(GradeGridSaveRequestSchema, { enrollment_id: 1, assessment_session_id: null, grades: [] })).toBe(false);
    expect(Value.Check(GradeGridSaveRequestSchema, {
      enrollment_id: 1,
      assessment_session_id: 7,
      grades: [{ subject_id: 2, component_id: 3, score: 101 }],
    })).toBe(false);
    expect(Value.Check(GradeGridSaveRequestSchema, {
      enrollment_id: 1,
      assessment_session_id: 7,
      grades: [{ subject_id: 2, component_id: 3 }],
    })).toBe(true);
    expect(Value.Check(AttendanceImportCommitRequestSchema, {
      selected_row_ids: [], confirmation: "CONFIRM", preview_checksum: "short",
    })).toBe(false);
    expect(Value.Check(ReportQuerySchema, {
      academic_year_id: 1, scope: "unknown",
    })).toBe(false);
    expect(Value.Check(AnalyticsOverviewResponseSchema, {
      contract_version: "analytics.v1",
      filters: { academic_year_id: 1, academic_year_label: "2026/2027", start_date: "2026-01-01", end_date: "2026-01-31", jenjang_id: null, class_name: null, subject_id: null },
      metric_definitions: [], cohorts: [],
    })).toBe(false);
    expect(Value.Check(ExcelWorksheetDtoSchema, { name: "A".repeat(32), headers: ["ID"], rows: [] })).toBe(false);
    expect(Value.Check(ReadinessResponseSchema, {
      overall: { state: "READY", summary: "Configured." }, foundation: [], operational: [], features: [], overall_status: "READY_WITH_RECOMMENDATIONS",
      steps: [{ code: "jenjang", name: "Programs", status: "COMPLETE", requirement: "REQUIRED", reason: "Configured.", destination: null, can_manage: true, responsibility: null, full_name: "never-public" }],
    })).toBe(false);
  });
});
