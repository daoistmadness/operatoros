# Approved report preservation decision package

## Decision status

This is a proposal for owner review, not an approval or implementation authorization. The values in the matrix are recommendations only. The data controller must approve policy values, and the system owner must separately authorize any schema or storage change. Until both sign-offs are recorded, reports remain streamed exports; no artifact store, migration, retention job, or automatic deletion is authorized.

The recommended guarantee is retrieval of the exact approved artifact bytes. Computational replay, source-data snapshots, and automatic deletion are out of scope.

## Current behavior

Report Builder reads current SQLite data and the selected template when it creates a preview, PDF, or workbook. PDF visibility settings control supported sections. Exports include a SHA-256 response header and `no-store` cache headers; a digest identifies bytes while they are available but does not retain them. PDF identification currently includes template identity/update time, generation time, and report period.

There is no durable report-run, artifact, or source-snapshot storage. Later exports can differ after source data, template settings, or academic policy change. The Report Builder is in the admin-only Academic Management page; its API now checks for an admin on metadata, preview, template, branding, and export routes. Its exports do not currently write a report-specific operation event to `operations_audit_events`; authorization denials use the authentication audit path. Existing backups encrypt database snapshots with AES-256-GCM; the live SQLite database remains unencrypted. The backup envelope uses a JSON/Base64 representation, authenticates its key ID, and supports previous keys for reads. The report section response is a TypeBox contract, but there is no approved-artifact contract or persistence API.

## Proposed decision matrix — pending approval

| Area | Proposed value (not approved) | Required approval or value to record |
| --- | --- | --- |
| Official status | Only a report explicitly approved by a designated approver becomes an official record. Previews and ordinary exports remain unretained drafts. | Data controller: eligible report types, approval event, and whether two-person approval is mandatory. |
| Preservation guarantee | Store and retrieve the exact approved PDF/XLSX bytes. A replacement creates a new artifact ID and approval; it never overwrites an approved artifact. Revocation blocks future retrieval but does not rewrite the bytes. No computational replay or source-row snapshot. | Data controller and academic/report owner: confirm original-byte retrieval only and define who can revoke or replace. |
| Authorization and separation of duties | Introduce separate prepare, approve, retrieve, hold/retention, and audit permissions. The creator cannot approve their own artifact. Administrative status alone does not grant report-content access. Keep current nonofficial exports ephemeral. | Data controller: role-to-persona mapping and any two-person actions. System owner: authorization design review. |
| Retention | Do not retain artifacts until a numeric retention period is approved. Proposed clock start: the close of the associated academic year. When due, require an authorized human deletion decision; do not run automatic deletion. | Data controller: duration, clock start, early-deletion authority, and audit requirements. Record the exact schedule before enabling storage. |
| Legal holds | A controller-designated records custodian may place a hold. A separate authorized reviewer must approve release. A hold blocks deletion even after the normal retention date. | Data controller: appoint custodian/reviewer, define hold scope, review cadence, and release authority. |
| Storage and capacity | Prefer SQLite BLOB storage so artifact bytes and approval metadata share one transaction and existing SQLite backup/restore path. Synthetic sizing measured about 20 KiB of SQLite growth and 26.7 KiB of encrypted-backup growth for one PDF/XLSX pair. Do not turn this sample into a quota: set per-artifact and total byte limits after the controller supplies expected volume and the owner reviews backup capacity. At a limit, reject new approval; never evict an existing official artifact. | System owner: approve storage choice and measured byte limits. Data controller: approve expected report volume and quota-exhaustion behavior. |
| At-rest protection | Encrypt artifact bytes in the live database with authenticated encryption and a dedicated key managed outside the database and repository. Keep this key separate from `AUTH_COOKIE_SECRET` and `BACKUP_ENCRYPTION_KEY`. Existing encrypted backups provide an additional outer layer. The benchmark reused the current JSON/Base64 backup envelope with synthetic keys only as an overhead proxy; it is not an approved artifact format. | System owner: approve encryption, key custody, offline recovery, rotation, and separation of duties. |
| Provenance | Keep only metadata needed to identify and validate the retained bytes: artifact ID, report type, academic period/cutoff and selected filters, template revision/digest, rule identity, renderer/application/schema versions, creator and approver IDs/roles, timestamps, media type, byte length, and SHA-256. Do not store raw source rows or student-level snapshots. | Data controller and academic/report owner: approve the metadata fields and confirm no replay guarantee is required. |
| Audit | Record approval, retrieval, revocation, hold/release, and authorized deletion with artifact ID/digest, actor, role/capability, timestamp, action, and outcome. Do not copy artifact contents or student names into audit details. State changes and audit events must commit atomically; retrieval must fail closed if its required audit write fails. | Data controller: approve who can read audit records and their retention. System owner: approve atomicity and failure behavior. |
| Backup and recovery | Keep artifact bytes and metadata in the same SQLite transaction. Include them in the existing consistent encrypted snapshot. On restore, verify database integrity, decryptability, byte length, and SHA-256 before making the restored data available. Retain the existing safety snapshot until validation and rollback checks pass. | System owner: approve backup inclusion, key-recovery procedure, restore evidence, and rollback pair. Data controller: approve restored-artifact access rules. |
| Migration authorization | Rehearse only with disposable synthetic SQLite databases, current-schema tests, and fresh-database parity. Production migration requires a separate written system-owner authorization, wrapper preflight, exclusive lock, verified encrypted backup, and a documented rollback path. | System owner: authorize the exact migration, rollout, backup preflight, and rollback plan. Data controller approval does not substitute for migration authorization. |

