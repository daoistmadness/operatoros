---
status: current
last_reviewed: 2026-10-26
---

# Ingestion dependency strategy

## Current implementation

Attendance preview parsing runs in the single Bun API process. ExcelJS reads
`.xlsx`; the existing `@e965/xlsx` adapter reads legacy `.xls`. Parsing and
row normalization finish before `createPreview` opens its SQLite transaction.
That transaction writes only immutable staging rows, in bounded inserts of up
to 80 rows per statement. Commit remains a separate atomic transaction that
revalidates selected rows and records audit events. Source SHA-256, duplicate
classification, idempotent commit behavior, retry provenance,
approval, and TypeBox contracts are unchanged.

## Parser measurements

Reproduce the synthetic benchmark with:

```sh
TMPDIR=/dev/shm IMPORT_PREVIEW_BENCH_REPEATS=5 mise exec -- bun apps/api/benchmarks/attendance-import-preview.ts
```

The runner creates fresh synthetic SQLite databases in `/dev/shm`, uses 100
and 5,000 valid attendance rows in both formats, and cleans up its own files.
It separates direct parsing, the production parse dispatch, SQLite staging,
direct full preview, and the authenticated preview route. A separate client
sends authenticated `/api/auth/me` pings during the workload. The server
samples event-loop delay and process RSS every 10 ms. The parser results below
are medians of five trials on native Bun 1.4.4 on a four-core Linux host; each
cell gives the median and trial range. Baseline authenticated ping p95 was
about 1 ms.

| 5,000 rows, parse only | Direct response | Worker response | Direct ping p95 | Worker ping p95 | Event-loop p99, direct to Worker |
|---|---:|---:|---:|---:|---:|
| XLSX | 351 ms (309 to 364) | 538 ms (524 to 548) | 129 ms (119 to 136) | 2 ms (2 to 4) | 131 ms (127 to 143) to 4 ms (3 to 8) |
| XLS | 230 ms (196 to 243) | 414 ms (406 to 415) | 215 ms (180 to 227) | 2 ms (1 to 4) | 211 ms (179 to 228) to 3 ms (2 to 3) |

The Worker removes most parser blocking from unrelated requests, while its cold
startup adds 187 ms to XLSX parsing and 184 ms to XLS parsing. Peak RSS growth
in parse-only trials was 70 MiB (69 to 72) for direct XLSX and 47 MiB (47 to
47) for direct XLS, versus 87 MiB (85 to 91) and 65 MiB (64 to 65) with a
Worker. Sampling is process-wide and can miss brief peaks.

The measured 100-row files were 9.7 KiB (`.xlsx`) and 20 KiB (`.xls`); the
5,000-row files were 153 KiB and 791 KiB. A 64 KiB input threshold keeps the
small path direct and sends the measured large path to a Worker. Files below
the threshold do not pay Worker startup cost.

## SQLite staging measurements

The stage case parses the synthetic workbook before measurement, then calls
`createPreview` while authenticated `/api/auth/me` probes run every 10 ms. The
baseline is fresh `origin/main` at `411802ae`. Five trial pairs alternated which
revision ran first. Both revisions used the same harness and fresh SQLite
databases under `/dev/shm`.

| Format | Stage time, baseline to batched | Authenticated ping p95 during stage | Event-loop p99 during stage | Stage RSS growth, baseline to batched | Worker preview complete, baseline to batched |
|---|---:|---:|---:|---:|---:|
| XLSX | 230.6 ms (227.2 to 233.4) to 133.9 ms (130.2 to 134.7) | 226.9 ms (222.3 to 229.2) to 129.1 ms (127.1 to 130.6) | 221.9 ms (218.5 to 231.8) to 125.1 ms (121.3 to 133.8) | 11.3 MiB (10.8 to 11.5) to 13.5 MiB (13.4 to 13.9) | 761.8 ms (756.5 to 796.2) to 660.4 ms (650.8 to 667.0) |
| XLS | 235.9 ms (232.4 to 237.5) to 135.4 ms (134.6 to 140.8) | 230.8 ms (228.3 to 232.6) to 131.4 ms (130.1 to 136.2) | 232.2 ms (226.8 to 235.5) to 132.0 ms (126.0 to 134.5) | 11.1 MiB (10.9 to 11.6) to 13.8 MiB (13.6 to 14.0) | 641.9 ms (629.1 to 648.9) to 539.4 ms (523.7 to 551.0) |

