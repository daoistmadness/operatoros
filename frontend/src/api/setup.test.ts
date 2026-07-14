import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { getSetupStatus, provisionFirstAdmin } from "./setup";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));
const mocked = vi.mocked(apiRequest);

describe("setup API", () => {
  beforeEach(() => mocked.mockReset());

  it("uses canonical setup status path", async () => {
    mocked.mockResolvedValue({ data: { setup_required: true, setup_token_required: false } } as never);
    await expect(getSetupStatus()).resolves.toEqual({ setup_required: true, setup_token_required: false });
    expect(mocked).toHaveBeenCalledWith({ path: "/api/setup/status" });
  });

  it("posts first-admin secrets only in the request body", async () => {
    mocked.mockResolvedValue({ data: { id: 1, username: "admin", role: "admin" } } as never);
    const input = { username: "admin", password: "correct horse battery", password_confirmation: "correct horse battery", setup_token: "protected" };
    await provisionFirstAdmin(input);
    expect(mocked).toHaveBeenCalledWith({ path: "/api/setup/admin", method: "POST", body: input });
  });
});