## Reproducible synthetic measurements

Run from the repository root with the pinned Bun 1.4.3 runtime:

```sh
bun apps/api/benchmarks/phase2-reporting.ts
```

The script seeds `createAcademicBenchmarkFixture` with 100 synthetic students and 2,000 grade rows, requests Report Builder PDF/XLSX exports, and creates all database and backup files under `/tmp`. It compares the real encrypted backup endpoint before and after inserting two encrypted report payloads into a benchmark-only scratch table. That table is not part of the application schema or migration. The artifact-size proxy uses the existing AES-256-GCM JSON/Base64 helper with an independent synthetic key. The script decrypts a resulting backup into another temporary SQLite file, checks `PRAGMA integrity_check`, verifies both artifact hashes, and tests reads with previous backup and artifact keys.

The first two runs produced these report response ranges; the largest output in run two was used for the original backup-growth comparison. A Loop 66 repeat on 2026-10-15 returned PDF sizes of 1,730–1,733 B and XLSX sizes of 9,622–9,623 B. Its captured pair (1,733 B PDF, 9,623 B XLSX) produced 4,138 B of artifact-envelope overhead, 20,480 B of SQLite growth, and 27,304 B of encrypted-backup growth. SQLite integrity, artifact digests, and reads through previous backup and artifact keys passed again.

| Format | Run 1 response bytes | Run 2 response bytes | Sizing sample used |
| --- | ---: | ---: | ---: |
| PDF | 1,733–1,736 | 1,733–1,735 | 1,735 |
| XLSX | 9,622–9,623 | 9,623–9,624 | 9,624 |

The small variation comes from generated timestamps and workbook encoding. These are representative synthetic exports, not a bound on every report or production data.

| Snapshot measurement | Before artifacts | With one encrypted PDF/XLSX pair | Growth |
| --- | ---: | ---: | ---: |
| Serialized SQLite snapshot | 1,921,024 B | 1,941,504 B | 20,480 B |
| AES-256-GCM encrypted backup file | 2,561,541 B | 2,588,845 B | 27,304 B |
| Backup-envelope growth beyond SQLite growth | — | — | 6,824 B |
| Per-artifact JSON/Base64 envelope overhead | — | — | 4,139 B across both artifacts |

The two-file backup timings were 41.6 ms before artifacts, 36.8 ms with them, and 24.6 ms to decrypt, reopen, integrity-check, and verify the restored artifacts. This single small-fixture timing is too noisy to establish a performance penalty. The reliable evidence here is the byte delta and successful integrity/digest/key checks.

### Illustrative retention growth

