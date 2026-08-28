# Phase 15 security hardening evidence

Phase 15 adds layered login limits, explicit proxy trust, exact Origin
protection, explicit credentialed CORS, and AES-256-GCM application backup
encryption. It also adds Bun dependency auditing and rotation runbooks.

The final merged main SHA is `f80e16d6955ecf04f87e337dfaeb7c60e1879eb8`. The
accepted Phase 14 base is
`52cec9cf04c29a42013fc55db8f1313454b8ab6f`.

The default login limits are 20 attempts per IP, 10 per trimmed account, and
100 globally per 60-second window. The limiter is bounded to 10,000 keys.
Forwarded headers remain untrusted unless exact proxy IPs are configured.
Cookie-authenticated unsafe requests require an exact allowed Origin.

New backups use version 1 `OPERATOROS_BACKUP` envelopes with AES-256-GCM,
12-byte random nonces, authenticated metadata, and a non-secret key ID.
`BACKUP_ENCRYPTION_KEY` is a separate 32-byte Base64 key. Existing plaintext
backups are not rewritten. Legacy restore requires explicit opt-in.

The security audit command is `bun run security:audit`. It uses Bun audit.
Two transitive advisories remain temporary and documented with review dates.

Phase 14 architecture and the canonical `OPERATOROS_DATA_DIR` remain valid.
The protected operational database was not accessed. Provider history cleanup
remains pending and unverified. Phase 16 has not started.
