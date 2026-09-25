import type { DataResetCommitRequest, DataResetPreviewRequest, DataResetPreviewResponse, DataResetResult } from "@operatoros/contracts/system";
import { apiRequest } from "../lib/api/client";

export const previewDataReset = async (scope: DataResetPreviewRequest["scope"]) =>
  (await apiRequest<DataResetPreviewResponse>({ path: "/api/system/data-reset/preview", method: "POST", body: { scope } })).data;

export const commitDataReset = async (body: DataResetCommitRequest) =>
  (await apiRequest<DataResetResult>({ path: "/api/system/data-reset", method: "POST", body })).data;
