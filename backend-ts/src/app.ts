import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";
import type { BackendConfig } from "./config";
import { openDatabase } from "./db/connection";
import { authRoutes } from "./auth/routes";
import { defaultAuthConfig } from "./auth/service";
import { coreRoutes } from "./domains/core";
import { configRoutes, readinessRoutes, systemRoutes } from "./domains/config";
import { attendanceRoutes } from "./domains/attendance";
import { attendanceImportRoutes } from "./domains/attendance-import";
import { gradeRoutes } from "./domains/grades";
import { interventionRoutes } from "./domains/interventions";
import { progressionRoutes } from "./domains/progression";
import { reportRoutes } from "./domains/reports";
import { safetyRoutes } from "./domains/safety";
import { operatorRoutes } from "./domains/operator";
import { teacherAssignmentRoutes } from "./domains/teacher-assignments";
import { studentExportRoutes } from "./domains/student-exports";
import { rosterRoutes } from "./domains/roster";
import { studentImportSessionRoutes } from "./domains/student-import-sessions";
import { dataPortabilityRoutes } from "./domains/data-portability";
import { uploadHistoryRoutes } from "./domains/upload-history";
import { attendanceFollowupRoutes } from "./domains/attendance-followups";
import { reportBuilderRoutes } from "./domains/report-builder";
import { uploadConflictRoutes } from "./domains/upload-conflicts";
import { studentUpdateRoutes } from "./domains/student-update";
import { phase10OpenApiDocumentation } from "./openapi-contract";

export interface AppError { error: { code: string; message: string } }

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(_config: Partial<BackendConfig> = {}) {
  const database = _config.databaseHandle ?? (_config.databasePath ? openDatabase(_config.databasePath) : undefined);
  const context = database && _config.auth?.authCookieSecret ? { database, config: defaultAuthConfig(_config.auth) } : null;
  const app = new Elysia({ name: "backend-ts" })
    .onError(({ code, set }) => {
      set.headers["content-type"] = "application/json";
      if (code === "VALIDATION") {
        set.status = 400;
        return errorBody("VALIDATION_ERROR", "Request failed schema validation.");
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return errorBody("NOT_FOUND", "Unknown route.");
      }
      set.status = 500;
      return errorBody("INTERNAL_ERROR", "Internal server error.");
    })
    .get("/", () => ({ status: "ok", message: "School Attendance Analytics API" }))
    .get("/health", () => ({ status: "ok" }))
    .get("/ready", () => ({ ready: true, persistence: database ? "sqlite" : "not-configured" }));

  if (context) {
    authRoutes(app, context);
    coreRoutes(app, context);
    configRoutes(app, context);
    readinessRoutes(app, context);
    attendanceRoutes(app, context);
    attendanceImportRoutes(app, context);
    gradeRoutes(app, context);
    interventionRoutes(app, context);
    progressionRoutes(app, context);
    reportRoutes(app, context);
    operatorRoutes(app, context);
    teacherAssignmentRoutes(app, context);
    studentExportRoutes(app, context);
    rosterRoutes(app, context);
    studentImportSessionRoutes(app, context);
    dataPortabilityRoutes(app, context);
    uploadHistoryRoutes(app, context);
    attendanceFollowupRoutes(app, context);
    reportBuilderRoutes(app, context);
    uploadConflictRoutes(app, context);
    studentUpdateRoutes(app, context);
    safetyRoutes(app, context, {
      backupDir: _config.backupDir ?? context.config.auditDir,
      destructiveOperationsEnabled: _config.destructiveOperationsEnabled ?? false,
    });
  }
  systemRoutes(app, context, { destructiveOperationsEnabled: _config.destructiveOperationsEnabled ?? false });

  if (_config.environment !== "test") {
    app.use(openapi({
      path: "/openapi",
      exclude: { staticFile: false },
      documentation: context ? phase10OpenApiDocumentation() : undefined,
    }));
  }
  return app;
}

export { t };
export type { AppError as AppErrorShape };
export function createTestApp() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = createApp({ environment: "test" }) as any;
  app.post("/diag/body", ({ body }: any) => ({ echo: body }), { body: t.Object({ name: t.String(), count: t.Number() }) });
  app.get("/diag/query", ({ query }: any) => ({ echo: query }), { query: t.Object({ limit: t.Number({ minimum: 1 }) }) });
  app.get("/diag/param/:id", ({ params }: any) => ({ id: params.id }), { params: t.Object({ id: t.Number() }) });
  app.get("/diag/broken-response", () => ({ unexpected: true }), { response: t.Object({ expected: t.String() }) });
  app.get("/diag/internal", () => { throw new Error("secret internal detail /abs/path"); });
  return app;
}
