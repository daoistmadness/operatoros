# Provenance: legacy-attendance.xls & legacy-attendance.golden.json

## Generation Metadata
- **Date**: 2026-10-31
- **Generator Runtime**: Bun v1.4.4 (Linux x64)
- **Generator Package**: `@e965/xlsx@0.20.3` (official SheetJS CE v0.20.3)
- **Upstream xlsx.js SHA256**: `fd159f1e2d694e12cd0709c1ec1b63c6e1f045d2c4ce857a346f9b965798cbfa`
- **Container Format**: Microsoft BIFF8 (Compound Binary Format / OLE2)
- **Container Magic Bytes**: `D0 CF 11 E0 A1 B1 1A E1` (verified)

## Artifact Hashes
- `legacy-attendance.xls`: `b33a9152fe849176da758202aeb613c205b19394977bee1154e21a9d433c03d7`
- `legacy-attendance.golden.json`: `0c9b2e1de146e5edcae9713997c75a6bc4e9306e0881aa0a81e6bc22c8714b52`

## Structure & Types Tested
1. **Header Row**: String headers (`No. ID`, `Nama`, `Tanggal`, `Scan Masuk`, `Scan Pulang`, `Terlambat`, `Lembur`, `Pengecualian`, `week`)
2. **Accented Latin**: Diacritics (`Renée Müller`, `Łukasz Šimon`, `Müller-García`)
3. **CJK Strings**: Multibyte glyphs (`田中太郎`, `李伟`)
4. **Dates**:
   - Native JavaScript `Date` object (`2026-06-17T00:00:00.000Z`) written with `cellDates: true` and parsed back as `instanceof Date`
   - Raw Excel serial date number (`46188`)
   - Pre-formatted date string (`"17/06/2026"`)
5. **Times & Durations**: Clock strings (`"07:30"`, `"16:00"`, `"00:25"`)
6. **Null / Sparse Cells**: Sparse values serialized explicitly as `{ "$t": "null" }`

## Scope & Limitations (Important)
- **Regression Guard Only**: This fixture serves as a strict regression guard ensuring zero drift between `@e965/xlsx@0.20.3` and `@operatoros/sheetjs-fork` on the exact same BIFF8 workbook.
- **Codepage 1200 (UTF-16LE) Scope**: SheetJS's BIFF8 writer emits UTF-16LE strings (Codepage 1200). Therefore, this fixture verifies Unicode / UTF-16LE record decoding, but does **not** exercise legacy single-byte/multi-byte codepage conversion tables (e.g. CP1250, CP1252, CP1254). Real hardware-exported files are required for verifying legacy codepage tables.
