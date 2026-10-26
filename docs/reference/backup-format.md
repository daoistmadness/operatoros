---
status: current
last_reviewed: 2026-10-26
---

# Backup format and ownership

The live application database is SQLite and remains unencrypted. New
application backup files use the version 1 OperatorOS envelope with AES-256-GCM.
The authenticated metadata contains the format identity, algorithm, and key
identifier; the nonce and authentication tag are stored with the ciphertext.
The manifest records a SHA-256 digest for the encrypted artifact.

The backup key is a Base64-encoded 32-byte value in
BACKUP_ENCRYPTION_KEY. Its key identifier is stored with the envelope.
BACKUP_ENCRYPTION_PREVIOUS_KEYS allows restore to read backups made with
previous keys. The backup key must differ from AUTH_COOKIE_SECRET. Never place
either secret in source control.

The API and the local CLI share the encrypted SQLite backup path, but they have
different authorization boundaries. API backup and restore require an
authenticated administrator. The CLI is an operator tool and requires the API
writers to be stopped before a restore. The documented restore path verifies
the encrypted envelope, SQLite integrity, foreign keys, schema, and
administrator eligibility before publishing restored data.

The live database is not encrypted at rest by this envelope. Existing plaintext
backups are not rewritten automatically. Legacy plaintext restore is refused
unless the explicit compatibility setting is enabled.

See [backup and restore](../runbooks/backup-restore.md) for operational
procedure, [secret rotation](../runbooks/secret-rotation.md) for key changes,
and [database operations](../runbooks/database-operations.md) for migration
and recovery safeguards.
