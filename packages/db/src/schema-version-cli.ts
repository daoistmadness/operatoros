import { CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from "./manifest";

try {
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
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "SCHEMA_VERSION_RESOLVER_FAILED"}\n`);
  process.exitCode = 2;
}
