import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

type ObjectRow = { type: string; name: string; tbl_name: string; sql: string };

// S4.6 recorded SHA-256 of Python's repr(list[tuple[str, ...]]) for sqlite_master.
// Read that historical manifest in Bun; no Python is needed by the migration.
function legacyString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r").replaceAll("\t", "\\t").replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

export function legacySchemaFingerprint(client: Database): string {
  const objects = client.query(
    "SELECT type, name, tbl_name, COALESCE(sql, '') AS sql FROM sqlite_master " +
    "WHERE name NOT LIKE 'sqlite_%' AND name != 'operatoros_schema_migrations' ORDER BY type, name",
  ).all() as ObjectRow[];
  const representation = `[${objects.map((object) =>
    `(${[object.type, object.name, object.tbl_name, object.sql].map(legacyString).join(", ")})`,
  ).join(", ")}]`;
  return createHash("sha256").update(representation).digest("hex");
}
