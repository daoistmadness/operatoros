import { AnalyticsCohortsResponseSchema, AnalyticsOverviewResponseSchema, AnalyticsTrendsResponseSchema } from "@operatoros/contracts/analytics";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";
import { analyticsCohorts, analyticsOverview, analyticsTrends, type AnalyticsQuery } from "../analytics/queries";

type Context = any;

const datePattern = "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$";
const querySchema = t.Object({
  academic_year_id: t.String({ pattern: "^[1-9]\\d*$" }),
  start_date: t.Optional(t.String({ pattern: datePattern })),
  end_date: t.Optional(t.String({ pattern: datePattern })),
  jenjang_id: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
  class_name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  subject_id: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
});
const cohortQuerySchema = t.Object({
  academic_year_id: t.String({ pattern: "^[1-9]\\d*$" }),
  start_date: t.Optional(t.String({ pattern: datePattern })),
  end_date: t.Optional(t.String({ pattern: datePattern })),
  jenjang_id: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
  class_name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  subject_id: t.Optional(t.String({ pattern: "^[1-9]\\d*$" })),
  dimension: t.Union([t.Literal("class"), t.Literal("jenjang")]),
});

function queryValue(ctx: Context): AnalyticsQuery {
  return {
    academic_year_id: Number(ctx.query.academic_year_id),
    start_date: ctx.query.start_date,
    end_date: ctx.query.end_date,
    jenjang_id: ctx.query.jenjang_id === undefined ? undefined : Number(ctx.query.jenjang_id),
    class_name: ctx.query.class_name,
    subject_id: ctx.query.subject_id === undefined ? undefined : Number(ctx.query.subject_id),
  };
}

function sendError(ctx: Context, error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  ctx.set.status = status;
  return { detail: status >= 500 ? "Analytics data could not be loaded." : error instanceof Error ? error.message : "Invalid analytics request." };
}

export function analyticsRoutes(app: any, context: AuthContext): void {
  const authorized = (ctx: Context) => actor(context, ctx, { capability: "view_student" });
  app.get("/api/analytics/overview", (ctx: Context) => {
    if (!authorized(ctx)) return { detail: "Insufficient permissions" };
    try { return analyticsOverview(context, queryValue(ctx)); } catch (error) { return sendError(ctx, error); }
  }, { query: querySchema, response: AnalyticsOverviewResponseSchema });
  app.get("/api/analytics/trends", (ctx: Context) => {
    if (!authorized(ctx)) return { detail: "Insufficient permissions" };
    try { return analyticsTrends(context, queryValue(ctx)); } catch (error) { return sendError(ctx, error); }
  }, { query: querySchema, response: AnalyticsTrendsResponseSchema });
  app.get("/api/analytics/cohorts", (ctx: Context) => {
    if (!authorized(ctx)) return { detail: "Insufficient permissions" };
    try { return analyticsCohorts(context, queryValue(ctx), ctx.query.dimension); } catch (error) { return sendError(ctx, error); }
  }, { query: cohortQuerySchema, response: AnalyticsCohortsResponseSchema });
}
