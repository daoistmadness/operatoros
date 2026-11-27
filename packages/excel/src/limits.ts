import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";

export const EXCEL_RESOURCE_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxSheets: 50,
  maxRowsPerSheet: 50_000,
  maxColumnsPerSheet: 200,
  maxPopulatedCells: 500_000,
  maxZipEntries: 256,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
  compressionRatioMinUncompressedBytes: 10 * 1024 * 1024,
} as const;

export type ExcelResourceLimits = {
  maxFileBytes?: number;
  maxSheets?: number;
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxPopulatedCells?: number;
  maxZipEntries?: number;
  maxUncompressedBytes?: number;
  maxCompressionRatio?: number;
  compressionRatioMinUncompressedBytes?: number;
};

export function resolveExcelLimits(overrides?: ExcelResourceLimits): Required<ExcelResourceLimits> {
  return {
    maxFileBytes: overrides?.maxFileBytes ?? EXCEL_RESOURCE_LIMITS.maxFileBytes,
    maxSheets: overrides?.maxSheets ?? EXCEL_RESOURCE_LIMITS.maxSheets,
    maxRowsPerSheet: overrides?.maxRowsPerSheet ?? EXCEL_RESOURCE_LIMITS.maxRowsPerSheet,
    maxColumnsPerSheet: overrides?.maxColumnsPerSheet ?? EXCEL_RESOURCE_LIMITS.maxColumnsPerSheet,
    maxPopulatedCells: overrides?.maxPopulatedCells ?? EXCEL_RESOURCE_LIMITS.maxPopulatedCells,
    maxZipEntries: overrides?.maxZipEntries ?? EXCEL_RESOURCE_LIMITS.maxZipEntries,
    maxUncompressedBytes: overrides?.maxUncompressedBytes ?? EXCEL_RESOURCE_LIMITS.maxUncompressedBytes,
    maxCompressionRatio: overrides?.maxCompressionRatio ?? EXCEL_RESOURCE_LIMITS.maxCompressionRatio,
    compressionRatioMinUncompressedBytes:
      overrides?.compressionRatioMinUncompressedBytes ?? EXCEL_RESOURCE_LIMITS.compressionRatioMinUncompressedBytes,
  };
}

export function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function hasXlsxZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function hasOle2Signature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8
    && bytes[0] === 0xd0
    && bytes[1] === 0xcf
    && bytes[2] === 0x11
    && bytes[3] === 0xe0
    && bytes[4] === 0xa1
    && bytes[5] === 0xb1
    && bytes[6] === 0x1a
    && bytes[7] === 0xe1
  );
}

function findEocdOffset(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

const DISALLOWED_OOXML_ENTRY_PATTERNS = [
  /(?:^|\/)vbaproject\.bin$/i,
  /(?:^|\/)xl\/externalLinks\//i,
];

type XlsxZipEntry = {
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type XlsxContainerInspection = {
  entryCount: number;
  totalUncompressedBytes: number;
  centralDirectoryOffset: number;
  entries: XlsxZipEntry[];
};

/**
 * Pre-parse ZIP central-directory inspection for OOXML (.xlsx) containers.
 * Note: Central-directory headers are untrusted metadata; this acts as a fast
 * preflight layer in addition to post-load workbook dimension and cell budgets.
 */
function inspectXlsxContainer(
  value: ArrayBuffer | Uint8Array,
  overrides?: ExcelResourceLimits,
): XlsxContainerInspection & { bytes: Uint8Array } {
  const limits = resolveExcelLimits(overrides);
  const bytes = toUint8Array(value);
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxFileBytes) {
    throw new Error("EXCEL_FILE_SIZE_OUT_OF_BOUNDS");
  }
  if (!hasXlsxZipSignature(bytes)) {
    throw new Error("EXCEL_INVALID_XLSX_SIGNATURE");
  }

  const eocdOffset = findEocdOffset(bytes);
  if (eocdOffset < 0) {
    throw new Error("EXCEL_INVALID_ZIP_EOCD");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("EXCEL_ZIP64_NOT_SUPPORTED");
  }
  if (totalEntries === 0 || totalEntries > limits.maxZipEntries) {
    throw new Error("EXCEL_ZIP_ENTRY_LIMIT_EXCEEDED");
  }
  if (cdOffset + cdSize > eocdOffset) {
    throw new Error("EXCEL_INVALID_ZIP_CENTRAL_DIRECTORY");
  }

  let cursor = cdOffset;
  let totalUncompressedBytes = 0;
  const entries: XlsxZipEntry[] = [];
  const decoder = new TextDecoder();

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (cursor + 46 > eocdOffset) {
      throw new Error("EXCEL_TRUNCATED_ZIP_CENTRAL_DIRECTORY");
    }
    if (
      bytes[cursor] !== 0x50
      || bytes[cursor + 1] !== 0x4b
      || bytes[cursor + 2] !== 0x01
      || bytes[cursor + 3] !== 0x02
    ) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_HEADER");
    }

    const flags = view.getUint16(cursor + 8, true);
    if ((flags & 0x01) !== 0) {
      throw new Error("EXCEL_ENCRYPTED_WORKBOOK_UNSUPPORTED");
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("EXCEL_ZIP64_ENTRY_NOT_SUPPORTED");
    }
    const headerEnd = cursor + 46 + nameLen + extraLen + commentLen;
    if (headerEnd > eocdOffset) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_BOUNDS");
    }

    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    if (entryName.includes("..") || entryName.startsWith("/")) {
      throw new Error("EXCEL_UNSAFE_ZIP_ENTRY_PATH");
    }
    if (DISALLOWED_OOXML_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))) {
      throw new Error("EXCEL_UNSUPPORTED_MACRO_OR_EXTERNAL_LINK");
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxUncompressedBytes) {
      throw new Error("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED");
    }
    entries.push({ compressionMethod, compressedSize, localHeaderOffset });

    cursor = headerEnd;
  }

  if (
    totalUncompressedBytes >= limits.compressionRatioMinUncompressedBytes
    && totalUncompressedBytes / bytes.byteLength > limits.maxCompressionRatio
  ) {
    throw new Error("EXCEL_COMPRESSION_RATIO_EXCEEDED");
  }

  return {
    bytes,
    entryCount: totalEntries,
    totalUncompressedBytes,
    centralDirectoryOffset: cdOffset,
    entries,
  };
}

