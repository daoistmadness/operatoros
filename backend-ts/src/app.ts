import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";
import type { BackendConfig } from "./config";

export interface AppError { error: { code: string; message: string } }

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(_config: Partial<BackendConfig> = {}) {
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
    .get("/health", () => ({ status: "ok" }))
    .get("/ready", () => ({ ready: true, persistence: "not-configured" }));

  if (_config.environment !== "test") {
    app.use(openapi({ path: "/openapi" }));
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
