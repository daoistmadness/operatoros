import { apiRequest } from "../lib/api/client";

export type ReadinessStatus = "FIRST_RUN" | "SETUP_PARTIAL" | "READY_WITH_RECOMMENDATIONS" | "OPERATIONALLY_READY" | "READ_ONLY_GUIDANCE";
export type ReadinessStepStatus = "NOT_STARTED" | "COMPLETE" | "OPTIONAL";
export type ReadinessRequirement = "REQUIRED" | "WORKFLOW" | "RECOMMENDED" | "OPTIONAL";

export interface ReadinessStep {
  code: string;
  name: string;
  status: ReadinessStepStatus;
  requirement: ReadinessRequirement;
  reason: string;
  destination: string | null;
  can_manage: boolean;
  responsibility: string | null;
}

export interface ReadinessResponse {
  overall_status: ReadinessStatus;
  steps: ReadinessStep[];
}

export async function getReadiness(): Promise<ReadinessResponse> {
  return (await apiRequest<ReadinessResponse>({ path: "/api/readiness" })).data;
}
