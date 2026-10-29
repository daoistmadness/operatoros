import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  defaultUiPreferences,
  readUiPreferences,
  resetUiPreferences,
  saveUiPreferences,
  type UiPreferences,
} from "../lib/ui-preferences";

type UiPreferencesContextValue = {
  preferences: UiPreferences;
  setSidebarCollapsed: (collapsed: boolean) => boolean;
  resetPreferences: () => boolean;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readUiPreferences);

  const setSidebarCollapsed = useCallback((sidebarCollapsed: boolean) => {
    const next = { ...preferences, sidebarCollapsed };
    setPreferences(next);
    return saveUiPreferences(next);
  }, [preferences]);

  const resetPreferences = useCallback(() => {
    setPreferences(defaultUiPreferences());
    return resetUiPreferences();
  }, []);

  const value = useMemo(() => ({ preferences, setSidebarCollapsed, resetPreferences }), [preferences, setSidebarCollapsed, resetPreferences]);

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences(): UiPreferencesContextValue {
  const context = useContext(UiPreferencesContext);
  if (!context) throw new Error("useUiPreferences must be used within UiPreferencesProvider.");
  return context;
}
