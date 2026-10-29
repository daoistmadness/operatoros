import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { LoginRateLimiter } from "../src/auth/rate-limit";
import { clientIp } from "../src/auth/service";
import { normalizeOrigin, parseAllowedOrigins, parseTrustedProxyAddresses } from "../src/security/http";
import { backupSha256, decryptBackup, decryptBackupFileSync, encryptBackup, encryptBackupFileSync, hashBackupFileSync, isEncryptedBackup, isEncryptedBackupFile, parseBackupEncryptionConfig } from "../src/security/backup-crypto";

const keyText = Buffer.alloc(32, 7).toString("base64");
const otherKeyText = Buffer.alloc(32, 8).toString("base64");

describe("managed development process configuration", () => {
  it("produces loopback local and exact Tailnet API settings for the actual server config", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "operatoros-managed-config-"));
    const base = { OPERATOROS_DATA_DIR: dataRoot, OPERATOROS_REPOSITORY_ROOT: resolve(process.cwd(), "../.."), HOST: "127.0.0.1", TRUSTED_PROXY_ADDRESSES: "" };
    try {
      const local = loadConfig({ ...base, PORT: "8098", COOKIE_SECURE: "false", ALLOWED_ORIGINS: "http://127.0.0.1:5198,http://localhost:5198" });
      expect(local.hostname).toBe("127.0.0.1");
      expect(local.port).toBe(8098);
      expect(local.auth?.cookieSecure).toBe(false);
      expect(local.auth?.allowedOrigins).toEqual(["http://127.0.0.1:5198", "http://localhost:5198"]);
      expect(local.auth?.trustedProxyAddresses).toEqual([]);

      const tailnetOrigin = "https://node.tailnet.ts.net:8444";
      const tailnet = loadConfig({ ...base, PORT: "8099", COOKIE_SECURE: "true", ALLOWED_ORIGINS: tailnetOrigin });
      expect(tailnet.hostname).toBe("127.0.0.1");
      expect(tailnet.port).toBe(8099);
      expect(tailnet.auth?.cookieSecure).toBe(true);
      expect(tailnet.auth?.allowedOrigins).toEqual([tailnetOrigin]);
      expect(tailnet.auth?.trustedProxyAddresses).toEqual([]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

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
    app.get("/test-safe", () => ({ ok: true }));
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
    expect(nonBrowser.status).toBe(403);
    const safeWithoutOrigin = await app.handle(new Request("http://local/test-safe", { headers: { cookie: "astyx_session=test" } }));
    expect(safeWithoutOrigin.status).toBe(200);
    const unauthenticatedPost = await app.handle(new Request("http://local/test-mutate", { method: "POST" }));
    expect(unauthenticatedPost.status).toBe(200);
    const options = await app.handle(new Request("http://local/test-mutate", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } }));
    expect(options.status).toBe(204);
  });

  it("marks API responses non-cacheable while leaving non-API health responses unchanged", async () => {
    const app = createApp() as any;
    app.get("/api/test-sensitive", () => ({ value: "synthetic" }));
    app.get("/health", () => ({ status: "ok" }));

    const apiResponse = await app.handle(new Request("http://local/api/test-sensitive"));
    const healthResponse = await app.handle(new Request("http://local/health"));

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get("cache-control")).toContain("private");
    expect(apiResponse.headers.get("cache-control")).toContain("no-store");
    expect(healthResponse.headers.get("cache-control")).toBeNull();
  });

  it("requires the exact Tailnet Origin for cookie-authenticated POST, PUT, PATCH, and DELETE", async () => {
    const origin = "https://node.tailnet.ts.net:8444";
    const app = createApp({ auth: { allowedOrigins: [origin] } }) as any;
    const handler = () => ({ ok: true });
    app.post("/tailnet-mutate", handler);
    app.put("/tailnet-mutate", handler);
    app.patch("/tailnet-mutate", handler);
    app.delete("/tailnet-mutate", handler);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const headers = { cookie: "astyx_session=synthetic", origin };
      expect((await app.handle(new Request("https://local/tailnet-mutate", { method, headers }))).status).toBe(200);
      expect((await app.handle(new Request("https://local/tailnet-mutate", { method, headers: { ...headers, origin: "https://other.tailnet.ts.net:8444" } }))).status).toBe(403);
    }
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

  it("streams encrypted files in both directions without changing the v1 envelope", () => {
    const directory = mkdtempSync(join(tmpdir(), "operatoros-backup-crypto-file-"));
    const plaintext = randomBytes(128 * 1024 + 7);
    const source = join(directory, "snapshot.sqlite");
    const streamed = join(directory, "streamed.sqlite3");
    const restored = join(directory, "restored.sqlite");
    const compatible = join(directory, "compatible.sqlite3");
    const compatibleRestore = join(directory, "compatible.sqlite");
    try {
      writeFileSync(source, plaintext, { mode: 0o600 });
      const encryptedInfo = encryptBackupFileSync(source, streamed, config);
      expect(encryptedInfo.plaintextSize).toBe(plaintext.length);
      expect(encryptedInfo.plaintextSha256).toBe(backupSha256(plaintext));
      expect(encryptedInfo.encryptedSha256).toBe(hashBackupFileSync(streamed));
      expect(isEncryptedBackupFile(streamed)).toBe(true);
      const envelope = JSON.parse(readFileSync(streamed, "utf8")) as { version: number; algorithm: string; keyId: string; tag: string };
      expect(envelope).toMatchObject({ version: 1, algorithm: "aes-256-gcm", keyId: "primary" });
      expect(Buffer.from(envelope.tag, "base64")).toHaveLength(16);
      expect(decryptBackup(readFileSync(streamed), config)).toEqual(plaintext);

      const decryptedInfo = decryptBackupFileSync(streamed, restored, config);
      expect(readFileSync(restored)).toEqual(plaintext);
      expect(decryptedInfo).toMatchObject({
        encryptedSize: encryptedInfo.encryptedSize,
        encryptedSha256: encryptedInfo.encryptedSha256,
        plaintextSize: plaintext.length,
        plaintextSha256: backupSha256(plaintext),
      });

      writeFileSync(compatible, encryptBackup(plaintext, config), { mode: 0o600 });
      expect(decryptBackupFileSync(compatible, compatibleRestore, config).plaintextSha256).toBe(backupSha256(plaintext));
      expect(readFileSync(compatibleRestore)).toEqual(plaintext);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("removes partial plaintext when streamed envelope authentication or framing fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "operatoros-backup-crypto-failure-"));
    const encryptedPath = join(directory, "backup.sqlite3");
    const plaintextPath = join(directory, "candidate.sqlite");
    const original = encryptBackup(randomBytes(70 * 1024 + 1), config);
    try {
      const tampered = JSON.parse(original.toString()) as { ciphertext: string };
      const ciphertext = Buffer.from(tampered.ciphertext, "base64");
      ciphertext[0] = ciphertext[0]! ^ 1;
      tampered.ciphertext = ciphertext.toString("base64");
      writeFileSync(encryptedPath, JSON.stringify(tampered), { mode: 0o600 });
      expect(() => decryptBackupFileSync(encryptedPath, plaintextPath, config)).toThrow("could not be authenticated");
      expect(() => readFileSync(plaintextPath)).toThrow();

      writeFileSync(encryptedPath, original.subarray(0, original.length - 1), { mode: 0o600 });
      expect(() => decryptBackupFileSync(encryptedPath, plaintextPath, config)).toThrow();
      expect(() => readFileSync(plaintextPath)).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
