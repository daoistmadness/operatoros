import { apiRequest } from "../lib/api/client";

export interface SetupStatus {
  setup_required: boolean;
  setup_token_required: boolean;
}

export interface FirstAdminInput {
  username: string;
  password: string;
  password_confirmation: string;
  setup_token?: string;
}

export interface ProvisionedAdmin {
  id: number;
  username: string;
  role: "admin";
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return (await apiRequest<SetupStatus>({ path: "/api/setup/status" })).data;
}

export async function provisionFirstAdmin(input: FirstAdminInput): Promise<ProvisionedAdmin> {
  return (await apiRequest<ProvisionedAdmin>({ path: "/api/setup/admin", method: "POST", body: input })).data;
}
