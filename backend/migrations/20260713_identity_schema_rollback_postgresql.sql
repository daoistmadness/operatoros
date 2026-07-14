-- Roll back Phase 7.1 on PostgreSQL. This permanently removes identity/session data.
BEGIN;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
COMMIT;
