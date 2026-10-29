import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const UI_PREFERENCES_STORAGE_KEY = "operatoros:ui-preferences";

const UiPreferencesSchema = Type.Object({
  version: Type.Literal(1),
  sidebarCollapsed: Type.Boolean(),
}, { additionalProperties: false });

export type UiPreferences = Static<typeof UiPreferencesSchema>;
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function defaultUiPreferences(): UiPreferences {
  return { version: 1, sidebarCollapsed: false };
}

export function readUiPreferences(storage: PreferenceStorage | null = browserStorage()): UiPreferences {
  if (!storage) return defaultUiPreferences();

  try {
    const serialized = storage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!serialized) return defaultUiPreferences();

    const parsed: unknown = JSON.parse(serialized);
    return Value.Check(UiPreferencesSchema, parsed) ? parsed : defaultUiPreferences();
  } catch {
    return defaultUiPreferences();
  }
}

export function saveUiPreferences(preferences: UiPreferences, storage: PreferenceStorage | null = browserStorage()): boolean {
  if (!storage) return false;

  try {
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function resetUiPreferences(storage: PreferenceStorage | null = browserStorage()): boolean {
  if (!storage) return false;

  try {
    storage.removeItem(UI_PREFERENCES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
