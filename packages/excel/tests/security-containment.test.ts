import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  addWorksheet,
  appendRow,
  createWorkbook,
  EXCEL_RESOURCE_LIMITS,
  ExcelWorkbookParseError,
  loadXlsxWorkbook,
  readLegacyXlsRows,
  readXlsxWorkbook,
  validateXlsxActualUncompressedBytes,
  validateLegacyXlsContainer,
  validateXlsxContainer,
  writeLegacyXlsRows,
  writeXlsxWorkbook,
} from "@operatoros/excel";

function buildSyntheticZip(entries: Array<{
  name: string;
  data?: Uint8Array;
  flags?: number;
  compressionMethod?: 0 | 8;
  uncompressedSizeOverride?: number;
}>): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data ?? new Uint8Array(0);
    const flags = entry.flags ?? 0;
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressedData = compressionMethod === 8 ? deflateRawSync(data) : data;
    const uncompressedSize = entry.uncompressedSizeOverride ?? data.length;

    const local = new Uint8Array(30 + nameBytes.length + compressedData.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, compressionMethod, true);
    lv.setUint32(18, compressedData.length, true);
    lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressedData, 30 + nameBytes.length);
    localChunks.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, compressionMethod, true);
    cv.setUint32(20, compressedData.length, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdChunks.push(cd);

    offset += local.length;
  }

  const cdSize = cdChunks.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of localChunks) { out.set(c, pos); pos += c.length; }
  for (const c of cdChunks) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

