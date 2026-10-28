---
status: draft
last_reviewed: 2026-10-26
---

# Report artifact preservation

## Current decision

Report Builder previews and exports are generated from current SQLite data and
returned as downloads. The repository has no approved-report artifact store,
report-specific retention job, or automatic deletion workflow. Current exports
are not a preserved official record.

The report preservation proposal remains a draft. No policy approval, retention
period, legal-hold authority, artifact quota, encryption-key lifecycle, or
schema/storage change is authorized by that proposal. Do not treat its
synthetic capacity measurements as approved production limits.

## Change boundary

Any future persistent report artifact feature needs separate data-controller
approval for eligibility, access, retention, deletion, legal holds, and audit
policy, plus system-owner approval for implementation, encryption, backup,
recovery, migration, and rollback. Rehearse only with synthetic data and
disposable databases. Production data changes remain subject to the
[database operations runbook](../runbooks/database-operations.md).

The proposal and technical acceptance notes were consolidated from the
2026-10-16 Phase 2 closure record. Historical test counts, recovered patch
lineage, and worktree state were omitted because they do not define the current
report behavior or authorize a change.
