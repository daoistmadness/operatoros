---
status: deprecated
last_reviewed: 2026-10-26
---

# Legacy S4.3 migration source

This preserved source archive contains the historical S4.2-to-S4.3 migration
wrapper. It is evidence only; it is not a supported command and must not be
executed from this repository.

The archive is retained as a standalone reference at
[legacy-s43-migration.tar.gz](legacy-s43-migration.tar.gz). Its SHA-256 is
1f25481c6d5653754f09ff735ba4634dcda1449668650b6c695fe10a4675b38c.

Current application startup validates existing databases and does not migrate
them. The forward migration tooling supports only its recognized source
schemas; it does not provide the historical S4.2-to-S4.3 operation. Follow the
[database operations runbook](../runbooks/database-operations.md) for current
schema and recovery policy. Any new legacy migration requires a separately
reviewed, fingerprint-gated tool and explicit operational authorization.
