import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectedFingerprint, resolvePythonExecutable, resolveVenvPath } from "../python-tooling-env";

describe("external Python tooling environment", () => {
  test("uses the explicit external override and platform executable", () => {
    const root = "/work/operatoros";
    const venv = resolveVenvPath(root, { OPERATOROS_PYTHON_VENV: "/tmp/operatoros-python" });
    expect(venv).toBe("/tmp/operatoros-python");
    expect(resolvePythonExecutable(venv)).toBe("/tmp/operatoros-python/bin/python");
  });

  test("rejects relative and worktree-local environments", () => {
    expect(() => resolveVenvPath("/work/operatoros", { OPERATOROS_PYTHON_VENV: "venv" })).toThrow("absolute path");
    expect(() => resolveVenvPath("/work/operatoros", { OPERATOROS_PYTHON_VENV: "/work/operatoros/backend/.venv" })).toThrow("outside the repository");
  });

  test("fingerprints the current mise Python version and retained requirements", () => {
    const root = `/tmp/operatoros-python-tooling-fixture-${process.pid}`;
    mkdirSync(join(root, "backend"), { recursive: true });
    writeFileSync(join(root, "mise.toml"), '[tools]\npython = "3.12.3"\n');
    writeFileSync(join(root, "backend", "requirements.txt"), "pytest==8.3.4\n");
    try {
      const first = expectedFingerprint(root);
      writeFileSync(join(root, "backend", "requirements.txt"), "pytest==8.3.5\n");
      const second = expectedFingerprint(root);
      expect(first.pythonVersion).toBe("3.12.3");
      expect(first.requirementsSha256).not.toBe(second.requirementsSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
