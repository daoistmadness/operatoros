import { apiRequest } from "../../../lib/api/client";
import type {
  ReadinessLegacyStatus,
  ReadinessLegacyStep,
  ReadinessRequirement,
  ReadinessResponse,
  ReadinessLegacyStepStatus,
} from "@operatoros/contracts/readiness";

export type ReadinessStatus = ReadinessLegacyStatus;
export type ReadinessStepStatus = ReadinessLegacyStepStatus;
export type ReadinessStep = ReadinessLegacyStep;
export type { ReadinessRequirement, ReadinessResponse };

export async function getReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  const response = await apiRequest<ReadinessResponse>({
    path: "/api/readiness",
    ...(signal ? { signal } : {}),
  });
  return response.data;
}
