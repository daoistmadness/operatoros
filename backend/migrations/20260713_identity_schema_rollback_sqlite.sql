-- Roll back Phase 7.1 on SQLite. This permanently removes identity/session data.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
COMMIT;
