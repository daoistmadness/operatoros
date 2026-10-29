import { describe, expect, it } from "vitest";
import {
  defaultUiPreferences,
  readUiPreferences,
  resetUiPreferences,
  saveUiPreferences,
} from "./ui-preferences";

function createStorage(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set("operatoros:ui-preferences", initial);

  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("UI preferences", () => {
  it("uses safe defaults and restores the supported version", () => {
    const storage = createStorage();
    expect(readUiPreferences(storage)).toEqual(defaultUiPreferences());

    storage.setItem("operatoros:ui-preferences", JSON.stringify({ version: 1, sidebarCollapsed: true }));
    expect(readUiPreferences(storage)).toEqual({ version: 1, sidebarCollapsed: true });
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 2, sidebarCollapsed: true }),
    JSON.stringify({ version: 1, sidebarCollapsed: true, studentRecords: ["private"] }),
  ])("ignores invalid or non-allowlisted stored values", (value) => {
    expect(readUiPreferences(createStorage(value))).toEqual(defaultUiPreferences());
  });

  it("writes only the typed preference and resets it", () => {
    const storage = createStorage();
    expect(saveUiPreferences({ version: 1, sidebarCollapsed: true }, storage)).toBe(true);
    expect(storage.values.get("operatoros:ui-preferences")).toBe('{"version":1,"sidebarCollapsed":true}');
    expect(resetUiPreferences(storage)).toBe(true);
    expect(readUiPreferences(storage)).toEqual(defaultUiPreferences());
  });

  it("falls back to defaults when browser storage is unavailable", () => {
    const storage = {
      getItem: () => { throw new Error("storage denied"); },
      setItem: () => { throw new Error("storage denied"); },
      removeItem: () => { throw new Error("storage denied"); },
    };

    expect(readUiPreferences(storage)).toEqual(defaultUiPreferences());
    expect(saveUiPreferences(defaultUiPreferences(), storage)).toBe(false);
    expect(resetUiPreferences(storage)).toBe(false);
  });
});
