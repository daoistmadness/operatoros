import type { AvailableJenjangResponse } from "@operatoros/contracts/config";
import { apiRequest } from "../lib/api/client";

export async function fetchAvailableJenjang(): Promise<AvailableJenjangResponse> {
  return (await apiRequest<AvailableJenjangResponse>({ path: "/api/config/jenjang/available" })).data;
}
