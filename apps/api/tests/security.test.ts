import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { LoginRateLimiter } from "../src/auth/rate-limit";
import { clientIp } from "../src/auth/service";
import { normalizeOrigin, parseAllowedOrigins, parseTrustedProxyAddresses } from "../src/security/http";
import { decryptBackup, encryptBackup, isEncryptedBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";

const keyText = Buffer.alloc(32, 7).toString("base64");
const otherKeyText = Buffer.alloc(32, 8).toString("base64");

describe("login rate limiting", () => {
  it("limits IP, account, and global dimensions with an injectable clock", () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({ windowMs: 100, perIp: 2, perAccount: 3, global: 4, maxEntries: 8 }, () => now);
    expect(limiter.consume("10.0.0.1", " user ").allowed).toBe(true);
    expect(limiter.consume("10.0.0.1", "user").allowed).toBe(true);
    expect(limiter.consume("10.0.0.1", "user")).toMatchObject({ allowed: false, limitedBy: "ip", retryAfterSeconds: 1 });
    now += 101;
    expect(limiter.consume("10.0.0.1", "user").allowed).toBe(true);
    limiter.resetAccount(" user ");
    expect(limiter.size).toBe(2);
  });

  it("bounds attacker-controlled keys and applies the global ceiling", () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({ windowMs: 100, perIp: 10, perAccount: 10, global: 3, maxEntries: 3 }, () => now);
    expect(limiter.consume("10.0.0.1", "a").allowed).toBe(true);
    expect(limiter.consume("10.0.0.2", "b").allowed).toBe(true);
    expect(limiter.consume("10.0.0.3", "c").allowed).toBe(true);
    expect(limiter.consume("10.0.0.4", "d")).toMatchObject({ allowed: false, limitedBy: "global" });
    expect(limiter.size).toBeLessThanOrEqual(3);
    now += 101;
    expect(limiter.consume("10.0.0.4", "d").allowed).toBe(true);
  });
});

describe("proxy trust and Origin protection", () => {
  it("uses the direct peer unless an exact trusted proxy is configured", () => {
    const request = new Request("http://local/", { headers: { "x-forwarded-for": "203.0.113.7", forwarded: "for=203.0.113.8" } });
    const server = { requestIP: () => ({ address: "10.0.0.2" }) };
    expect(clientIp(request, server)).toBe("10.0.0.2");
    expect(clientIp(request, server, ["10.0.0.2"])).toBe("203.0.113.7");
    expect(parseTrustedProxyAddresses("10.0.0.2, 10.0.0.3")).toEqual(["10.0.0.2", "10.0.0.3"]);
    expect(() => parseTrustedProxyAddresses("proxy.example")).toThrow();
  });

  it("rejects foreign Origins and protects cookie-authenticated unsafe requests", async () => {
    const app = createApp() as any;
    app.post("/test-mutate", () => ({ ok: true }));
    const allowed = await app.handle(new Request("http://local/test-mutate", { method: "POST", headers: { cookie: "astyx_session=test", origin: "http://localhost:5173" } }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    const foreign = await app.handle(new Request("http://local/test-mutate", { method: "POST", headers: { cookie: "astyx_session=test", origin: "https://attacker.example" } }));
    expect(foreign.status).toBe(403);
    const malformed = await app.handle(new Request("http://local/test-mutate", { method: "POST", headers: { cookie: "astyx_session=test", origin: "https://localhost:5173.evil" } }));
    expect(malformed.status).toBe(403);
    const browserWithoutOrigin = await app.handle(new Request("http://local/test-mutate", { method: "POST", headers: { cookie: "astyx_session=test", "sec-fetch-site": "same-origin" } }));
    expect(browserWithoutOrigin.status).toBe(403);
    const nonBrowser = await app.handle(new Request("http://local/test-mutate", { method: "POST", headers: { cookie: "astyx_session=test" } }));
    expect(nonBrowser.status).toBe(200);
    const options = await app.handle(new Request("http://local/test-mutate", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } }));
    expect(options.status).toBe(204);
  });

  it("normalizes exact origins without substring matching", () => {
    expect(normalizeOrigin("https://example.test/")).toBe("https://example.test");
    expect(parseAllowedOrigins("https://example.test, https://example.test/", [])).toEqual(["https://example.test"]);
    expect(parseAllowedOrigins("https://example.test.evil", [])).toEqual(["https://example.test.evil"]);
  });
});

