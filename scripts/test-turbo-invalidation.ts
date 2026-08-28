import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type TurboTask = {
  taskId: string;
  command: string;
  hash: string;
};

type TurboDryRun = { tasks: TurboTask[] };

const root = join(import.meta.dir, "..");
const turboConfig = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")) as {
  tasks: Record<string, { cache?: boolean; outputs?: string[] }>;
};

for (const taskName of ["dev", "preview", "test:e2e", "e2e:release", "api:generate", "resolve-data-dir", "check:audit"]) {
  if (turboConfig.tasks[taskName]?.cache !== false) {
    throw new Error(`Stateful or external task is cacheable: ${taskName}`);
  }
}
if (JSON.stringify(turboConfig).match(/operatoros\.sqlite|backups|logs|OPERATOROS_DATA_DIR/)) {
  throw new Error("Turbo configuration references operator data");
}

function dryRun(): TurboDryRun {
  const result = Bun.spawnSync(["bun", "run", "turbo:check", "--", "--dry=json"], {
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr) || output);
  }
  return JSON.parse(output.slice(output.indexOf("{"))) as TurboDryRun;
}

function taskMap(run: TurboDryRun): Map<string, TurboTask> {
  return new Map(run.tasks.filter((task) => task.command !== "<NONEXISTENT>").map((task) => [task.taskId, task]));
}

function assertChanged(before: Map<string, TurboTask>, after: Map<string, TurboTask>, taskIds: string[], label: string): void {
  for (const taskId of taskIds) {
    const previous = before.get(taskId);
    const current = after.get(taskId);
    if (!previous || !current || previous.hash === current.hash) {
      throw new Error(`Turbo invalidation failed for ${label}: ${taskId}`);
    }
  }
}

function assertAllChanged(before: Map<string, TurboTask>, after: Map<string, TurboTask>, label: string): void {
  assertChanged(before, after, [...before.keys()], label);
}

function withTemporaryChange<T>(relativePath: string, suffix: string, callback: () => T): T {
  const path = join(root, relativePath);
  const original = readFileSync(path);
  try {
    appendFileSync(path, suffix);
    return callback();
  } finally {
    writeFileSync(path, original);
  }
}

const baseline = taskMap(dryRun());
const contractDependents = [
  "@operatoros/contracts#typecheck",
  "@operatoros/contracts#test",
  "@operatoros/api#typecheck",
  "@operatoros/api#test",
  "@operatoros/web#typecheck",
  "@operatoros/web#test",
  "@operatoros/web#build",
];
const dbDependents = [
  "@operatoros/db#typecheck",
  "@operatoros/db#test",
  "@operatoros/api#typecheck",
  "@operatoros/api#test",
];
const uiDependents = [
  "@operatoros/ui#typecheck",
  "@operatoros/ui#test",
  "@operatoros/web#typecheck",
  "@operatoros/web#test",
  "@operatoros/web#build",
];

withTemporaryChange("packages/contracts/src/index.ts", "\n// turbo invalidation proof\n", () => {
  assertChanged(baseline, taskMap(dryRun()), contractDependents, "contracts -> API/web");
});
withTemporaryChange("packages/db/src/index.ts", "\n// turbo invalidation proof\n", () => {
  const changed = taskMap(dryRun());
  assertChanged(baseline, changed, dbDependents, "DB -> API");
  for (const taskId of ["@operatoros/web#typecheck", "@operatoros/web#test", "@operatoros/web#build"]) {
    if (baseline.get(taskId)?.hash !== changed.get(taskId)?.hash) {
      throw new Error(`Turbo invalidation incorrectly reached web from DB: ${taskId}`);
    }
  }
});
withTemporaryChange("packages/ui/src/index.ts", "\n// turbo invalidation proof\n", () => {
  const changed = taskMap(dryRun());
  assertChanged(baseline, changed, uiDependents, "UI -> web");
  for (const taskId of ["@operatoros/api#typecheck", "@operatoros/api#test", "@operatoros/api#build"]) {
    if (baseline.get(taskId)?.hash !== changed.get(taskId)?.hash) {
      throw new Error(`Turbo invalidation incorrectly reached API from UI: ${taskId}`);
    }
  }
});
withTemporaryChange("scripts/check-architecture.ts", "\n// turbo global invalidation proof\n", () => {
  assertAllChanged(baseline, taskMap(dryRun()), "architecture configuration");
});
withTemporaryChange("bun.lock", "\n", () => {
  assertAllChanged(baseline, taskMap(dryRun()), "bun.lock");
});

console.log("Turbo invalidation proofs: PASS");
