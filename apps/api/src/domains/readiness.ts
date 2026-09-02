import {
  ReadinessResponseSchema,
  type FeatureReadiness,
  type ReadinessAction,
  type ReadinessItem,
  type ReadinessKey,
  type ReadinessLegacyStatus,
  type ReadinessLegacyStep,
  type ReadinessResponse,
  type ReadinessState,
} from "@operatoros/contracts/readiness";
import { effectiveAcademicTerms } from "./academic-timeline";
import { resolveAttendanceExpectationsForDates } from "./attendance-calendar";
import { actor } from "./core";
import type { AuthContext, CurrentUser } from "../auth/service";

type Row = Record<string, unknown>;
type Context = any;

type DomainItem = {
  key: ReadinessKey;
  label: string;
  state: ReadinessState;
  summary: string;
  count?: number;
  blockers?: ReadinessKey[];
  actions: ReadinessAction[];
};

type DomainFeature = Omit<FeatureReadiness, "state" | "blockers" | "actions"> & {
  state: ReadinessState;
  blockers: ReadinessKey[];
  actions: ReadinessAction[];
};

type DomainReadiness = {
  overall: { state: ReadinessState; summary: string };
  foundation: DomainItem[];
  operational: DomainItem[];
  features: DomainFeature[];
  legacy: { overallStatus: ReadinessLegacyStatus; steps: ReadinessLegacyStep[] };
};

type AcademicYear = { id: number; label: string; startDate: string; endDate: string };

const ACTION = {
  academicYear: { code: "configure_academic_year", label: "Configure academic year", route: "/academic-management?tab=calendar" },
  jenjang: { code: "configure_jenjang", label: "Configure programs / jenjang", route: "/academic-management?tab=foundation" },
  periods: { code: "configure_academic_periods", label: "Configure academic periods", route: "/academic-management?tab=settings" },
  classes: { code: "configure_classes", label: "Configure classes", route: "/academic-management?tab=foundation" },
  calendar: { code: "configure_calendar", label: "Configure calendar", route: "/attendance/calendar" },
  students: { code: "manage_students", label: "Manage students", route: "/students" },
  enrollment: { code: "review_enrollment", label: "Review enrollment", route: "/enrollment" },
} satisfies Record<string, ReadinessAction>;

export const FEATURE_REQUIREMENTS = {
  MACHINE_IMPORT: ["academic_year", "jenjang", "calendar"],
} as const satisfies Record<string, readonly ReadinessKey[]>;

function rows(context: AuthContext, sql: string, params: unknown[] = []): Row[] {
  return context.database.client.query(sql).all(...(params as never[])) as Row[];
}

function row(context: AuthContext, sql: string, params: unknown[] = []): Row | null {
  return (context.database.client.query(sql).get(...(params as never[])) as Row | null) ?? null;
}

function count(context: AuthContext, sql: string, params: unknown[] = []): number {
  return Number(row(context, sql, params)?.count ?? 0);
}

function item(
  key: ReadinessKey,
  label: string,
  state: ReadinessState,
  summary: string,
  actions: ReadinessAction[] = [],
  extra: Pick<DomainItem, "count" | "blockers"> = {},
): DomainItem {
  return { key, label, state, summary, actions, ...extra };
}

function dependentItem(
  key: ReadinessKey,
  label: string,
  dependency: DomainItem,
  summary: string,
  actions: ReadinessAction[] = [],
): DomainItem {
  if (dependency.state === "ERROR") return item(key, label, "ERROR", "The prerequisite could not be evaluated.");
  if (dependency.state !== "READY") return item(key, label, "BLOCKED", summary, dependency.actions, { blockers: [dependency.key] });
  return item(key, label, "ACTION_REQUIRED", summary, actions);
}

