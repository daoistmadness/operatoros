import { apiRequest } from "../lib/api/client";
import type { AuthUser } from "@operatoros/contracts/auth";

export type { AuthUser, UserRole } from "@operatoros/contracts/auth";

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await apiRequest<AuthUser>({
    path: "/api/auth/login",
    method: "POST",
    body: { username, password },
  });
  return response.data;
}

export async function logout(): Promise<void> {
  await apiRequest({ path: "/api/auth/logout", method: "POST" });
}

export async function getCurrentUser(): Promise<AuthUser> {
  return (await apiRequest<AuthUser>({ path: "/api/auth/me" })).data;
}