export function validateXlsxContainer(
  value: ArrayBuffer | Uint8Array,
  overrides?: ExcelResourceLimits,
): { entryCount: number; totalUncompressedBytes: number } {
  const { entryCount, totalUncompressedBytes } = inspectXlsxContainer(value, overrides);
  return { entryCount, totalUncompressedBytes };
}

/**
 * Streams each OOXML ZIP entry through a raw DEFLATE decoder before a workbook
 * parser can expand it, so limits do not rely only on untrusted size metadata.
 */
export async function validateXlsxActualUncompressedBytes(
  value: ArrayBuffer | Uint8Array,
  overrides?: ExcelResourceLimits,
): Promise<number> {
  const limits = resolveExcelLimits(overrides);
  const { bytes, centralDirectoryOffset, entries } = inspectXlsxContainer(value, limits);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let actualUncompressedBytes = 0;

  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (localOffset + 30 > centralDirectoryOffset) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_BOUNDS");
    }
    if (
      bytes[localOffset] !== 0x50
      || bytes[localOffset + 1] !== 0x4b
      || bytes[localOffset + 2] !== 0x03
      || bytes[localOffset + 3] !== 0x04
    ) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_HEADER");
    }

    const localFlags = view.getUint16(localOffset + 6, true);
    const localCompressionMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if ((localFlags & 0x01) !== 0) {
      throw new Error("EXCEL_ENCRYPTED_WORKBOOK_UNSUPPORTED");
    }
    if (localCompressionMethod !== entry.compressionMethod) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_HEADER");
    }

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > centralDirectoryOffset || dataEnd > bytes.byteLength) {
      throw new Error("EXCEL_INVALID_ZIP_ENTRY_BOUNDS");
    }

    if (entry.compressionMethod === 0) {
      actualUncompressedBytes += entry.compressedSize;
    } else if (entry.compressionMethod === 8) {
      await pipeline(
        Readable.from([bytes.subarray(dataStart, dataEnd)]),
        createInflateRaw({ chunkSize: 16 * 1024 }),
        new Writable({
          write(chunk: Uint8Array, _encoding, callback) {
            actualUncompressedBytes += chunk.byteLength;
            callback(
              actualUncompressedBytes > limits.maxUncompressedBytes
                ? new Error("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED")
                : undefined,
            );
          },
        }),
      );
    } else {
      throw new Error("EXCEL_UNSUPPORTED_ZIP_COMPRESSION_METHOD");
    }

    if (actualUncompressedBytes > limits.maxUncompressedBytes) {
      throw new Error("EXCEL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED");
    }
  }

  if (
    actualUncompressedBytes >= limits.compressionRatioMinUncompressedBytes
    && actualUncompressedBytes / bytes.byteLength > limits.maxCompressionRatio
  ) {
    throw new Error("EXCEL_COMPRESSION_RATIO_EXCEEDED");
  }

  return actualUncompressedBytes;
}

export function validateLegacyXlsContainer(
  value: ArrayBuffer | Uint8Array,
  overrides?: ExcelResourceLimits,
): void {
  const limits = resolveExcelLimits(overrides);
  const bytes = toUint8Array(value);
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxFileBytes) {
    throw new Error("EXCEL_FILE_SIZE_OUT_OF_BOUNDS");
  }
  if (!hasOle2Signature(bytes)) {
    throw new Error("EXCEL_INVALID_OLE2_SIGNATURE");
  }
}
