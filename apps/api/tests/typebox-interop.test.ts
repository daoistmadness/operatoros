import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { AuthUserSchema, LoginRequestSchema } from "@operatoros/contracts/auth";
import { ReportScopeSchema } from "@operatoros/contracts/reports";
import { Type } from "@sinclair/typebox";

const requestSchema = LoginRequestSchema;
const responseSchema = AuthUserSchema;

function createInteropApp() {
  return new Elysia()
    .use(openapi({ path: "/openapi" }))
    .post("/interop", ({ body }) => ({
      id: 1,
      username: body.username,
      role: "admin" as const,
      capabilities: [],
    }), {
      body: requestSchema,
      response: responseSchema,
    })
    .get("/invalid-response", () => ({ wrong: true } as never), { response: responseSchema });
}

describe("TypeBox and Elysia interoperability", () => {
  it("accepts valid requests and rejects invalid requests", async () => {
    const app = createInteropApp();
    const valid = await app.handle(new Request("http://local/interop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "OperatorOS", password: "secret" }),
    }));
    const invalid = await app.handle(new Request("http://local/interop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "", password: "secret" }),
    }));

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ id: 1, username: "OperatorOS", role: "admin", capabilities: [] });
    expect(invalid.status).toBe(422);
  });

  it("enforces response schemas and emits OpenAPI", async () => {
    const app = createInteropApp();
    const server = app.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (server.server as unknown as { port: number }).port;
    try {
      const invalidResponse = await fetch(`http://127.0.0.1:${port}/invalid-response`);
      const openApiResponse = await fetch(`http://127.0.0.1:${port}/openapi/json`);
      const openApi = await openApiResponse.json() as { paths?: Record<string, unknown> };
      expect(invalidResponse.status).not.toBe(200);
      expect(openApiResponse.status).toBe(200);
      expect(openApi.paths?.["/interop"]).toBeDefined();
    } finally {
      (server.server as unknown as { stop(closeActiveConnections?: boolean): void }).stop(true);
    }
  }, 15000);

  it("keeps Elysia query coercion at the transport boundary", async () => {
    const app = new Elysia().get("/query", ({ query }) => query, {
      query: t.Object({ academic_year_id: t.Number({ minimum: 1 }), scope: ReportScopeSchema }),
      response: Type.Object({ academic_year_id: Type.Number({ minimum: 1 }), scope: ReportScopeSchema }),
    });
    const valid = await app.handle(new Request("http://local/query?academic_year_id=7&scope=primary"));
    const invalid = await app.handle(new Request("http://local/query?academic_year_id=7&scope=unknown"));

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ academic_year_id: 7, scope: "primary" });
    expect(invalid.status).toBe(422);
  });
});
