import Database from "better-sqlite3";

type SqliteBindingValue = string | number | bigint | boolean | ArrayBufferView | ArrayBuffer | null;
export type SqliteBinding = SqliteBindingValue | Readonly<Record<string, SqliteBindingValue>>;
export type SqliteStatementBinding = SqliteBinding | readonly SqliteBinding[];
type QueryBindingShape = SqliteBinding | readonly SqliteStatementBinding[];

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement<Row = Record<string, unknown>, Bindings extends readonly SqliteStatementBinding[] = readonly SqliteStatementBinding[]> {
  get(...bindings: Bindings): Row | null;
  all(...bindings: Bindings): Row[];
  run(...bindings: Bindings): SqliteRunResult;
}

export type SqliteTransaction<T> = Database.Transaction<() => T>;

export interface SqliteClient {
  query<Row = Record<string, unknown>, Bindings extends QueryBindingShape = readonly SqliteStatementBinding[]>(sql: string): SqliteStatement<Row, Bindings extends readonly SqliteStatementBinding[] ? Bindings : [Bindings]>;
  run(sql: string, ...bindings: SqliteStatementBinding[]): SqliteRunResult;
  exec(sql: string): void;
  transaction<T>(callback: () => T): SqliteTransaction<T>;
  serialize(): Uint8Array;
  close(): void;
}

export interface SqliteConnection {
  readonly database: Database.Database;
  readonly client: SqliteClient;
}

function normalizeBinding(value: SqliteBinding): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value) && !(value instanceof Uint8Array)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(value).map(([name, binding]) => [name, normalizeBinding(binding)]));
  }
  return value;
}

function isBindingArray(value: SqliteStatementBinding): value is readonly SqliteBinding[] {
  return Array.isArray(value);
}

function normalizeBindings(bindings: readonly SqliteStatementBinding[]): unknown[] {
  const first = bindings[0];
  const values = bindings.length === 1 && first !== undefined && isBindingArray(first) ? first : bindings;
  return values.map((value) => isBindingArray(value) ? value.map(normalizeBinding) : normalizeBinding(value));
}

export function createSqliteClient(database: Database.Database): SqliteClient {
  return {
    query<Row = Record<string, unknown>>(sql: string): SqliteStatement<Row> {
      const statement = database.prepare<unknown[], Row>(sql);
      return {
        get(...bindings: SqliteStatementBinding[]) {
          return statement.get(...normalizeBindings(bindings)) ?? null;
        },
        all(...bindings: SqliteStatementBinding[]) {
          return statement.all(...normalizeBindings(bindings));
        },
        run(...bindings: SqliteStatementBinding[]) {
          return statement.run(...normalizeBindings(bindings));
        },
      };
    },
    run(sql, ...bindings) {
      return database.prepare<unknown[], Record<string, unknown>>(sql).run(...normalizeBindings(bindings));
    },
    exec(sql) {
      database.exec(sql);
    },
    transaction<T>(callback: () => T): SqliteTransaction<T> {
      return database.transaction(callback);
    },
    serialize() {
      return database.serialize();
    },
    close() {
      database.close();
    },
  };
}

export function openSqliteConnection(
  path: string,
  options: Database.Options = {},
): SqliteConnection {
  const database = new Database(path, options);
  return { database, client: createSqliteClient(database) };
}
