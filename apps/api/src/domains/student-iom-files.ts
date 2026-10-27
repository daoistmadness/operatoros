import { storeReportFile, storedReportFile, type FileMetadata } from "./upp-report-files";
import { PDFDocument } from "pdf-lib";

export async function isPdfDocument(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length < 5) return false;
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) return false;
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    document.getPageCount();
    return true;
  } catch {
    return false;
  }
}

export function sanitizeIomFilename(name: string, fallback = "iom_document.pdf"): string {
  const base = name.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const cleaned = base && base !== "." && base !== ".." ? base : fallback;
  return cleaned.slice(0, 255);
}

export function storeIomPdfFile(dataDir: string, bytes: Uint8Array): FileMetadata {
  return storeReportFile(dataDir, bytes);
}

export function getIomPdfFilePath(dataDir: string, metadata: FileMetadata): string {
  return storedReportFile(dataDir, metadata);
}
