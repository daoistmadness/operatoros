# Dual-Backend Replay Harness — Design

Status: design frozen for Phase 0 · Implementation starts Phase 1 (TS side)
and Phase 3 (first replayed domain)

## Goal

Prove behavioral parity between two live backends:

- REFERENCE: FastAPI on Uvicorn (current)
- CANDIDATE: Elysia on Node 24 (target)

Both run against equivalent disposable database state. Neither touches the
protected operational database.

## Architecture

```
                replay-driver (Python during migration)
                          |
        +-----------------+------------------+
        v                                     v
   FastAPI reference                     Elysia candidate
   127.0.0.1:<port_a>                    127.0.0.1:<port_b>
        |                                     |
   disposable DB A                      disposable DB B
   (same seed script)                   (same seed script)
        |                                     |
        +--------> mutation dump <-----------+
                  (sqlite .dump minus sqlite_sequence)
```

## Flow

1. Seed both databases with the same deterministic seed script.
2. Start both backends on ephemeral loopback ports with isolated env vars.
3. Replay a recorded request sequence to both, sequentially.
4. Capture: HTTP status, response JSON, selected headers, cookies issued.
5. After the sequence: dump both databases and diff table contents.
6. Compare audit-event tables row by row after normalization.
7. Emit a verdict per request and per sequence.

## Comparison layers

| Layer | Compared | Normalized |
|---|---|---|
| transport | status code, content-type | none |
| body | full JSON deep-diff | timestamps, UUIDs per GOLDEN_PLAN |
| headers | set-cookie flags (HttpOnly/SameSite/Secure), location | cookie value digests |
| database | per-table row diff | surrogate ordering |
| audit events | operations_audit_events rows | timestamps, actor-id form |

## Request recording format

One JSON file per scenario:

```json
{
  "scenario": "login-success-admin",
  "seed": "seeds/auth_admin.json",
  "requests": [
    {"method": "POST", "path": "/api/setup/status"},
    {"method": "POST", "path": "/api/auth/login",
     "json": {"username": "admin", "password": "golden-pass-1"}}
  ],
  "expectations": {"final_status_chain": [200, 200]}
}
```

Cookie jars are tracked per client and replayed identically.

## Verdict output

Per scenario:

```json
{
  "scenario": "import-preview-golden-workbook",
  "transport": "EXACT_MATCH",
  "body": "NONDETERMINISTIC_EQUIVALENT",
  "database": "EXACT_MATCH",
  "verdict": "PASS"
}
```

Any MIGRATION_DEFECT verdict fails the owning phase gate. Intentional
contract changes require an approval note referenced by id in the scenario
file.

## Runtime notes

- Ports are runtime-selected. No fixed ports.
- Both backends must bind 127.0.0.1 only.
- The driver is Python while FastAPI remains authoritative. A thin TS runner
  replaces it after cutover for regression use.
