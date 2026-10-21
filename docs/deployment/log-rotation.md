# Audit log rotation and retention

Status: **Phase 3 candidate for P3-08** (Loop 14). Scope: this document only.
It defines rotation, retention, and journald caps for the append-only JSONL
audit logs and the supervised service output. It changes no code and no runtime
behavior.

## Why copytruncate

The API writes audit events one JSON object per event with `appendFileSync`
plus `chmodSync(..., 0o600)` on every call, holds no long-lived file handle,
and has no reopen signal:

- `apps/api/src/auth/service.ts` (`audit()`): `<data root>/logs/authentication_audit.jsonl`.
- `apps/api/src/domains/safety.ts` (`audit()`): `<data root>/backups/backup_operations_audit.jsonl`.

`copytruncate` copies the file and truncates the original in place, so the
path and inode stay valid and the service keeps appending without a restart or
reload. The logrotate manual documents the trade-off: "there is a very small
time slice between copying the file and truncating it, so some logging data
might be lost". Each append is one short open/append/close cycle, so the
exposure is limited to that one interval; plan the drill for a quiet moment
and never delete or replace a file the service holds open.

The backup directory can also contain `backup_restore_audit.jsonl`, which
`GET /api/admin/backups/recovery-history` reads. Include it with `missingok`
so rotation stays harmless when the file is absent.

## Rotation policy

Paths below assume the Ubuntu layout from
[Ubuntu server deployment and supervision](ubuntu-server.md): data root
`/var/lib/operatoros/data`, service user `operatoros`. Adjust user, group, and
paths if the deployment differs.

Create `/etc/logrotate.d/operatoros`:

```text
/var/lib/operatoros/data/logs/*.jsonl {
    weekly
    maxsize 32M
    rotate 12
    missingok
    notifempty
    copytruncate
    compress
    su operatoros operatoros
}

/var/lib/operatoros/data/backups/backup_operations_audit.jsonl
/var/lib/operatoros/data/backups/backup_restore_audit.jsonl {
    weekly
    maxsize 32M
    rotate 12
    missingok
    notifempty
    copytruncate
    compress
    su operatoros operatoros
}
```

Directive notes (logrotate manual semantics):

- `weekly` plus `maxsize 32M` rotates at most weekly and additionally as soon
  as the file exceeds 32M inside the week. `size` alone is mutually exclusive
  with the time interval options; `maxsize` is the option that combines size
  and time.
- `rotate 12` keeps 12 rotations (roughly 12 weeks; at most about 12 x 32M per
  stream before compression). Raise it only with a disk-headroom check.
- `su operatoros operatoros` rotates as the service identity. The data
  directories are owned by that user and mode 0700, and the manual recommends
  `su` when rotating files in directories controlled by a non-privileged user.
  If the group differs, use the actual service group.
- `copytruncate` makes a `create` directive meaningless; do not add one.
- `compress` applies to the rotated copy. `delaycompress` is unnecessary
  because nothing writes to the rotated copy.

Suggested caps for a small school server: 32M per JSONL stream with 12
rotations. Audit logs are operational records; keep at least 12 rotations so
the history survives a quarter of operation, and revisit only with a disk
budget.

Ubuntu ships a daily `logrotate.timer` (check with
`systemctl list-timers | grep logrotate`) and includes `/etc/logrotate.d` from
`/etc/logrotate.conf`. Install the `logrotate` package when the server image
does not provide it.

## Service stdout (systemd and journald)

The API unit candidate writes stdout/stderr to the journal
(`StandardOutput=journal`, `StandardError=journal`,
`SyslogIdentifier=operatoros-api`). Read service output with:

```bash
journalctl -u operatoros-api -f
journalctl -u operatoros-api --since today
```

Bound the journal in `/etc/systemd/journald.conf` (`SystemMaxUse=`,
`SystemKeepFree=`, `MaxRetentionSec=`), then apply with
`sudo systemctl restart systemd-journald`. Ad-hoc maintenance:

```bash
journalctl --disk-usage
journalctl --vacuum-size=500M
journalctl --vacuum-time=30d
journalctl --vacuum-files=20
```

Journald manages its own rotation; the logrotate policy above does not cover
the journal.

## Drill checklist

Run on a disposable host or a disposable data root first.

1. Syntax check without changes: `sudo logrotate -d /etc/logrotate.d/operatoros`.
   Expect `reading config file`, one `rotating pattern` block per stanza, and
   rotation decisions; no error, no file changed.
2. Force one rotation: `sudo logrotate -f /etc/logrotate.d/operatoros`.
   Expect each rotated file to become `<name>.1` (or a numbered copy) and the
   live file to be truncated to zero bytes while keeping its path and mode.
3. Verify the service keeps writing: perform an audited action (sign in, or
   create a manual backup), then confirm the live file has a new JSON line.
   No restart or reload is needed.
4. Verify the rotated copy is complete: the rotated file ends with a full JSON
   object on its own line; with `compress` it is `<name>.1.gz` and readable
   with `zcat`.
5. Verify the loss window is bounded: only entries written between copy and
   truncate can be missing; nothing else is lost. Repeat step 2 in a quiet
   moment and compare the last rotated entry with the first new entry.
6. Confirm state tracking: Ubuntu keeps rotation state in
   `/var/lib/logrotate/status`; the next daily timer run applies the schedules.

## Interplay with the backup low-space preflight (P3-02)

- Audit logs, rotated copies, the SQLite database, and backups share the data
  root filesystem.
- The backup path computes a minimum required free-space headroom from the
  database size and refuses rather than producing partial artifacts (P3-02
  candidate: controlled low-space refusal; the admin status payload then
  reports real `free_space_bytes` and `low_space` values).
- Unbounded audit logs consume that headroom. Keep the rotation caps in force,
  check `df -h` on the data root and the admin backup status periodically, and
  never raise retention without rechecking free space.
- Rotated and compressed copies still consume disk. Removing old audit copies
  is an operator retention decision, not an automatic API action.

## Related

- [Ubuntu server deployment and supervision](ubuntu-server.md) (Phase 3 candidate, P3-01).
- [Production origin and cookie profile](production-profile.md) (Phase 3 candidate, P3-10).
- [Backup and restore security](../security/backup-restore.md).
