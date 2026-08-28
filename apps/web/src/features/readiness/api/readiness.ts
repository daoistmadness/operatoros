import { apiRequest } from "../../../lib/api/client";
import { ApiError } from "../../../lib/api/errors";
import type { paths } from "../../../generated/openapi/schema";

export type ReadinessStatus = "FIRST_RUN" | "SETUP_PARTIAL" | "READY_WITH_RECOMMENDATIONS" | "OPERATIONALLY_READY" | "READ_ONLY_GUIDANCE";
export type ReadinessStepStatus = "NOT_STARTED" | "COMPLETE" | "OPTIONAL";
export type ReadinessRequirement = "REQUIRED" | "WORKFLOW" | "RECOMMENDED" | "OPTIONAL";

type GeneratedReadinessResponse =
  paths["/api/readiness"]["get"]["responses"][200]["content"]["application/json"];
type GeneratedReadinessStep = GeneratedReadinessResponse["steps"][number];

export interface ReadinessStep extends Omit<GeneratedReadinessStep, "status" | "requirement"> {
  status: ReadinessStepStatus;
  requirement: ReadinessRequirement;
}

export interface ReadinessResponse extends Omit<GeneratedReadinessResponse, "overall_status" | "steps"> {
  overall_status: ReadinessStatus;
  steps: ReadinessStep[];
}

const READINESS_STATUSES: readonly ReadinessStatus[] = [
  "FIRST_RUN",
  "SETUP_PARTIAL",
  "READY_WITH_RECOMMENDATIONS",
  "OPERATIONALLY_READY",
  "READ_ONLY_GUIDANCE",
];
const STEP_STATUSES: readonly ReadinessStepStatus[] = ["NOT_STARTED", "COMPLETE", "OPTIONAL"];
const REQUIREMENTS: readonly ReadinessRequirement[] = ["REQUIRED", "WORKFLOW", "RECOMMENDED", "OPTIONAL"];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isReadinessStep(value: unknown): value is ReadinessStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.code === "string" &&
    typeof step.name === "string" &&
    typeof step.status === "string" &&
    STEP_STATUSES.includes(step.status as ReadinessStepStatus) &&
    typeof step.requirement === "string" &&
    REQUIREMENTS.includes(step.requirement as ReadinessRequirement) &&
    typeof step.reason === "string" &&
    isNullableString(step.destination) &&
    typeof step.can_manage === "boolean" &&
    isNullableString(step.responsibility)
  );
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.overall_status !== "string" ||
    !READINESS_STATUSES.includes(response.overall_status as ReadinessStatus)
  ) ? false : Array.isArray(response.steps) && response.steps.every(isReadinessStep);
}

function normalizeReadiness(value: unknown): ReadinessResponse {
  if (!isReadinessResponse(value)) {
    throw new ApiError("The server returned an unexpected readiness response.", { kind: "contract" });
  }
  return value;
}

export async function getReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  const response = await apiRequest<GeneratedReadinessResponse>({
    path: "/api/readiness",
    ...(signal ? { signal } : {}),
  });
  return normalizeReadiness(response.data);
}
