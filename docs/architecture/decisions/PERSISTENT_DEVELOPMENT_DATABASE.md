# Persistent development database

Status: Accepted

OperatorOS uses one `PERSISTENT_LOCAL_DEVELOPMENT_DATABASE` across managed
development sessions for worktrees sharing a Git common directory. Runtime
sessions are `EPHEMERAL_OWNED_PROCESS_SESSIONS` and contain no authoritative
database. A single verified active session may use the shared database.

This supersedes the earlier disposable-development-database decision for normal
development only. It does not alter production, protected operational, E2E, or
future packaged-desktop database contracts.
