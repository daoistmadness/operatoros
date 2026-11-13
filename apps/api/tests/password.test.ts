import { describe, expect, it } from "bun:test";
import { parseOptions } from "@node-rs/argon2";
import { hashPassword, hashPasswordSync, verifyPassword, verifyPasswordSync } from "../src/auth/password";

describe("Argon2id runtime compatibility", () => {
  it("verifies existing Bun hashes and emits hashes Bun can verify", async () => {
    const password = "synthetic-cross-runtime-password-123";
    const bunHash = Bun.password.hashSync(password, "argon2id");

    expect(await verifyPassword(password, bunHash)).toBe(true);
    expect(await verifyPassword("wrong-password", bunHash)).toBe(false);

    const nodeHash = await hashPassword(password);
    expect(Bun.password.verifySync(password, nodeHash)).toBe(true);
    expect(verifyPasswordSync("wrong-password", nodeHash)).toBe(false);
    expect(parseOptions(nodeHash)).toMatchObject({
      algorithm: 2,
      memoryCost: 65_536,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      saltLen: 32,
    });

    const syncHash = hashPasswordSync(password);
    expect(Bun.password.verifySync(password, syncHash)).toBe(true);
  });
});
