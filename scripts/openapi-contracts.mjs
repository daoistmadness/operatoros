import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = join(repositoryRoot, "apps", "web");
const generator = join(frontendRoot, "node_modules", "openapi-typescript", "bin", "cli.js");
const committedSpec = join(repositoryRoot, "openapi", "operatoros.openapi.json");
const committedTypes = join(frontendRoot, "src", "generated", "openapi", "schema.ts");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env },
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function generateInto(directory) {
  const specification = join(directory, "operatoros.openapi.json");
  const types = join(directory, "schema.ts");
  copyFileSync(committedSpec, specification);
  run(process.execPath, [generator, specification, "--output", types]);
  return { specification, types };
}

function assertSame(actual, expected, label) {
  if (Buffer.compare(readFileSync(actual), readFileSync(expected)) !== 0) {
    process.stderr.write(`API generation drift detected: ${label}\n`);
    process.exitCode = 1;
  }
}

function enforceImportBoundary() {
  const result = spawnSync(
    "grep",
    [
      "-RInE",
      "from [\"'][^\"']*generated/openapi|import\\([\"'][^\"']*generated/openapi",
      "src/pages",
      "src/components",
      "src/routes",
      "src/hooks",
    ],
    { cwd: frontendRoot, encoding: "utf8" },
  );
  if (result.status === 0) {
    process.stderr.write("Direct generated OpenAPI import outside compatibility adapters:\n");
    process.stderr.write(result.stdout);
    process.exit(1);
  }
  if (result.status !== 1) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  process.stderr.write("Usage: openapi-contracts.mjs <generate|check>\n");
  process.exit(2);
}

const temporary = mkdtempSync(join(tmpdir(), "operatoros-openapi."));
try {
  const output = generateInto(temporary);
  if (mode === "generate") {
    mkdirSync(dirname(committedSpec), { recursive: true });
    mkdirSync(dirname(committedTypes), { recursive: true });
    copyFileSync(output.specification, committedSpec);
    copyFileSync(output.types, committedTypes);
    process.stdout.write("API_GENERATION_UPDATED\n");
  } else {
    assertSame(output.specification, committedSpec, "OpenAPI specification");
    assertSame(output.types, committedTypes, "TypeScript contracts");
    enforceImportBoundary();
    if (process.exitCode) process.exit(process.exitCode);
    process.stdout.write("API_GENERATION_DRIFT_NONE\n");
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
