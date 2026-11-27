export const EXCEL_ADMISSION_LIMITS = {
  maxActiveJobs: 1,
  maxQueuedJobs: 2,
  maxQueuedBytes: 50 * 1024 * 1024,
  queueTimeoutMs: 10_000,
} as const;

export class ExcelAdmissionError extends Error {
  readonly status = 503;

  constructor(
    readonly code: "EXCEL_ADMISSION_BUSY" | "EXCEL_QUEUE_TIMEOUT" | "EXCEL_ADMISSION_ABORTED",
    message: string,
  ) {
    super(message);
    this.name = "ExcelAdmissionError";
  }
}

type Waiter = {
  bytes: number;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
  settled: boolean;
};

let activeJobs = 0;
let queuedBytes = 0;
const queue: Waiter[] = [];

export function getExcelAdmissionStats() {
  return {
    activeJobs,
    queuedJobs: queue.length,
    queuedBytes,
  };
}

function makeRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeJobs = Math.max(0, activeJobs - 1);
    dispatchNext();
  };
}

function removeWaiter(waiter: Waiter): void {
  const index = queue.indexOf(waiter);
  if (index >= 0) {
    queue.splice(index, 1);
    queuedBytes = Math.max(0, queuedBytes - waiter.bytes);
  }
  clearTimeout(waiter.timer);
  waiter.cleanupAbort?.();
}

function dispatchNext(): void {
  while (activeJobs < EXCEL_ADMISSION_LIMITS.maxActiveJobs && queue.length > 0) {
    const next = queue.shift()!;
    queuedBytes = Math.max(0, queuedBytes - next.bytes);
    clearTimeout(next.timer);
    next.cleanupAbort?.();
    if (next.settled) continue;
    next.settled = true;
    activeJobs += 1;
    next.resolve(makeRelease());
  }
}

export function acquireExcelPermit(bytes: number, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) {
    return Promise.reject(new ExcelAdmissionError("EXCEL_ADMISSION_ABORTED", "Workbook request was cancelled before processing."));
  }
  if (activeJobs < EXCEL_ADMISSION_LIMITS.maxActiveJobs && queue.length === 0) {
    activeJobs += 1;
    return Promise.resolve(makeRelease());
  }
  if (
    queue.length >= EXCEL_ADMISSION_LIMITS.maxQueuedJobs
    || queuedBytes + bytes > EXCEL_ADMISSION_LIMITS.maxQueuedBytes
  ) {
    return Promise.reject(
      new ExcelAdmissionError(
        "EXCEL_ADMISSION_BUSY",
        "The server is currently processing another workbook. Please retry shortly.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      bytes,
      resolve,
      reject,
      settled: false,
      timer: setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeWaiter(waiter);
        reject(new ExcelAdmissionError("EXCEL_QUEUE_TIMEOUT", "Workbook processing queue timed out. Please retry."));
      }, EXCEL_ADMISSION_LIMITS.queueTimeoutMs),
    };

    if (signal) {
      const onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeWaiter(waiter);
        reject(new ExcelAdmissionError("EXCEL_ADMISSION_ABORTED", "Workbook request was cancelled while queued."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiter.cleanupAbort = () => signal.removeEventListener("abort", onAbort);
    }

    queuedBytes += bytes;
    queue.push(waiter);
  });
}

export async function withExcelAdmission<T>(
  bytes: number,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await acquireExcelPermit(bytes, signal);
  try {
    return await run();
  } finally {
    release();
  }
}

export function withExcelExportAdmission<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withExcelAdmission(0, run, signal);
}

export async function createAdmittedXlsxResponse(
  build: () => Promise<{ bytes: Uint8Array; headers: Record<string, string> }>,
  signal?: AbortSignal,
): Promise<Response> {
  const release = await acquireExcelPermit(0, signal);
  try {
    const built = await build();
    return new Response(built.bytes, { headers: built.headers });
  } finally {
    release();
  }
}