function aggregateState(values: ReadinessState[]): ReadinessState {
  if (values.some((value) => value === "ERROR")) return "ERROR";
  if (values.some((value) => value === "BLOCKED")) return "BLOCKED";
  if (values.some((value) => value === "ACTION_REQUIRED")) return "ACTION_REQUIRED";
  if (values.every((value) => value === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "READY";
}

function uniqueActions(items: DomainItem[]): ReadinessAction[] {
  return Array.from(new Map(items.flatMap((value) => value.actions).map((action) => [action.code, action])).values());
}

function dateForWeekday(startDate: string, endDate: string, weekday: number): string | null {
  const date = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (Number.isNaN(date.getTime()) || Number.isNaN(end)) return null;
  date.setUTCDate(date.getUTCDate() + ((weekday - date.getUTCDay() + 7) % 7));
  return date.getTime() <= end ? date.toISOString().slice(0, 10) : null;
}

function calendarIsUsable(context: AuthContext, year: AcademicYear, jenjangIds: number[]): boolean {
  if (!jenjangIds.length) return false;
  const placeholders = jenjangIds.map(() => "?").join(", ");
  const configured = rows(context, `
    SELECT jenjang_id, weekday
      FROM attendance_calendar_weekday_rules
     WHERE academic_year_id = ? AND jenjang_id IN (${placeholders})
    UNION ALL
    SELECT jenjang_id, CAST(strftime('%w', date) AS INTEGER) AS weekday
      FROM attendance_calendar_exceptions
     WHERE academic_year_id = ? AND date BETWEEN ? AND ? AND jenjang_id IN (${placeholders})
  `, [year.id, ...jenjangIds, year.id, year.startDate, year.endDate, ...jenjangIds]);
  const dates = new Map<number, string>();
  for (const value of configured) {
    const date = dateForWeekday(year.startDate, year.endDate, Number(value.weekday));
    if (date && !dates.has(Number(value.jenjang_id))) dates.set(Number(value.jenjang_id), date);
  }
  if (dates.size !== jenjangIds.length) return false;
  const resolved = resolveAttendanceExpectationsForDates(context, {
    academicYearId: year.id,
    dates: [...dates.values()],
    startDate: year.startDate,
    endDate: year.endDate,
    jenjangIds,
  });
  return jenjangIds.every((id) => [...dates.entries()].some(([jenjangId, date]) => jenjangId === id && resolved.get(date)?.get(id)?.status !== "UNKNOWN"));
}

function effectiveYear(context: AuthContext): AcademicYear | null {
  const value = row(context, "SELECT id, label, start_date, end_date FROM academic_years WHERE start_date <= end_date AND (is_default = 1 OR status = 'active') ORDER BY is_default DESC, start_date DESC LIMIT 1");
  return value ? { id: Number(value.id), label: String(value.label), startDate: String(value.start_date), endDate: String(value.end_date) } : null;
}

function restrictedReadiness(): DomainReadiness {
  const foundation = [
    ["academic_year", "Academic year"], ["jenjang", "Programs / Jenjang"], ["academic_periods", "Academic periods"],
    ["classes", "Classes"], ["calendar", "School calendar"], ["students", "Students"], ["enrollment", "Enrollment"],
  ] as const;
  const items = foundation.map(([key, label]) => item(key, label, "BLOCKED", "This readiness item is outside your account's management scope. Ask an administrator to configure it."));
  const feature: DomainFeature = { key: "MACHINE_IMPORT", label: "Machine Import", route: "/attendance/machine-import", state: "BLOCKED", blockers: ["academic_year", "jenjang", "calendar"], actions: [] };
  return {
    overall: { state: "BLOCKED", summary: "Readiness is limited to the setup scope assigned to your account." },
    foundation: items, operational: [], features: [feature],
    legacy: { overallStatus: "READ_ONLY_GUIDANCE", steps: legacySteps(items, false, false, false, "An administrator can complete this step.") },
  };
}

function legacySteps(
  foundation: DomainItem[],
  hasDevice: boolean,
  hasAttendance: boolean,
  canManage: boolean,
  responsibility: string | null,
): ReadinessLegacyStep[] {
  const byKey = new Map(foundation.map((value) => [value.key, value]));
  const definitions = [
    { key: "academic_year", code: "academic_year", name: "Configure an academic year", requirement: "REQUIRED" as const, fallback: ACTION.academicYear },
    { key: "students", code: "students", name: "Add or import students", requirement: "REQUIRED" as const, fallback: ACTION.students },
    { key: "enrollment", code: "enrollment", name: "Assign students to active classes", requirement: "REQUIRED" as const, fallback: ACTION.enrollment },
    { key: "academic_periods", code: "academic_terms", name: "Configure academic periods", requirement: "WORKFLOW" as const, fallback: ACTION.periods },
  ];
  const steps: ReadinessLegacyStep[] = definitions.map((definition) => {
    const source = byKey.get(definition.key as ReadinessKey)!;
    return {
      code: definition.code, name: definition.name,
      status: source.state === "READY" ? "COMPLETE" : "NOT_STARTED", requirement: definition.requirement,
      reason: source.summary, destination: canManage ? definition.fallback.route : null,
      can_manage: canManage && source.state === "ACTION_REQUIRED", responsibility,
    };
  });
  steps.push({ code: "device_link", name: "Link attendance devices", status: hasDevice ? "COMPLETE" : "OPTIONAL", requirement: "RECOMMENDED", reason: "Academic enrollment is ready without biometrics; a device link is only required for attendance-machine matching.", destination: canManage ? "/students" : null, can_manage: canManage && !hasDevice, responsibility });
  steps.push({ code: "attendance", name: "Record or import attendance", status: hasAttendance ? "COMPLETE" : "OPTIONAL", requirement: "RECOMMENDED", reason: "Attendance data enables daily review, dashboards, reports, and management analytics.", destination: canManage ? "/upload" : null, can_manage: canManage && !hasAttendance, responsibility });
  return steps;
}

function legacyStatus(foundation: DomainItem[], hasAttendance: boolean, hasDevice: boolean): ReadinessLegacyStatus {
  const required = foundation.filter((value) => ["academic_year", "students", "enrollment"].includes(value.key));
  if (required.every((value) => value.state === "READY") && hasAttendance && hasDevice) return "OPERATIONALLY_READY";
  if (required.every((value) => value.state === "READY")) return "READY_WITH_RECOMMENDATIONS";
  if (required.every((value) => value.state !== "READY")) return "FIRST_RUN";
  return "SETUP_PARTIAL";
}

export function evaluateReadiness(context: AuthContext, user: CurrentUser): DomainReadiness {
  if (user.role !== "admin") return restrictedReadiness();

  const year = effectiveYear(context);
  const academicYear = year
    ? item("academic_year", "Academic year", "READY", year.label)
    : item("academic_year", "Academic year", "ACTION_REQUIRED", "No valid active or default academic year is configured.", [ACTION.academicYear]);
  const jenjangRows = rows(context, "SELECT id, name FROM jenjangs WHERE active = 1 ORDER BY name, id");
  const jenjang = jenjangRows.length
    ? item("jenjang", "Programs / Jenjang", "READY", `${jenjangRows.length} active canonical program${jenjangRows.length === 1 ? "" : "s"} configured.`)
    : item("jenjang", "Programs / Jenjang", "ACTION_REQUIRED", "No active canonical program is configured.", [ACTION.jenjang]);
  const terms = year ? effectiveAcademicTerms(context, { id: year.id, start_date: year.startDate, end_date: year.endDate }) : [];
  const validTerms = Boolean(year && terms.length > 0 && terms.every((term) => term.start_date <= term.end_date && term.start_date >= year.startDate && term.end_date <= year.endDate));
  const periods = year
    ? validTerms ? item("academic_periods", "Academic periods", "READY", "Effective academic periods are available.") : item("academic_periods", "Academic periods", "ACTION_REQUIRED", "No valid academic periods are available for the effective academic year.", [ACTION.periods])
    : dependentItem("academic_periods", "Academic periods", academicYear, "Configure an academic year before reviewing academic periods.");
  const jenjangIds = jenjangRows.map((value) => Number(value.id));
  const classCount = year && jenjangIds.length ? count(context, `SELECT COUNT(*) AS count FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id AND g.active = 1 JOIN academic_programs p ON p.id = g.program_id AND p.active = 1 JOIN jenjangs j ON j.id = g.jenjang_id AND j.active = 1 WHERE c.academic_year_id = ? AND c.active = 1 AND j.id IN (${jenjangIds.map(() => "?").join(", ")})`, [year.id, ...jenjangIds]) : 0;
  const classes = !year || !jenjangRows.length
    ? dependentItem("classes", "Classes", !year ? academicYear : jenjang, "Configure the required academic foundation before reviewing classes.")
    : classCount > 0 ? item("classes", "Classes", "READY", `${classCount} active class${classCount === 1 ? "" : "es"} is available.` , [], { count: classCount }) : item("classes", "Classes", "ACTION_REQUIRED", "No active class with a valid program and jenjang chain is configured.", [ACTION.classes], { count: 0 });
  const calendarScope = year && jenjangIds.length ? rows(context, `SELECT DISTINCT j.id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id AND g.active = 1 JOIN academic_programs p ON p.id = g.program_id AND p.active = 1 JOIN jenjangs j ON j.id = g.jenjang_id AND j.active = 1 WHERE c.academic_year_id = ? AND c.active = 1 AND j.id IN (${jenjangIds.map(() => "?").join(", ")})`, [year.id, ...jenjangIds]).map((value) => Number(value.id)) : [];
  const calendarReady = year && jenjangIds.length ? calendarIsUsable(context, year, calendarScope.length ? calendarScope : jenjangIds) : false;
  const calendar = !year || !jenjangRows.length
    ? dependentItem("calendar", "School calendar", !year ? academicYear : jenjang, "Configure the academic year and programs before reviewing the school calendar.")
    : calendarReady ? item("calendar", "School calendar", "READY", "The school calendar can resolve attendance expectations for the configured programs.") : item("calendar", "School calendar", "ACTION_REQUIRED", "No usable calendar expectation is configured for the active programs.", [ACTION.calendar]);
  const studentCount = count(context, "SELECT COUNT(*) AS count FROM student_masters WHERE student_status = 'active'");
  const students = studentCount > 0 ? item("students", "Students", "READY", `${studentCount} active canonical student${studentCount === 1 ? "" : "s"} available.`, [], { count: studentCount }) : item("students", "Students", "ACTION_REQUIRED", "No active canonical students are available.", [ACTION.students], { count: 0 });
  const enrollmentCount = year ? count(context, "SELECT COUNT(*) AS count FROM student_enrollments e JOIN student_masters m ON m.id = e.student_master_id WHERE e.academic_year_id = ? AND e.lifecycle_state = 'ACTIVE' AND e.class_assigned = 1 AND (e.academic_class_id IS NOT NULL OR trim(coalesce(e.class_name, '')) <> '') AND m.student_status = 'active'", [year.id]) : 0;
  const enrollment = !year ? dependentItem("enrollment", "Enrollment", academicYear, "Configure an academic year before reviewing enrollment.") : enrollmentCount > 0 ? item("enrollment", "Enrollment", "READY", `${enrollmentCount} active class-assigned enrollment${enrollmentCount === 1 ? "" : "s"} available.`, [], { count: enrollmentCount }) : item("enrollment", "Enrollment", "ACTION_REQUIRED", "No active class-assigned enrollment is available for the effective academic year.", [ACTION.enrollment], { count: 0 });
  const foundation = [academicYear, jenjang, periods, classes, calendar, students, enrollment];
  const requirements = FEATURE_REQUIREMENTS.MACHINE_IMPORT.map((key) => foundation.find((value) => value.key === key)!);
  const featureState = aggregateState(requirements.map((value) => value.state));
  const feature: DomainFeature = { key: "MACHINE_IMPORT", label: "Machine Import", route: "/attendance/machine-import", state: featureState, blockers: requirements.filter((value) => value.state !== "READY").map((value) => value.key), actions: uniqueActions(requirements.filter((value) => value.state !== "READY")) };
  const hasDevice = Boolean(row(context, "SELECT id FROM student_device_identities WHERE is_active = 1 LIMIT 1"));
  const hasAttendance = Boolean(row(context, "SELECT id FROM attendance LIMIT 1"));
  const overallState = aggregateState([...foundation.map((value) => value.state), feature.state]);
  const attention = foundation.filter((value) => value.state === "ACTION_REQUIRED").length;
  const overallSummary = overallState === "READY" ? "The configured foundation is ready for available workflows." : `${attention || 1} foundation item${attention === 1 ? "" : "s"} require${attention === 1 ? "s" : ""} attention.`;
  return { overall: { state: overallState, summary: overallSummary }, foundation, operational: [], features: [feature], legacy: { overallStatus: legacyStatus(foundation, hasAttendance, hasDevice), steps: legacySteps(foundation, hasDevice, hasAttendance, true, null) } };
}

function mapItem(value: DomainItem): ReadinessItem {
  return { key: value.key, label: value.label, state: value.state, summary: value.summary, ...(value.count === undefined ? {} : { count: value.count }), ...(value.blockers === undefined ? {} : { blockers: value.blockers }), actions: value.actions };
}

function mapFeature(value: DomainFeature): FeatureReadiness {
  return { key: value.key, label: value.label, route: value.route, state: value.state, blockers: value.blockers, actions: value.actions };
}

export function mapReadinessToResponse(value: DomainReadiness): ReadinessResponse {
  return {
    overall: value.overall,
    foundation: value.foundation.map(mapItem),
    operational: value.operational.map(mapItem),
    features: value.features.map(mapFeature),
    overall_status: value.legacy.overallStatus,
    steps: value.legacy.steps,
  };
}

export function readinessRoutes(app: any, context: AuthContext): any {
  app.get("/api/readiness", (ctx: Context) => {
    const user = actor(context, ctx, {});
    if (!user) return { detail: "Authentication required" };
    return mapReadinessToResponse(evaluateReadiness(context, user));
  }, { response: ReadinessResponseSchema });
  return app;
}
