# Architecture Decision Record: Vendored SheetJS Fork & Lazy Legacy Loading

- **Date**: 2026-10-31
- **Status**: Accepted & Implemented
- **Package**: `@operatoros/sheetjs-fork` (in `packages/sheetjs-fork`)
- **Consumer**: `@operatoros/excel` (in `packages/excel`)

---

## 1. Context & Problem Statement

Prior to this migration, `@operatoros/excel` depended directly on `@e965/xlsx@0.20.3`:
1. **Blind Security Gate**: OSV and `bun audit` maintain zero advisory coverage for `@e965/xlsx`, leaving dependency scans blind to CVEs in the SheetJS tree.
2. **Package Waste**: `@e965/xlsx` installed 7.8 MB across minified browser bundles (`dist/xlsx.full.min.js`), web worker bundles (`xlsxworker.js`), CLI tools (`bin/`), and sourcemaps.
3. **Cold Boot Latency**: Evaluating `@e965/xlsx` incurred an eager ~210 ms cold boot cost on every process and worker spawn that touched `@operatoros/excel`, even though modern `.xlsx` workbooks use ExcelJS and never require SheetJS.
4. **Isolated Surface Area**: The entire repository contained only one production call site for SheetJS: parsing legacy BIFF8 (`.xls`) attendance uploads in `readLegacyXlsRows`.

---

## 2. Decision

1. **Vendor Trimmed Fork (`@operatoros/sheetjs-fork`)**:
   - Source: SheetJS CE `v0.20.3` (matching official git tag and `@e965/xlsx` sha256 checksums).
   - Package Directory: `packages/sheetjs-fork`.
   - Vendored Artifacts: Retain `xlsx.js` (975 KB), `dist/cpexcel.js` (471 KB), `types/index.d.ts` (27 KB), and `LICENSE`. Discard all browser bundles, ESM wrappers, workers, CLI scripts, and maps.
   - Size reduction: 7.8 MB down to ~1.46 MB (−82% installed size).
   - Upstream Provenance: Fully documented in `packages/sheetjs-fork/UPSTREAM.md`.

2. **Synchronous Lazy Loading (`createRequire`)**:
   - In `packages/excel/src/legacy.ts`, SheetJS is required lazily upon first invocation of `readLegacyXlsRows` / `writeLegacyXlsRows` via `createRequire(import.meta.url)`.
   - Preserves synchronous signatures (`(buffer: ArrayBuffer | Uint8Array) => LegacyWorksheetRows`), preventing breaking changes across existing callers, tests, and workers.
   - Eliminates the ~210 ms boot overhead completely from the standard `.xlsx` application paths.

3. **Strict Monorepo Boundary Enforcement**:
   - `scripts/check-architecture.ts` restricts `@operatoros/sheetjs-fork` exclusively to `allowedInternal["@operatoros/excel"]`. Any import from `apps/api`, `apps/web`, or other workspaces fails AST boundary checks.
   - Monorepo CI checks enforce:
     ```bash
     ! grep -s -rn "@e965/xlsx" package.json packages/*/package.json apps/*/package.json bun.lock
     ! rg -l "@operatoros/sheetjs-fork" --glob '!packages/excel/**' --glob '!packages/sheetjs-fork/**' --glob '!bun.lock' --glob '!docs/**'
     ```

4. **Static Test Decoupling & Regression Parity**:
   - All tests in `packages/excel/tests/` consume static binary fixtures (`packages/excel/tests/fixtures/legacy-attendance.xls`) rather than dynamically generating workbooks through circular SheetJS calls.
   - Verified against `legacy-attendance.golden.json` using a tagged structural serializer that strictly preserves `Date`, `null`, `undefined`, numbers, and Unicode strings.

---

## 3. Deferred Items & Revisitation Criteria

- **Legacy Codepage Verification**:
  SheetJS's BIFF8 serializer outputs UTF-16LE / Codepage 1200 records by default. Therefore, synthetic fixtures exercise UTF-16 decoding but do not exercise legacy single-byte/multi-byte codepage conversion tables (e.g. CP1250, CP1252, CP1254).
- **Eager `cpexcel.js` Retention**:
  Because offline school data files currently in the workspace are modern OOXML `.xlsx`, `dist/cpexcel.js` remains eagerly bundled inside `@operatoros/sheetjs-fork`.
- **Revisitation Trigger**:
  Dynamic codepage lazy hooks (Variant C) will only be revisited once an anonymized, authentic hardware-exported `.xls` binary from production school biometric devices is committed to the fixture suite.