Each isolated stage trial recorded eight authenticated pings and 25 to 26
event-loop samples. The client caps in-flight pings at eight, so each p95 is
the slowest of those eight requests, not a population p95 estimate. Full-route
trials recorded 48 to 64 authenticated pings. Every preview and ping returned
HTTP 200.

The full preview measurements use the authenticated `/api/uploads/preview`
route and include Worker parsing, staging, response serialization, body read,
and client JSON parse. The response was 1,890,639 bytes for XLSX and 1,890,638
bytes for XLS. Body read and JSON parse time did not materially change. Peak
RSS growth for the isolated stage case increased by 2.2 MiB for XLSX and
2.7 MiB for XLS.

To attribute the stage stall, profile the 5,000-row stage cases over five trials with:

```sh
TMPDIR=/dev/shm IMPORT_PREVIEW_STAGE_PROFILE=1 IMPORT_PREVIEW_BENCH_REPEATS=5 mise exec -- bun apps/api/benchmarks/attendance-import-preview.ts
```

This profiles `Database.query()` preparation and execution, `Database.run()`
call time, transaction callback time, and transaction begin and commit time.
`Database.run()` combines Bun's preparation and execution inside one call. The
profile also records `JSON.stringify` and `JSON.parse` calls. The instrumentation
adds overhead. Use its call counts and component timings for attribution, not
its total preview latency.

The profile attributes the stall to per-row SQLite writes inside the
transaction. Median transaction time fell from 265.1 ms to 145.7 ms for XLSX
and from 275.5 ms to 148.8 ms for XLS. The 5,000 row inserts plus two batch
metadata writes went from 5,002 `Database.run` calls to 65 calls (63 row
batches plus two metadata writes). Their combined wall time fell from 146.6 to
44.5 ms for XLSX and from 152.7 to 45.1 ms for XLS. The 10,000 per-row lookup
gets remained, taking 35.1 to 33.3 ms for XLSX and 36.9 to 33.8 ms for XLS.
`query()` preparation took 9.2 to 9.0 ms for XLSX and 9.7 to 8.8 ms for XLS.
JSON serialization and parsing took 10.0 to 8.6 ms and 10.3 to 9.2 ms.
Transaction begin plus commit remained about 1.2 ms. The transaction callback
accounted for nearly all transaction time. The remaining `createPreview` work,
including row classification and profiler overhead, fell from 70.3 to 57.6 ms
for XLSX and 72.2 to 58.7 ms for XLS.

The production change groups at most 80 valid or invalid rows into one
multi-value insert. A current valid row uses 11 bindings, so 80 rows use 880.
The helper lowers the row count when a wider row needs it, with a conservative
999-binding cap. Identity and attendance lookups, classification, source-row
order, and all inserts remain inside the same immediate transaction. Failure
in a later batch rolls back the batch and every staged row. The change does not
move parsing, approval, audit, retry, or commit work and adds no schema or
service. The 10 ms sampler can miss brief memory or event-loop peaks; these are
local synthetic measurements, not a latency guarantee.

## Worker boundary and limits

Large attendance workbook parsing runs in a Bun Worker. Overlapping large
requests share a Worker for that active burst; it is terminated when the
burst finishes. The input `ArrayBuffer` is transferred after the route hashes
it, and the returned row data is structured-cloned. A 30-second timeout
terminates an unresponsive Worker and rejects its pending parses. No staging,
SQLite, authorization, audit, retry, or commit work moved into the Worker.

Bun documents its Worker API as experimental, so runtime upgrades must rerun
the benchmark and `.xls` and `.xlsx` parity tests. Revisit the 64 KiB boundary when
representative import sizes change. The benchmark results are local
measurements, not a latency guarantee.
