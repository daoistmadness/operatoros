import { describe, expect, it } from "bun:test";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";
import { performRestoreSwap } from "../src/domains/restore-transaction";

const active = "/data/operatoros.sqlite";
const candidate = "/data/operatoros.sqlite.candidate";
const rollback = "/data/operatoros.sqlite.rollback";

function files(initial: Record<string, string>): { store: Map<string, string>; fs: RestoreFileSystem } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    fs: {
      rename: (from, to) => { const value = store.get(from); if (value === undefined) throw new Error(`ENOENT ${from}`); store.delete(from); store.set(to, value); },
      remove: (path) => { store.delete(path); },
      exists: (path) => store.has(path),
    },
  };
}

describe("performRestoreSwap transitions", () => {
  it("treats a close failure as unchanged and leaves both files in place", () => {
    const { store, fs } = files({ [active]: "prior", [candidate]: "restored" });
    const result = performRestoreSwap({
      active, candidate, rollback, fileSystem: fs,
      close: () => { throw new Error("CLOSE_FAILED"); },
      reopen: () => { throw new Error("must not reopen"); },
      afterSwap: () => "unreachable",
    });
    expect(result.outcome).toBe("unchanged");
    expect(store.get(active)).toBe("prior");
    expect(store.get(candidate)).toBe("restored");
  });

  it("rolls back after a reopen failure and removes the parked copy", () => {
    const { store, fs } = files({ [active]: "prior", [candidate]: "restored" });
    let reopenCalls = 0;
    const result = performRestoreSwap({
      active, candidate, rollback, fileSystem: fs,
      close: () => {},
      reopen: () => { reopenCalls += 1; if (reopenCalls === 1) throw new Error("REOPEN_FAILED"); },
      afterSwap: () => "unreachable",
    });
    expect(result.outcome).toBe("rolled_back");
    expect(reopenCalls).toBe(2);
    expect(store.get(active)).toBe("prior");
    expect(store.has(rollback)).toBe(false);
    expect([...store.keys()].filter((path) => path.endsWith(".rejected"))).toEqual([]);
  });

  it("keeps the rollback copy when it cannot be removed after a verified commit", () => {
    const { store } = files({ [active]: "prior", [candidate]: "restored" });
    const result = performRestoreSwap({
      active, candidate, rollback,
      fileSystem: {
        rename: (from, to) => { const value = store.get(from); if (value === undefined) throw new Error(`ENOENT ${from}`); store.delete(from); store.set(to, value); },
        remove: () => { throw new Error("REMOVE_FAILED"); },
        exists: (path) => store.has(path),
      },
      close: () => {},
      reopen: () => {},
      afterSwap: () => "verified",
    });
    expect(result.outcome).toBe("committed");
    expect(result.value).toBe("verified");
    expect(store.get(active)).toBe("restored");
    expect(store.get(rollback)).toBe("prior");
  });

  it("reports recovery_required when the restored copy cannot be parked", () => {
    const { store } = files({ [active]: "prior", [candidate]: "restored" });
    const result = performRestoreSwap({
      active, candidate, rollback,
      fileSystem: {
        rename: (from, to) => {
          if (from === active && to.endsWith(".rejected")) throw new Error("PARK_FAILED");
          const value = store.get(from); if (value === undefined) throw new Error(`ENOENT ${from}`); store.delete(from); store.set(to, value);
        },
        remove: (path) => { store.delete(path); },
        exists: (path) => store.has(path),
      },
      close: () => {},
      reopen: () => {},
      afterSwap: () => { throw new Error("VERIFY_FAILED"); },
    });
    expect(result.outcome).toBe("recovery_required");
    expect(store.get(active)).toBe("restored");
    expect(store.get(rollback)).toBe("prior");
  });
});
