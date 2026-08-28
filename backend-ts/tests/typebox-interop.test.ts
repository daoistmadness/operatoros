import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { Type } from "@sinclair/typebox";

const requestSchema = Type.Object({ name: Type.String({ minLength: 1 }) });
const responseSchema = Type.Object({ ok: Type.Boolean() });

function createInteropApp() {
  return new Elysia()
    .use(openapi({ path: "/openapi" }))
    .post("/interop", ({ body }) => ({ ok: body.name.length > 0 }), {
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
      body: JSON.stringify({ name: "OperatorOS" }),
    }));
    const invalid = await app.handle(new Request("http://local/interop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    }));

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ ok: true });
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
});
