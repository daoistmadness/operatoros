import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { getCurrentUser, login, logout } from "./auth";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

const user = { id: 1, username: "administrator", role: "admin" as const };

describe("authentication API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs in through the canonical cookie-session endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: user, status: 200, headers: {} });
    await expect(login("administrator", "secret")).resolves.toEqual(user);
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/auth/login", method: "POST", body: { username: "administrator", password: "secret" } });
  });

  it("loads the current session through the canonical endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: user, status: 200, headers: {} });
    await getCurrentUser();
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/auth/me" });
  });

  it("logs out through the canonical endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: null, status: 204, headers: {} });
    await logout();
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/auth/logout", method: "POST" });
  });
});
