import { describe, expect, test } from "bun:test";
import {
  checkTypeScriptVersions,
  parseMinimumMajor,
  PERMITTED_COMPATIBILITY_PACKAGE,
} from "../check-typescript-version";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseMinimumMajor", () => {
  test("identifies major version for exact pins", () => {
    expect(parseMinimumMajor("7.0.2")).toBe(7);
    expect(parseMinimumMajor("5.9.3")).toBe(5);
    expect(parseMinimumMajor("8.0.0")).toBe(8);
  });

  test("identifies major version for ranges", () => {
    expect(parseMinimumMajor("^7.0.2")).toBe(7);
    expect(parseMinimumMajor("~7.0.0")).toBe(7);
    expect(parseMinimumMajor(">=7.0.0")).toBe(7);
    expect(parseMinimumMajor("^5.9.3")).toBe(5);
  });

  test("rejects versions with upper bound below 7", () => {
    expect(parseMinimumMajor("<7.0.0")).toBe(0);
    expect(parseMinimumMajor("<=6.5.0")).toBe(0);
  });
});

describe("checkTypeScriptVersions against repository", () => {
  const repoRoot = join(import.meta.dir, "../..");

  test("passes on current repository manifests and recognizes scoped compatibility package", () => {
    const result = checkTypeScriptVersions(repoRoot);
    expect(result.errors).toEqual([]);
    expect(result.checked.length).toBeGreaterThanOrEqual(3);
    expect(result.compatibilityExceptionFound).toBe(true);

    const rootTs = result.checked.find(
      (c) => c.workspace === "root" && c.dependency === "typescript"
    );
    expect(rootTs?.version).toBe("7.0.2");

    const rootCompat = result.checked.find(
      (c) => c.workspace === "root" && c.dependency === PERMITTED_COMPATIBILITY_PACKAGE
    );
    expect(rootCompat).toBeDefined();

    const webCheck = result.checked.find(
      (c) => c.workspace === "apps/web" && c.dependency === "typescript"
    );
    expect(webCheck?.version).toBe("7.0.2");

    const apiCheck = result.checked.find(
      (c) => c.workspace === "apps/api" && c.dependency === "typescript"
    );
    expect(apiCheck?.version).toBe("7.0.2");
  });

  test("fails when a workspace has a direct TypeScript dependency < 7", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "5.9.3",
            [PERMITTED_COMPATIBILITY_PACKAGE]: "6.0.2",
          },
        })
      );
      await mkdir(join(tempDir, "packages", "pkg-a"), { recursive: true });
      await writeFile(
        join(tempDir, "packages", "pkg-a", "package.json"),
        JSON.stringify({
          name: "@test/pkg-a",
          devDependencies: {
            typescript: "7.0.2",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("must be >=7.0.0");
      expect(result.errors[0]).toContain("5.9.3");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("fails when a child workspace downgrades direct TypeScript below 7", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "7.0.2",
            [PERMITTED_COMPATIBILITY_PACKAGE]: "6.0.2",
          },
        })
      );
      await mkdir(join(tempDir, "packages", "pkg-b"), { recursive: true });
      await writeFile(
        join(tempDir, "packages", "pkg-b", "package.json"),
        JSON.stringify({
          name: "@test/pkg-b",
          dependencies: {
            typescript: "5.4.5",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("packages/pkg-b");
      expect(result.errors[0]).toContain("5.4.5");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("fails when @typescript/typescript6 is declared outside root devDependencies", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "7.0.2",
            [PERMITTED_COMPATIBILITY_PACKAGE]: "6.0.2",
          },
        })
      );
      await mkdir(join(tempDir, "packages", "child"), { recursive: true });
      await writeFile(
        join(tempDir, "packages", "child", "package.json"),
        JSON.stringify({
          name: "@test/child",
          devDependencies: {
            typescript: "7.0.2",
            [PERMITTED_COMPATIBILITY_PACKAGE]: "6.0.2",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain(
        "@typescript/typescript6 is scoped exclusively to root devDependencies"
      );
      expect(result.errors[0]).toContain("packages/child");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects unauthorized npm:typescript aliases", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "7.0.2",
            "@typescript/native": "npm:typescript@7.0.2",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Unauthorized TypeScript alias");
      expect(result.errors[0]).toContain("@typescript/native");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects unauthorized compatibility packages", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "7.0.2",
            "typescript-compiler-api": "5.9.3",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Unauthorized TypeScript package or alias");
      expect(result.errors[0]).toContain("typescript-compiler-api");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("preserves transitive peerDependencies without flagging them as direct dependencies", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ts-version-guard-test-"));
    try {
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-monorepo",
          workspaces: ["packages/*"],
          devDependencies: {
            typescript: "7.0.2",
            [PERMITTED_COMPATIBILITY_PACKAGE]: "6.0.2",
          },
        })
      );
      await mkdir(join(tempDir, "packages", "pkg-c"), { recursive: true });
      await writeFile(
        join(tempDir, "packages", "pkg-c", "package.json"),
        JSON.stringify({
          name: "@test/pkg-c",
          peerDependencies: {
            typescript: "^5.0.0",
          },
        })
      );

      const result = checkTypeScriptVersions(tempDir);
      expect(result.errors).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