describe("@operatoros/excel security & resource containment", () => {
  it("preserves sparse column positions and row numbers within bounds without rectangular blowup", async () => {
    const wb = createWorkbook();
    const ws = addWorksheet(wb, "Sparse");
    appendRow(ws, ["col_a", null, "col_c"]);
    ws.getCell(50, 1).value = "row50_a";
    ws.getCell(50, 3).value = "row50_c";
    const bytes = await writeXlsxWorkbook(wb);

    const parsed = await readXlsxWorkbook(bytes);
    expect(parsed.sheets[0]?.headers).toEqual(["col_a", "", "col_c"]);
    expect(parsed.sheets[0]?.rows).toEqual([
      { rowNumber: 50, values: ["row50_a", null, "row50_c"] },
    ]);
  });

  it("rejects sparse worksheets exceeding column or cell budgets without silent truncation", async () => {
    const wb = createWorkbook();
    const ws = addWorksheet(wb, "OversizedCols");
    appendRow(ws, ["A", "B"]);
    ws.getCell(500, EXCEL_RESOURCE_LIMITS.maxColumnsPerSheet + 1).value = "outlier";
    const bytes = await writeXlsxWorkbook(wb);

    await expect(readXlsxWorkbook(bytes)).rejects.toBeInstanceOf(ExcelWorkbookParseError);
    await expect(loadXlsxWorkbook(bytes)).rejects.toBeInstanceOf(ExcelWorkbookParseError);

    const cellWb = createWorkbook();
    const cellWs = addWorksheet(cellWb, "CellBudget");
    appendRow(cellWs, ["A", "B", "C"]);
    appendRow(cellWs, ["1", "2", "3"]);
    appendRow(cellWs, ["4", "5", "6"]);
    const cellBytes = await writeXlsxWorkbook(cellWb);
    await expect(readXlsxWorkbook(cellBytes, { maxPopulatedCells: 2 })).rejects.toBeInstanceOf(ExcelWorkbookParseError);
  });

  it("rejects encrypted, macro-bearing, path-traversal, and oversized-metadata ZIP containers pre-parse", () => {
    expect(() => validateXlsxContainer(new Uint8Array(0))).toThrow("EXCEL_FILE_SIZE_OUT_OF_BOUNDS");
    expect(() => validateXlsxContainer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow("EXCEL_INVALID_XLSX_SIGNATURE");

    const encrypted = buildSyntheticZip([{ name: "xl/workbook.xml", flags: 0x01 }]);
    expect(() => validateXlsxContainer(encrypted)).toThrow("EXCEL_ENCRYPTED_WORKBOOK_UNSUPPORTED");

    const macro = buildSyntheticZip([{ name: "xl/vbaProject.bin" }]);
    expect(() => validateXlsxContainer(macro)).toThrow("EXCEL_UNSUPPORTED_MACRO_OR_EXTERNAL_LINK");

    const externalLink = buildSyntheticZip([{ name: "xl/externalLinks/externalLink1.xml" }]);
    expect(() => validateXlsxContainer(externalLink)).toThrow("EXCEL_UNSUPPORTED_MACRO_OR_EXTERNAL_LINK");

    const traversal = buildSyntheticZip([{ name: "../evil.xml" }]);
    expect(() => validateXlsxContainer(traversal)).toThrow("EXCEL_UNSAFE_ZIP_ENTRY_PATH");

    const bomb = buildSyntheticZip([{ name: "xl/sheet1.xml", uncompressedSizeOverride: 200 * 1024 * 1024 }]);
    expect(() => validateXlsxContainer(bomb)).toThrow("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED");

    const manyEntries = buildSyntheticZip(
      Array.from({ length: 10 }, (_, i) => ({ name: `xl/item${i}.xml` })),
    );
    expect(() => validateXlsxContainer(manyEntries, { maxZipEntries: 5 })).toThrow("EXCEL_ZIP_ENTRY_LIMIT_EXCEEDED");
  });

  it("enforces actual streamed ZIP output when central-directory sizes underreport it", async () => {
    const misleadingSizeBomb = buildSyntheticZip([{
      name: "xl/worksheets/sheet1.xml",
      data: new Uint8Array(1024 * 1024).fill(0x41),
      compressionMethod: 8,
      uncompressedSizeOverride: 1,
    }]);

    expect(() => validateXlsxContainer(misleadingSizeBomb, { maxUncompressedBytes: 64 * 1024 })).not.toThrow();
    await expect(
      validateXlsxActualUncompressedBytes(misleadingSizeBomb, { maxUncompressedBytes: 64 * 1024 }),
    ).rejects.toThrow("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED");
    const parseError = await loadXlsxWorkbook(misleadingSizeBomb, { maxUncompressedBytes: 64 * 1024 })
      .then(() => null, (error: unknown) => error);
    expect(parseError).toBeInstanceOf(ExcelWorkbookParseError);
    expect((parseError as { cause?: { message?: string } } | null)?.cause?.message)
      .toBe("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED");
  });

  it("rejects invalid or oversized legacy XLS containers", () => {
    expect(() => validateLegacyXlsContainer(new Uint8Array(0))).toThrow("EXCEL_FILE_SIZE_OUT_OF_BOUNDS");
    expect(() => validateLegacyXlsContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toThrow(
      "EXCEL_INVALID_OLE2_SIGNATURE",
    );
    const xls = writeLegacyXlsRows([["1", "Andi"]], ["No. ID", "Nama"], "Attendance");
    expect(() => readLegacyXlsRows(xls, { maxRowsPerSheet: 1 })).toThrow("EXCEL_WORKSHEET_DIMENSIONS_EXCEEDED");
  });

  it("verifies vendored sheetjs-fork SHA256 checksums match UPSTREAM.md", () => {
    const forkDir = path.resolve(import.meta.dirname, "../../sheetjs-fork");
    const expected: Record<string, string> = {
      "xlsx.js": "fd159f1e2d694e12cd0709c1ec1b63c6e1f045d2c4ce857a346f9b965798cbfa",
      "dist/cpexcel.js": "5f0cc8cc3c764e924a2877f32dcd93709756d0b6c26d2471bfd911ce6f8e81c2",
      "types/index.d.ts": "191e4e6aceae3602aa3a1e9a6bc0e98821d6d5fb787e2bc16e250439482bddb6",
      "LICENSE": "4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64",
    };
    for (const [rel, sha] of Object.entries(expected)) {
      const actual = createHash("sha256").update(readFileSync(path.join(forkDir, rel))).digest("hex");
      expect(actual).toBe(sha);
    }
  });
});
