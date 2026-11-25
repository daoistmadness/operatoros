import { CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS, compareSchemaVersions } from "./manifest";

try {
  if (process.argv.includes("--compare")) {
    const idx = process.argv.indexOf("--compare");
    const left = process.argv[idx + 1];
    const right = process.argv[idx + 2];
    if (!left || !right) throw new Error("Usage: --compare <version1> <version2>");
    const result = compareSchemaVersions(left, right);
    if (result === undefined) {
      process.stderr.write(`UNKNOWN_SCHEMA_VERSION: ${left} or ${right}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${result}\n`);
    }
  } else {
    const format = process.argv.includes("--format")
      ? process.argv[process.argv.indexOf("--format") + 1]
      : "current";
    if (format === "current") {
      process.stdout.write(`${CURRENT_SCHEMA_VERSION}\n`);
    } else if (format === "order") {
      process.stdout.write(`${JSON.stringify(SCHEMA_MIGRATIONS)}\n`);
    } else {
      throw new Error(`Unknown format: ${format}`);
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "SCHEMA_VERSION_RESOLVER_FAILED"}\n`);
  process.exitCode = 2;
}
