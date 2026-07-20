import type { ReportQuery, ReportScope, ReportType } from "../../api/reports";

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
  students: {
    all: ["students"] as const,
    lists: ["students", "list"] as const,
    list: (filters: Record<string, unknown>) => ["students", "list", filters] as const,
    details: ["students", "detail"] as const,
    detail: (id: string) => ["students", "detail", id] as const,
    quality: ["students", "quality"] as const,
    history: (id: string) => ["students", "history", id] as const,
    deviceIdentities: (id: string) => ["students", "devices", id] as const,
    enrollments: (id: string) => ["students", "enrollments", id] as const,
    importSessions: ["students", "imports"] as const,
    importSession: (id: string) => ["students", "imports", id] as const,
  },
};
