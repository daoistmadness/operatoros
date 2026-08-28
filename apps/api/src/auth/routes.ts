import { t } from "elysia";
import { LoginRequestSchema } from "@operatoros/contracts/auth";
import { capabilitiesForRole } from "./capabilities";
import {
  authenticate,
  cookieHeader,
  deleteCookieHeader,
  issueSetupAuthorization,
  logout,
  provisionFirstAdmin,
  readCookie,
  requestContext,
  SESSION_COOKIE_NAME,
  SETUP_COOKIE_NAME,
  setupStatus,
  validateSession,
  validateSetupAuthorization,
  type AuthContext,
  type ProvisioningErrorShape,
} from "./service";

function detail(set: { status?: number | string }, status: number, message: string | { code: string; message: string }): { detail: string | { code: string; message: string } } {
  set.status = status;
  return { detail: message };
}

function provisioningDetail(set: { status?: number | string }, error: unknown): { detail: { code: string; message: string } } {
  const value = error as Partial<ProvisioningErrorShape>;
  set.status = typeof value.status === "number" ? value.status : 500;
  return { detail: { code: value.code ?? "PROVISIONING_FAILED", message: value.message ?? "Administrator provisioning could not be completed." } };
}

// Elysia refines the app generic after every route. The route module only mutates it.
export function authRoutes(app: any, context: AuthContext): any {
  return app
    .post("/api/auth/login", async ({ body, request, set, server }: any) => {
      const requestInfo = requestContext(request, server, context.config.trustedProxyAddresses ?? []);
      const limit = context.loginRateLimiter?.consume(requestInfo.ipAddress, body.username);
      if (limit && !limit.allowed) {
        set.headers["retry-after"] = String(limit.retryAfterSeconds);
        return detail(set, 429, "Too many login attempts. Try again later.");
      }
      try {
        const result = await authenticate(context, { ...body, ...requestInfo });
        context.loginRateLimiter?.resetAccount(body.username);
        set.headers["set-cookie"] = cookieHeader(SESSION_COOKIE_NAME, result.token, {
          maxAge: context.config.sessionAbsoluteTimeoutHours * 3600,
          path: "/", secure: context.config.cookieSecure, sameSite: "Lax",
        });
        return { id: result.user.id, username: result.user.username, role: result.user.role, capabilities: capabilitiesForRole(result.user.role) };
      } catch (error) {
        return detail(set, 401, error instanceof Error ? error.message : "Invalid username or password");
      }
    }, {
      body: LoginRequestSchema,
    })
    .post("/api/auth/logout", ({ request, set, server }: any) => {
      const requestInfo = requestContext(request, server, context.config.trustedProxyAddresses ?? []);
      logout(context, readCookie(request, SESSION_COOKIE_NAME), requestInfo.userAgent, requestInfo.ipAddress);
      set.status = 204;
      set.headers["set-cookie"] = deleteCookieHeader(SESSION_COOKIE_NAME, "/", context.config.cookieSecure, "Lax");
      return undefined;
    })
    .get("/api/auth/me", ({ request, set }: any) => {
      const user = validateSession(context, readCookie(request, SESSION_COOKIE_NAME));
      if (!user) return detail(set, 401, "Authentication required");
      return { id: user.id, username: user.username, role: user.role, capabilities: capabilitiesForRole(user.role) };
    })
    .get("/api/setup/status", ({ set }: any) => {
      set.headers["cache-control"] = "no-store";
      return setupStatus(context);
    })
    .post("/api/setup/bootstrap", ({ request, set, server }: any) => {
      set.headers["cache-control"] = "no-store";
      if (!setupStatus(context).setup_required) return detail(set, 409, { code: "SETUP_ALREADY_COMPLETED", message: "Initial administrator setup has already been completed." });
      try {
        const authorization = issueSetupAuthorization(context, request, server);
        set.status = 204;
        set.headers["set-cookie"] = cookieHeader(SETUP_COOKIE_NAME, authorization, { maxAge: 300, path: "/api/setup", secure: context.config.cookieSecure, sameSite: "Strict" });
        return undefined;
      } catch (error) {
        return provisioningDetail(set, error);
      }
    })
    .post("/api/setup/admin", async ({ body, request, set, server }: any) => {
      set.headers["cache-control"] = "no-store";
      try {
        const setupAuthorization = validateSetupAuthorization(context, readCookie(request, SETUP_COOKIE_NAME));
        const result = await provisionFirstAdmin(context, {
          username: body.username, password: body.password, confirmation: body.password_confirmation,
          setupToken: setupAuthorization, ...requestContext(request, server, context.config.trustedProxyAddresses ?? []),
        });
        set.status = 201;
        set.headers["set-cookie"] = deleteCookieHeader(SETUP_COOKIE_NAME, "/api/setup", context.config.cookieSecure, "Strict");
        return result;
      } catch (error) {
        return provisioningDetail(set, error);
      }
    }, {
      body: t.Object({
        username: t.String({ minLength: 1, maxLength: 255 }),
        password: t.String({ minLength: 1, maxLength: 1024 }),
        password_confirmation: t.String({ minLength: 1, maxLength: 1024 }),
      }),
    });
}
