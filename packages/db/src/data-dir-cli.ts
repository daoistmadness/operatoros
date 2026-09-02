import { resolveOperatorOSPaths } from "./data-dir";

try {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf("--repo");
  const formatIndex = args.indexOf("--format");
  const repositoryRoot = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const format = (formatIndex >= 0 ? args[formatIndex + 1] : undefined) ?? "data-dir";
  const paths = resolveOperatorOSPaths({ repositoryRoot });
  const values = { "data-dir": paths.dataDir, database: paths.databasePath, "backup-dir": paths.backupDir, "log-dir": paths.logDir };
  if (!(format in values)) throw new Error(`Unknown format: ${format}`);
  process.stdout.write(`${values[format as keyof typeof values]}\n`);
} catch (error) {
  process.stdout.write(`${error instanceof Error ? error.message : "DATA_DIR_RESOLVER_FAILED"}\n`);
  process.exitCode = 2;
}