The table assumes 1,000 approved PDF/XLSX pairs per year, uses the second-run sample, and scales the measured one-pair delta linearly. The 1-, 5-, and 7-year cases are planning scenarios only; none is a proposed or approved retention duration. The ten-snapshot column assumes ten encrypted full backups each contain the entire retained artifact population; it is a capacity scenario, not a statement of the configured backup schedule.

| Scenario | Raw artifact bytes | Encrypted artifact BLOB bytes | SQLite growth | Encrypted growth per full backup | Ten full backup snapshots |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 pairs/year × 1 year | 10.83 MiB | 14.78 MiB | 19.53 MiB | 26.04 MiB | 260.39 MiB |
| 1,000 pairs/year × 5 years | 54.16 MiB | 73.90 MiB | 97.66 MiB | 130.20 MiB | 1,301.96 MiB |
| 1,000 pairs/year × 7 years | 75.83 MiB | 103.46 MiB | 136.72 MiB | 182.27 MiB | 1,822.74 MiB |

These projections exclude template revisions beyond the one pair per report, free-page/fragmentation effects, unrelated database growth, compression, and backup deduplication. SQLite page allocation and real report populations can change the result. Measure representative school-approved synthetic volumes before signing numeric per-artifact or total quotas.

The benchmark demonstrates capacity consumed; it does not test quota rejection because no artifact store or quota path exists. The proposed behavior remains fail closed: a full quota refuses a new approval and preserves all existing official bytes.

## Operational implications

- **Authorization:** The current export routes are session-authenticated without report-specific capabilities. Persisting official artifacts requires an approved role map and server-side scope checks before bytes can be stored or retrieved.
- **Audit:** Approval and metadata changes need one SQLite transaction with their audit events. A failed audit write must leave no approved artifact or state transition. Retrieval audit failure must deny the read.
- **Capacity:** Synthetic PDF/XLSX size distributions and backup/restore timing must establish the byte limits. Quota exhaustion rejects new approvals; existing approved artifacts remain intact. No automatic cleanup or eviction is proposed.
- **Recovery and key rotation:** A restored database is usable only when its artifact encryption key is available and each retained artifact passes integrity and digest checks. The existing backup rotation pattern keeps previous keys available while old ciphertext remains and does not re-encrypt it automatically. An artifact key would need the same lifecycle: retain the old key until every artifact using it is deleted by an authorized decision or an approved rewrap has been verified. Lost keys must produce a fail-closed recovery outcome, not silently discard records.
- **Rollback:** Artifacts and their metadata move together as one SQLite snapshot. Rehearsal must prove that rollback restores both and that the matching application/schema version can read them. Operational database work remains separately protected and unauthorized here.

## Fail-closed implementation contract — proposed, not authorized

These are acceptance requirements for a later, separately authorized implementation:

- **Eligibility and approval:** reject report types without an approved eligibility rule. An approval transition, artifact bytes, digest, and audit event must be one transaction. On any validation, authorization, encryption, or audit failure, commit none of them and leave existing approved artifacts unchanged.
- **Storage and capacity:** enforce per-artifact and total quotas in the same serialized write path as insertion. At or above a limit, reject the new approval before inserting any artifact data. Never overwrite, evict, or automatically delete an approved artifact to make room. Do not enable storage until numeric limits and no-space behavior are approved.
- **Retrieval:** return bytes only after checking the caller’s approved capability and scope, active approval state, hold/revocation rules, stored length, and SHA-256. A required retrieval-audit failure, unavailable/unknown key, authentication-tag failure, or digest mismatch denies the response. Do not fall back to plaintext or a newly rendered report.
- **Recovery:** restore only from a verified encrypted snapshot using an available key. Before serving restored artifacts, require SQLite integrity and foreign-key checks plus per-artifact decrypt, length, and digest verification. If a retained artifact fails, preserve the database and report the recovery failure; do not silently delete or regenerate the artifact.
- **Key rotation:** write new artifacts with the approved active artifact key. Keep each prior key available while any retained artifact uses its key ID. Retire a key only after a verified, authorized deletion or a separately approved and verified rewrap. A missing key blocks recovery; it does not authorize data loss.
- **Rollback:** rehearse migration and rollback on disposable synthetic databases first. Roll back with the verified pre-migration encrypted snapshot and its matching application/schema pair; never perform an in-place downgrade or remove artifact rows to make an older application start.

