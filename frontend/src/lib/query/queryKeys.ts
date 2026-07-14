import type { ReportQuery, ReportScope, ReportType } from "../../api/reports";

export const queryKeys = {
  setup: { all: ["setup"] as const, status: ["setup", "status"] as const },
  auth: { all: ["auth"] as const, me: ["auth", "me"] as const },
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
};
