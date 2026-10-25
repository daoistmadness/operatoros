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
IMPORT_PREVIEW_BENCH_REPEATS=5 mise exec -- bun apps/api/benchmarks/attendance-import-preview.ts
```

The runner creates fresh synthetic SQLite databases in `/dev/shm`, uses 100
and 5,000 valid attendance rows in both formats, and cleans up its own files.
It separates direct parsing, the production parse dispatch, SQLite staging,
direct full preview, and the authenticated preview route. A separate client
sends authenticated `/api/auth/me` pings during the workload. The server
samples event-loop delay and process RSS every 10 ms. The values below are
medians of five interleaved trials on native Bun 1.4.4 on a four-core Linux
host. Each cell gives the median and trial range. Baseline authenticated ping
p95 was about 1 ms.

| 5,000 rows | Direct request | Worker-dispatched request | Direct ping p95 | Worker ping p95 | Event-loop p99, direct to Worker |
|---|---:|---:|---:|---:|---:|
| XLSX parse only | 351 ms (309 to 364) | 538 ms (524 to 548) | 129 ms (119 to 136) | 2 ms (2 to 4) | 131 ms (127 to 143) to 4 ms (3 to 8) |
| XLS parse only | 230 ms (196 to 243) | 414 ms (406 to 415) | 215 ms (180 to 227) | 2 ms (1 to 4) | 211 ms (179 to 228) to 3 ms (2 to 3) |
| XLSX full preview | 552 ms (522 to 554) | 745 ms (736 to 756) | 312 ms (309 to 318) | 187 ms (180 to 192) | 320 ms (318 to 320) to 208 ms (202 to 214) |
| XLS full preview | 437 ms (398 to 439) | 631 ms (625 to 635) | 420 ms (381 to 431) | 191 ms (188 to 196) | 411 ms (384 to 416) to 213 ms (208 to 218) |

The Worker removes most parser blocking from unrelated requests, while its cold
startup adds 187 ms to XLSX parsing and 184 ms to XLS parsing. Peak RSS growth
in parse-only trials was 70 MiB (69 to 72) for direct XLSX and 47 MiB (47 to
47) for direct XLS, versus 87 MiB (85 to 91) and 65 MiB (64 to 65) with a
Worker. Sampling is process-wide and can miss brief peaks.

SQLite staging remains a separate event-loop stall: its median was 235 ms
(205 to 241) for XLSX and 234 ms (232 to 236) for XLS. Event-loop p99 was
232 ms (202 to 234) and 232 ms (228 to 233). Staging accounts for the residual
187 ms (180 to 192) XLSX ping p95 and 191 ms (188 to 196) XLS ping p95 on full
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
