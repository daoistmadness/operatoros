import { runBackupCli } from "./backup-cli";

await runBackupCli(process.argv.slice(2));
