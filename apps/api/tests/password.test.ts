import { describe, expect, it } from "bun:test";
import { hashPassword, hashPasswordSync, verifyPassword, verifyPasswordSync } from "../src/auth/password";

describe("Argon2id runtime compatibility", () => {
  it("verifies existing Bun hashes and emits hashes Bun can verify", async () => {
    const password = "synthetic-cross-runtime-password-123";
    const bunHash = Bun.password.hashSync(password, "argon2id");

    expect(await verifyPassword(password, bunHash)).toBe(true);
    expect(await verifyPassword("wrong-password", bunHash)).toBe(false);

    const previousHash = "$argon2id$v=19$m=65536,t=2,p=1$BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc$svsSZpQsGQ1slMim4gKvs3dx5rneI/jY2OcvPBLfDp0";
    expect(await verifyPassword(password, previousHash)).toBe(true);
    expect(verifyPasswordSync("wrong-password", previousHash)).toBe(false);
    const currentHash = await hashPassword(password);
    expect(Bun.password.verifySync(password, currentHash)).toBe(true);

    const syncHash = hashPasswordSync(password);
    expect(Bun.password.verifySync(password, syncHash)).toBe(true);
  });
});
