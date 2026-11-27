export const EXCEL_UPLOAD_ADMISSION_LIMITS = {
  maxActiveUploads: 2,
  maxInFlightBytes: 50 * 1024 * 1024,
  defaultMaxUploadBytes: 25 * 1024 * 1024,
  machineMaxUploadBytes: 10 * 1024 * 1024,
} as const;

const EXCEL_UPLOAD_ROUTE_LIMITS: Array<{ pattern: RegExp; maxBytes: number }> = [
  { pattern: /^\/api\/uploads\/preview$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.defaultMaxUploadBytes },
  { pattern: /^\/api\/attendance\/machine-import\/preview$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.machineMaxUploadBytes },
  { pattern: /^\/api\/attendance\/machine-import\/apply$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.machineMaxUploadBytes },
  { pattern: /^\/api\/student-enrollments\/roster-preview$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.defaultMaxUploadBytes },
  { pattern: /^\/api\/student-masters\/management\/update-preview$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.defaultMaxUploadBytes },
  { pattern: /^\/api\/staff\/import\/preview$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.defaultMaxUploadBytes },
  { pattern: /^\/api\/upp-reports(?:\/\d+\/versions)?$/, maxBytes: EXCEL_UPLOAD_ADMISSION_LIMITS.defaultMaxUploadBytes },
];

let activeUploads = 0;
let inFlightBytes = 0;
const activeRequestReleases = new WeakMap<Request, () => void>();

export function getExcelUploadAdmissionStats() {
  return {
    activeUploads,
    inFlightBytes,
  };
}

export function excelUploadLimitForRequest(method: string, pathname: string): number | null {
  if (method.toUpperCase() !== "POST") return null;
  for (const rule of EXCEL_UPLOAD_ROUTE_LIMITS) {
    if (rule.pattern.test(pathname)) return rule.maxBytes;
  }
  return null;
}

export function admitExcelUploadRequest(
  request: Request,
): { admitted: true } | { admitted: false; status: number; detail: string } {
  const pathname = new URL(request.url).pathname;
  const maxBytes = excelUploadLimitForRequest(request.method, pathname);
  if (maxBytes === null) return { admitted: true };
  if (activeRequestReleases.has(request)) return { admitted: true };

  const contentLengthHeader = request.headers.get("content-length");
  let reservedBytes = maxBytes;
  if (contentLengthHeader !== null) {
    const parsedLength = Number(contentLengthHeader);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { admitted: false, status: 400, detail: "Invalid Content-Length header." };
    }
    if (parsedLength > maxBytes) {
      return {
        admitted: false,
        status: 413,
        detail: `Uploaded workbook exceeds maximum limit of ${maxBytes} bytes.`,
      };
    }
    reservedBytes = parsedLength;
  }

  if (
    activeUploads >= EXCEL_UPLOAD_ADMISSION_LIMITS.maxActiveUploads
    || inFlightBytes + reservedBytes > EXCEL_UPLOAD_ADMISSION_LIMITS.maxInFlightBytes
  ) {
    return {
      admitted: false,
      status: 503,
      detail: "Too many concurrent workbook uploads in progress. Please retry shortly.",
    };
  }

  activeUploads += 1;
  inFlightBytes += reservedBytes;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
    inFlightBytes = Math.max(0, inFlightBytes - reservedBytes);
    activeRequestReleases.delete(request);
  };

  request.signal.addEventListener("abort", release, { once: true });
  activeRequestReleases.set(request, release);
  return { admitted: true };
}

export function releaseExcelUploadRequest(request: Request): void {
  activeRequestReleases.get(request)?.();
}
