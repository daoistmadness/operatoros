import type { AuthContext } from "../src/auth/service";
import { createPreview } from "../src/domains/attendance-import";
import type { WorkbookRows } from "../src/import/excel-reader";

type Metric = { calls: number; ms: number };
type Preview = ReturnType<typeof createPreview>;
type StageProfile = {
  createPreviewMs: number;
  transaction: { calls: number; totalMs: number; callbackMs: number; beginAndCommitMs: number };
  database: Record<string, Metric>;
  serialization: { stringifyCalls: number; stringifyMs: number; stringifyChars: number; parseCalls: number; parseMs: number; parsedChars: number };
  unaccountedMs: number;
};

const metric = (): Metric => ({ calls: 0, ms: 0 });
const add = (target: Metric, started: number) => { target.calls += 1; target.ms += performance.now() - started; };
const kindOf = (sql: string): string => {
  if (/student_device_identities/i.test(sql)) return "identityLookup";
  if (/FROM attendance\b/i.test(sql)) return "attendanceLookup";
  if (/attendance_overrides/i.test(sql)) return "overrideLookup";
  if (/attendance_import_rows/i.test(sql)) return "stagingRows";
  if (/attendance_import_batches/i.test(sql)) return "stagingBatch";
  return "other";
};

export function profileAttendancePreview(
  context: AuthContext,
  workbook: WorkbookRows,
  filename: string,
  checksum: string,
  username: string,
): { preview: Preview; profile: StageProfile } {
  const metrics: StageProfile = {
    createPreviewMs: 0,
    transaction: { calls: 0, totalMs: 0, callbackMs: 0, beginAndCommitMs: 0 },
    database: {},
    serialization: { stringifyCalls: 0, stringifyMs: 0, stringifyChars: 0, parseCalls: 0, parseMs: 0, parsedChars: 0 },
    unaccountedMs: 0,
  };
  let inTransaction = false;
  const bucket = (key: string) => metrics.database[key] ??= metric();
  const client = context.database.client;
  const proxy = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "query" && typeof value === "function") return (...args: unknown[]) => {
        const sql = String(args[0] ?? "");
        const prepareStarted = performance.now();
        const statement = Reflect.apply(value, target, args);
        add(bucket(`queryBuild.${inTransaction ? "tx" : "outside"}`), prepareStarted);
        const kind = kindOf(sql);
        return new Proxy(statement, {
          get(statementTarget, method) {
            const operation = Reflect.get(statementTarget, method, statementTarget);
            if (["get", "all", "run"].includes(String(method)) && typeof operation === "function") return (...params: unknown[]) => {
              const started = performance.now();
              try { return Reflect.apply(operation, statementTarget, params); }
              finally {
                add(bucket(`query.${String(method)}.${inTransaction ? "tx" : "outside"}`), started);
                add(bucket(`queryKind.${kind}.${inTransaction ? "tx" : "outside"}`), started);
              }
            };
            return typeof operation === "function" ? operation.bind(statementTarget) : operation;
          },
        });
      };
      if (property === "run" && typeof value === "function") return (sql: string, ...args: unknown[]) => {
        const started = performance.now();
        try { return Reflect.apply(value, target, [sql, ...args]); }
        finally {
          add(bucket(`run.${inTransaction ? "tx" : "outside"}`), started);
          add(bucket(`runKind.${kindOf(sql)}.${inTransaction ? "tx" : "outside"}`), started);
        }
      };
      if (property === "transaction" && typeof value === "function") return (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
        metrics.transaction.calls += 1;
        const wrappedCallback = (...callbackArgs: unknown[]) => {
          const previous = inTransaction;
          inTransaction = true;
          const started = performance.now();
          try { return callback(...callbackArgs); }
          finally {
            metrics.transaction.callbackMs += performance.now() - started;
            inTransaction = previous;
          }
        };
        const transaction = Reflect.apply(value, target, [wrappedCallback, ...args]);
        const wrappedTransaction = (...transactionArgs: unknown[]) => Reflect.apply(transaction, transaction, transactionArgs);
        for (const method of ["deferred", "immediate", "exclusive"] as const) {
          const operation = Reflect.get(transaction, method, transaction);
          if (typeof operation !== "function") continue;
          Object.defineProperty(wrappedTransaction, method, { value: (...transactionArgs: unknown[]) => {
            const started = performance.now();
            try { return Reflect.apply(operation, transaction, transactionArgs); }
            finally { if (method === "immediate") metrics.transaction.totalMs += performance.now() - started; }
          } });
        }
        return wrappedTransaction;
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  const trackedStringify: typeof JSON.stringify = (value, replacer, space) => {
    const started = performance.now();
    try {
      const result = originalStringify(value, replacer, space);
      metrics.serialization.stringifyCalls += 1;
      metrics.serialization.stringifyChars += result?.length ?? 0;
      return result;
    } finally { metrics.serialization.stringifyMs += performance.now() - started; }
  };
  const trackedParse: typeof JSON.parse = (text, reviver) => {
    const started = performance.now();
    try {
      metrics.serialization.parseCalls += 1;
      metrics.serialization.parsedChars += String(text ?? "").length;
      return originalParse(text, reviver);
    } finally { metrics.serialization.parseMs += performance.now() - started; }
  };
  const stringifyDescriptor = Object.getOwnPropertyDescriptor(JSON, "stringify");
  const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
  Object.defineProperty(JSON, "stringify", { ...stringifyDescriptor, value: trackedStringify });
  Object.defineProperty(JSON, "parse", { ...parseDescriptor, value: trackedParse });
  const profiledContext: AuthContext = { ...context, database: { ...context.database, client: proxy } };
  const started = performance.now();
  let preview: Preview;
  try { preview = createPreview(profiledContext, workbook, filename, checksum, username); }
  finally {
    metrics.createPreviewMs = performance.now() - started;
    if (stringifyDescriptor) Object.defineProperty(JSON, "stringify", stringifyDescriptor);
    if (parseDescriptor) Object.defineProperty(JSON, "parse", parseDescriptor);
  }
  metrics.transaction.beginAndCommitMs = Math.max(0, metrics.transaction.totalMs - metrics.transaction.callbackMs);
  const databaseMs = Object.entries(metrics.database).reduce((sum, [key, value]) => key.startsWith("queryBuild.") || key.startsWith("query.") || key.startsWith("run.") ? sum + value.ms : sum, 0);
  metrics.unaccountedMs = Math.max(0, metrics.createPreviewMs - databaseMs - metrics.serialization.stringifyMs - metrics.serialization.parseMs);
  return { preview, profile: metrics };
}
