# Ingestion dependency strategy

## Current implementation

Attendance preview parsing runs in the single Bun API process. ExcelJS reads
`.xlsx`; the existing `@e965/xlsx` adapter reads legacy `.xls`. Parsing and
row normalization finish before `createPreview` opens its SQLite transaction.
That transaction writes only immutable staging rows. Commit remains a separate
atomic transaction that revalidates selected rows and records audit events.
Source SHA-256, batch idempotency, retry provenance, approval, and TypeBox
contracts are unchanged by the parser execution path.

## Measured behavior

Reproduce the synthetic A/B run with:

```sh
IMPORT_PREVIEW_BENCH_REPEATS=3 mise exec -- bun apps/api/benchmarks/attendance-import-preview.ts
```

The runner creates fresh synthetic SQLite databases in `/dev/shm`, uses 100
and 5,000 valid attendance rows in both formats, and cleans up its own files.
It separates direct parsing, the production parse dispatch, SQLite staging,
direct full preview, and the authenticated preview route. A separate client
sends authenticated `/api/auth/me` pings during the workload. The server
samples event-loop delay and process RSS every 10 ms. The values below are
medians of three interleaved trials on native Bun 1.4.4 on a four-core Linux
host; baseline authenticated ping p95 was about 1 ms.

| 5,000 rows | Direct request | Worker-dispatched request | Direct ping p95 | Worker ping p95 | Event-loop p99, direct → worker |
|---|---:|---:|---:|---:|---:|
| XLSX parse only | 352 ms | 539 ms | 129 ms | 3 ms | 133 ms → 6 ms |
| XLS parse only | 227 ms | 412 ms | 212 ms | 2 ms | 213 ms → 2 ms |
| XLSX full preview | 550 ms | 744 ms | 315 ms | 179 ms | 316 ms → 208 ms |
| XLS full preview | 431 ms | 628 ms | 421 ms | 184 ms | 407 ms → 205 ms |

The Worker removes most parser blocking from unrelated requests, while its cold
startup adds about 185–188 ms to a 5,000-row parse request. Peak RSS growth in
parse-only trials was about 71 MiB for direct XLSX and 47 MiB for direct XLS,
versus 88 MiB and 65 MiB with a Worker. Sampling is process-wide and can miss
brief peaks.

SQLite staging remains a separate event-loop stall: its median was 232 ms for
XLSX and 235 ms for XLS, with event-loop p99 at 229 ms and 231 ms. That work
still accounts for the residual 179–184 ms authenticated ping p95 on full
Worker previews. No database, approval, or commit optimization is justified
by these parsing measurements.

The measured 100-row files were 9.7 KiB (`.xlsx`) and 20 KiB (`.xls`); the
5,000-row files were 153 KiB and 791 KiB. A 64 KiB input threshold keeps the
small path direct and sends the measured large path to a Worker. Files below
the threshold do not pay Worker startup cost.

## Worker boundary and limits

Large attendance workbook parsing runs in a Bun Worker. Overlapping large
requests share a Worker for that active burst; it is terminated when the
burst finishes. The input `ArrayBuffer` is transferred after the route hashes
it, and the returned row data is structured-cloned. A 30-second timeout
terminates an unresponsive Worker and rejects its pending parses. No staging,
SQLite, authorization, audit, retry, or commit work moved into the Worker.

Bun documents its Worker API as experimental, so runtime upgrades must rerun
the benchmark and XLS/XLSX parity test. Revisit the 64 KiB boundary when
representative import sizes change. The benchmark results are local
measurements, not a latency guarantee.
