# Platform Foundation Security Review

Reviewed 2026-07-14 for milestone `v0.9.0-platform-foundation`.

## Authentication

- Passwords are hashed with Argon2id; the minimum accepted password length is 12 characters. No plaintext password column exists.
- Unknown-user login performs a dummy password verification to reduce username timing disclosure.
- Consecutive failures trigger a configurable temporary account lock.
- Session tokens are random, stored only as HMAC-SHA256 digests, and expire on both idle and absolute deadlines.
- Logout revokes the database session and deletes the HttpOnly, SameSite=Lax cookie.
- `Secure` cookies are deployment-controlled and must be enabled whenever HTTPS is used.
- The application fails closed without a persistent `AUTH_COOKIE_SECRET` of at least 32 characters.

## First-run setup

- There is no seeded administrator or default password.
- Setup closes permanently after the first user; an existing legacy user also closes setup.
- SQLite uses `BEGIN IMMEDIATE`; PostgreSQL locks the singleton state row. A process lock also serializes same-process attempts.
- Non-loopback setup can be protected with a constant-time compared `ASTRYX_SETUP_TOKEN`.
- Setup is provisioning only, not an open registration endpoint.

## Authorization

- Backup listing, status, creation, scheduling, history, and restore require backend `admin` authorization.
- Destructive system reset requires backend `admin` authorization before the feature flag and confirmation token are evaluated.
- Executive report payloads and exports require an authenticated backend session; `admin` and `staff` roles may access them.
- Frontend route guards improve flow only and are not treated as security controls.
- No user-management API exists in this milestone; therefore there is no user-management authorization surface to certify.

## Export and operational data

- Report permissions are evaluated before report assembly or export.
- PDF and XLSX report artifacts are generated in memory without temporary report files.
- Export scope is constrained by validated academic-year, month, scope, class, and subject filters.
- Authentication audit records never contain raw passwords, session tokens, or the cookie secret.
- Restore audit metadata uses a session digest, not the raw cookie.

## Known limitations

- Application-scheduled snapshots support file-backed SQLite only. PostgreSQL uses separate operational scripts.
- Restore is intentionally restricted to a configured single-worker backend until a cross-process restore lock exists.
- `COOKIE_SECURE=false` is appropriate only for loopback HTTP development; HTTPS deployments must explicitly set it to `true`.
- PostgreSQL SQL contracts are covered in automated tests, but release acceptance still requires execution against the target PostgreSQL 16 environment.
