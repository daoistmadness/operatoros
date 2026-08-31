import type { ReportQuery, ReportScope, ReportType } from "../../api/reports";

type QueryPrimitive = string | number | boolean | null;
type CanonicalQueryValue = QueryPrimitive | readonly QueryPrimitive[];

export function canonicalizeQueryFilters(
  filters: Readonly<Record<string, QueryPrimitive | readonly QueryPrimitive[] | undefined>>,
): Readonly<Record<string, CanonicalQueryValue>> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter((entry): entry is [string, QueryPrimitive | readonly QueryPrimitive[]] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value].sort((left, right) => String(left).localeCompare(String(right))) : value,
      ]),
  );
}

export const queryKeys = {
  setup: { all: ["setup"] as const, status: ["setup", "status"] as const },
  auth: { all: ["auth"] as const, me: ["auth", "me"] as const },
  readiness: { all: ["readiness"] as const, status: (userId: number | null) => ["readiness", "status", { userId }] as const },
  backups: {
    all: ["backups"] as const,
    status: ["backups", "status"] as const,
    list: ["backups", "list"] as const,
    scheduler: ["backups", "scheduler"] as const,
    history: ["backups", "history"] as const,
    recoveryHistory: ["backups", "recovery-history"] as const,
  },
  reports: {
    all: ["reports"] as const,
    filters: (academicYearId?: number | null, scope?: ReportScope) => ["reports", "filters", { academicYearId: academicYearId ?? null, scope: scope ?? null }] as const,
    detail: (type: ReportType, query: ReportQuery) => ["reports", type, query] as const,
  },
  managementReports: {
    all: ["management-reports"] as const,
    metadata: (academicYearId?: number | null, scope?: ReportScope) => ["management-reports", "metadata", { academicYearId: academicYearId ?? null, scope: scope ?? null }] as const,
    monthly: (query: ReportQuery) => ["management-reports", "monthly", query] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    snapshot: (month: number, year: number) => ["dashboard", "snapshot", { month, year }] as const,
  },
  analytics: {
    all: ["analytics"] as const,
    filters: (filters: Readonly<Record<string, QueryPrimitive | undefined>> = {}) => ["analytics", "filters", canonicalizeQueryFilters(filters)] as const,
    managementSummary: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "management-summary", canonicalizeQueryFilters(filters)] as const,
    managementOverview: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "management-overview", canonicalizeQueryFilters(filters)] as const,
    historicalTrends: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "historical-trends", canonicalizeQueryFilters(filters)] as const,
    interventionImpact: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "intervention-impact", canonicalizeQueryFilters(filters)] as const,
    overview: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "overview", canonicalizeQueryFilters(filters)] as const,
    recap: (kind: "students" | "staff", filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "recap", kind, canonicalizeQueryFilters(filters)] as const,
    dataQuality: (kind: "students" | "staff", filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "data-quality", kind, canonicalizeQueryFilters(filters)] as const,
    dataQualityIssues: (kind: "students" | "staff", filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "data-quality-issues", kind, canonicalizeQueryFilters(filters)] as const,
    trends: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "trends", canonicalizeQueryFilters(filters)] as const,
    studentTrends: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "student-trends", canonicalizeQueryFilters(filters)] as const,
    studentIndicators: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "student-indicators", canonicalizeQueryFilters(filters)] as const,
    cohorts: (dimension: "class" | "jenjang", filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["analytics", "cohorts", dimension, canonicalizeQueryFilters(filters)] as const,
    attendanceOptions: (academicYearId: number | null, jenjangId: number | null) => ["analytics", "attendance", "options", { academicYearId, jenjangId }] as const,
    attendance: (section: "overview" | "classes" | "jenjang" | "daily" | "students", filters: Readonly<Record<string, QueryPrimitive | readonly QueryPrimitive[] | undefined>>) => ["analytics", "attendance", section, canonicalizeQueryFilters(filters)] as const,
    academicOptions: (academicYearId: number | null, jenjangId: number | null) => ["analytics", "academic", "options", { academicYearId, jenjangId }] as const,
    academicOverview: (filters: Readonly<Record<string, QueryPrimitive | readonly QueryPrimitive[] | undefined>>) => ["analytics", "academic", "overview", canonicalizeQueryFilters(filters)] as const,
    academicStudents: (filters: Readonly<Record<string, QueryPrimitive | readonly QueryPrimitive[] | undefined>>) => ["analytics", "academic", "students", canonicalizeQueryFilters(filters)] as const,
  },
  students: {
    all: ["students"] as const,
    lists: ["students", "list"] as const,
    list: (filters: Record<string, unknown>) => ["students", "list", filters] as const,
    details: ["students", "detail"] as const,
    detail: (id: string) => ["students", "detail", id] as const,
    overview: (id: string) => ["students", "overview", id] as const,
    quality: ["students", "quality"] as const,
    history: (id: string) => ["students", "history", id] as const,
    deviceIdentities: (id: string) => ["students", "devices", id] as const,
    enrollments: (id: string) => ["students", "enrollments", id] as const,
    legacyLink: (id: string) => ["students", "legacy-link", id] as const,
    importSessions: ["students", "imports"] as const,
    importSession: (id: string) => ["students", "imports", id] as const,
  },
  classes: {
    all: ["classes"] as const,
    overview: (classId: string, filters: Readonly<Record<string, QueryPrimitive | undefined>>) => ["classes", "overview", classId, canonicalizeQueryFilters(filters)] as const,
  },
  uploads: {
    all: ["uploads"] as const,
    history: {
      all: ["uploads", "history"] as const,
      list: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) =>
        ["uploads", "history", "list", canonicalizeQueryFilters(filters)] as const,
      detail: (uploadId: string) => ["uploads", "history", "detail", uploadId] as const,
      timeline: (uploadId: string) => ["uploads", "history", "timeline", uploadId] as const,
      rows: (uploadId: string, page: number, outcome?: string) =>
        ["uploads", "history", "rows", uploadId, canonicalizeQueryFilters({ page, outcome })] as const,
    },
    conflicts: {
      all: ["uploads", "conflicts"] as const,
      list: (filters: Readonly<Record<string, QueryPrimitive | undefined>>) =>
        ["uploads", "conflicts", "list", canonicalizeQueryFilters(filters)] as const,
      candidates: (itemId: string, search: string) =>
        ["uploads", "conflicts", "candidates", itemId, search] as const,
      comparison: (itemId: string, studentId: string) =>
        ["uploads", "conflicts", "comparison", itemId, studentId] as const,
    },
  },
  operator: {
    all: ["operator"] as const,
    workQueue: ["operator", "work-queue"] as const,
  },
};