describe("authenticated backup envelope", () => {
  const config = parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", authCookieSecret: "a-different-auth-secret-with-32-chars" })!;

  it("round-trips with authenticated metadata and unique nonces", () => {
    const first = encryptBackup(Buffer.from("synthetic sqlite bytes"), config);
    const second = encryptBackup(Buffer.from("synthetic sqlite bytes"), config);
    expect(isEncryptedBackup(first)).toBe(true);
    expect(decryptBackup(first, config).toString()).toBe("synthetic sqlite bytes");
    expect(JSON.parse(first.toString()).nonce).not.toBe(JSON.parse(second.toString()).nonce);
  });

  it("fails closed for wrong keys, tampering, truncation, and unknown versions", () => {
    const artifact = encryptBackup(Buffer.from("synthetic sqlite bytes"), config);
    const wrong = parseBackupEncryptionConfig({ activeKey: otherKeyText, activeKeyId: "primary", authCookieSecret: "a-different-auth-secret-with-32-chars" })!;
    expect(() => decryptBackup(artifact, wrong)).toThrow();
    for (const mutate of [
      (value: any) => { value.ciphertext = Buffer.from("tampered").toString("base64"); },
      (value: any) => { value.tag = Buffer.alloc(16, 1).toString("base64"); },
      (value: any) => { value.keyId = "primary-2"; },
      (value: any) => { value.version = 99; },
    ]) {
      const value = JSON.parse(artifact.toString()); mutate(value);
      expect(() => decryptBackup(Buffer.from(JSON.stringify(value)), config)).toThrow();
    }
    expect(() => decryptBackup(artifact.subarray(0, artifact.length - 3), config)).toThrow();

    const rotated = parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", previousKeys: JSON.stringify({ previous: otherKeyText }), authCookieSecret: "a-different-auth-secret-with-32-chars" })!;
    const rotatedArtifact = encryptBackup(Buffer.from("synthetic sqlite bytes"), rotated);
    const metadataTampered = JSON.parse(rotatedArtifact.toString());
    metadataTampered.keyId = "previous";
    expect(() => decryptBackup(Buffer.from(JSON.stringify(metadataTampered)), rotated)).toThrow();
    const oldArtifact = encryptBackup(Buffer.from("old synthetic sqlite bytes"), parseBackupEncryptionConfig({ activeKey: otherKeyText, activeKeyId: "previous", authCookieSecret: "a-different-auth-secret-with-32-chars" })!);
    expect(decryptBackup(oldArtifact, rotated).toString()).toBe("old synthetic sqlite bytes");
  });

  it("validates key size and forbids cookie-secret reuse", () => {
    expect(() => parseBackupEncryptionConfig({ activeKey: Buffer.alloc(31).toString("base64"), activeKeyId: "primary" })).toThrow();
    expect(() => parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", authCookieSecret: keyText })).toThrow("must differ");
    expect(() => parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", previousKeys: JSON.stringify({ previous: keyText }), authCookieSecret: keyText })).toThrow("must differ");
    const rotated = parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", previousKeys: JSON.stringify({ previous: otherKeyText }) });
    expect(rotated?.keys.has("previous")).toBe(true);
    expect(rotated?.allowLegacyPlaintext).toBe(false);
    expect(parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", allowLegacyPlaintext: true })?.allowLegacyPlaintext).toBe(true);
    expect(() => parseBackupEncryptionConfig({ activeKey: keyText, activeKeyId: "primary", previousKeys: "[]" })).toThrow();
  });
});
