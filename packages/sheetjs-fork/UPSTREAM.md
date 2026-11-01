# Upstream Provenance: @operatoros/sheetjs-fork

- **Upstream Source**: https://git.sheetjs.com/sheetjs/sheetjs
- **Upstream Tag**: `v0.20.3`
- **License**: Apache-2.0 (see LICENSE)
- **Vendored Date**: 2026-10-31
- **Upstream Package Hash**: matches npm `@e965/xlsx@0.20.3`

## Vendored Files & SHA256 Checksums

| File | Size | SHA256 | Description |
| :--- | :--- | :--- | :--- |
| `xlsx.js` | 975,564 | `fd159f1e2d694e12cd0709c1ec1b63c6e1f045d2c4ce857a346f9b965798cbfa` | Upstream core CommonJS build |
| `dist/cpexcel.js` | 471,759 | `5f0cc8cc3c764e924a2877f32dcd93709756d0b6c26d2471bfd911ce6f8e81c2` | Codepage encoding / decoding tables |
| `types/index.d.ts` | 27,917 | `191e4e6aceae3602aa3a1e9a6bc0e98821d6d5fb787e2bc16e250439482bddb6` | Upstream TypeScript declarations |
| `LICENSE` | 11,355 | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` | Apache-2.0 License text |

## Trimming Rationale (82% size reduction)
OperatorOS only relies on SheetJS for reading legacy BIFF8 (`.xls`) attendance workbooks via `readLegacyXlsRows`.
All browser bundles (`dist/xlsx.full.min.js`, `dist/xlsx.core.min.js`, etc.), ESM wrappers (`xlsx.mjs`), CLI scripts (`bin/`), web workers (`xlsxworker.js`), and sourcemaps were discarded.
This reduces installed size from 7.8 MB to ~1.46 MB with zero code modifications to `xlsx.js` or `cpexcel.js`.