## Approval and authorization record

No approval or migration authorization has been recorded. A recommendation in this document is not an authorization. For each row below, the accountable approver must enter the exact decision, their name and authority, the approval date, and a durable evidence reference. Blank fields remain pending and block persistence work.

| Decision | Required authorized approver | Decision to record | Status / evidence |
| --- | --- | --- | --- |
| Official status, eligible report types, approval event, and original-byte guarantee | Data controller; academic/report owner for academic scope | Exact eligible report types; who may declare each official; confirm retrieval-only vs replay | Pending — approver, value, date, evidence reference not supplied |
| Prepare, approve, retrieve, revoke, audit, and separation-of-duty roles | Data controller; system owner reviews server-side capability design | Role/persona mapping; self-approval prohibition; two-person actions; retrieval scope | Pending — approver, value, date, evidence reference not supplied |
| Retention, deletion, and legal holds | Data controller | Numeric duration and start event; authorized deletion roles; hold custodian, reviewer, scope, cadence, release authority | Pending — approver, value, date, evidence reference not supplied |
| Per-artifact and total storage quotas | Data controller for expected volume and exhaustion policy; system owner for enforceable limits | Expected annual volume; byte limits; whether exhaustion rejects new approval; any permitted exception | Pending — approver, value, date, evidence reference not supplied |
| Provenance metadata and audit access/retention | Data controller and academic/report owner | Approved metadata fields; audit readers; audit retention; confirm no student-row snapshot/replay requirement | Pending — approver, value, date, evidence reference not supplied |
| SQLite BLOB storage, artifact encryption, key custody, and rotation | System owner; data controller approves confidentiality policy | Storage choice; independent key custodian; offline recovery access; rotation and retirement conditions | Pending — approver, value, date, evidence reference not supplied |
| Backup, restore, access after recovery, and rollback | System owner; data controller approves restored-record access | Backup inclusion; integrity evidence; recovery key custody; compatible application/schema pair; rollback trigger and owner | Pending — approver, value, date, evidence reference not supplied |
| Exact schema migration and rollout | System owner, separately from all policy approvals | Exact target database/data root, migration revision, execution window, preflight, backup identity, operator, rollback pair, and stop conditions | Not authorized — exact-target written authorization absent |

Approval evidence must identify the approving person and authority, decision text/version, date, and a durable record reference. Do not fill these fields from the reported Loop state or treat this work item as the approval itself. System-owner migration authorization is a separate gate and must name the exact target and operation.

## Migration and rollback gate

The repository identifies `20261002_s48` as the current application schema head. Startup validates and rejects outdated databases; it does not migrate them. `docs/operations/DATABASE_OPERATIONS.md` keeps `backend/attendance.db` at protected S4.3 until a separately authorized operational migration, and records the S4.2 rollback application pair. No approved-report schema change exists, and the development migration wrapper is not an authorization or procedure for this new operational migration.

Before a future operational migration, the owner must authorize the exact target and operation. Follow the repository’s protected-database safeguards: wrapper preflight for that exact target, stopped writers/no open handles or sidecars, exclusive lock, fresh verified encrypted backup outside the repository, process-local migration context, current-schema and fresh-parity tests on disposable data, and a rehearsed restore to the matching application/schema pair. The current `scripts/migrate-dev-db-s47.sh` specifically checks the development service identity and only wraps the existing dev S4.8 migration path; do not reuse or generalize it as a production runner. Until an operations-approved target-specific runbook and rollback pair exist, the migration gate is incomplete and persistence must not be implemented.

After each approval above, keep its evidence reference in this table and validate the selected limits and encrypted backup/recovery path with synthetic artifacts before any operational request. Exact-byte retrieval remains distinct from computational replay; a digest verifies available bytes but cannot recreate missing bytes or historical inputs.
