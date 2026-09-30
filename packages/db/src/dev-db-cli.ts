import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFreshDatabase } from "./bootstrap";
import { openDatabase } from "./connection";
import { assertDatabaseMigrationSafe, resolveOperatorOSPaths } from "./data-dir";
import { CURRENT_SCHEMA_VERSION } from "./manifest";

try {
  const [command, repoFlag, repoValue, dirFlag, dirValue, schemaFlag, schemaValue] = process.argv.slice(2);
  if (command !== "ensure" || repoFlag !== "--repo" || !repoValue || dirFlag !== "--data-dir" || !dirValue ||
    schemaFlag !== "--expected-schema" || schemaValue !== CURRENT_SCHEMA_VERSION || process.argv.length !== 9) {
    throw new Error("DEVELOPMENT_DATABASE_ARGUMENT_INVALID");
  }
  const repo = resolve(repoValue);
  const paths = resolveOperatorOSPaths({ repositoryRoot: repo, env: { OPERATOROS_DATA_DIR: dirValue } });
  assertDatabaseMigrationSafe(paths);
  if (existsSync(paths.databasePath) && (!lstatSync(paths.databasePath).isFile() || lstatSync(paths.databasePath).isSymbolicLink())) {
    throw new Error("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE");
  }
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dataDir, 0o700);
  const commonResult = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { stdout: "pipe", stderr: "pipe" });
  if (commonResult.exitCode !== 0) throw new Error("DEVELOPMENT_DATABASE_REPOSITORY_ID_UNAVAILABLE");
  const common = resolve(commonResult.stdout.toString().trim());
  const metadataPath = `${paths.dataDir}/database.json`;
  if (!existsSync(metadataPath)) {
    const repositoryId = createHash("sha256").update(common).digest("hex").slice(0, 16);
    const metadata = {
      format_version: 1, application: "OperatorOS", repository_instance_id: repositoryId,
      git_common_directory_hash: createHash("sha256").update(common).digest("hex"),
      created_at: new Date().toISOString(), database_relative_filename: "operatoros.sqlite",
      schema_expectation: CURRENT_SCHEMA_VERSION, persistence_classification: "PERSISTENT_LOCAL_DEVELOPMENT_DATABASE",
    };
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } else {
    if (lstatSync(metadataPath).isSymbolicLink()) throw new Error("DEVELOPMENT_DATABASE_METADATA_INVALID");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.application !== "OperatorOS" || metadata.database_relative_filename !== "operatoros.sqlite" ||
      metadata.git_common_directory_hash !== createHash("sha256").update(common).digest("hex")) {
      throw new Error("DEVELOPMENT_DATABASE_METADATA_INVALID");
    }
  }
  if (existsSync(paths.databasePath)) {
    const handle = openDatabase(paths.databasePath, { readonly: true });
    handle.close();
  } else createFreshDatabase(paths.databasePath);
  console.log(paths.databasePath);
} catch (error) {
  const message = error instanceof Error ? error.message : "PERSISTENT_DEVELOPMENT_DATABASE_OPERATION_FAILED";
  console.error(message.includes("DATABASE_") ? message : `PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE: ${message}`);
  process.exitCode = 2;
}
