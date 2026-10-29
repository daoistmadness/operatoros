import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../api/auth";
import { getCurrentUser } from "../api/auth";
import { advanceAuthSessionEpoch, AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT } from "../lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLoginMutation, useLogoutMutation } from "../hooks/useAuthQueries";
import { createAuthSessionSync } from "../lib/auth/sessionSync";
import { cancelProtectedQueries, clearProtectedQueries, clearSessionQueries, refetchStaleProtectedQueries } from "../lib/query/sessionCache";
import { queryKeys } from "../lib/query/queryKeys";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authenticated: boolean;
  can: (capability: string) => boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  sessionVerification?: "idle" | "checking" | "unavailable";
  retrySessionVerification?: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function authorizationChanged(previousUser: AuthUser | null, nextUser: AuthUser | null) {
  return previousUser?.role !== nextUser?.role
    || previousUser?.capabilities?.length !== nextUser?.capabilities?.length
    || previousUser?.capabilities?.some((capability) => !nextUser?.capabilities?.includes(capability));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const sessionSync = useMemo(() => createAuthSessionSync(), []);
  const currentUser = useCurrentUser();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();
  const revalidationSequence = useRef(0);
  const revalidationController = useRef<AbortController | null>(null);
  const focusRevalidation = useRef<Promise<void> | null>(null);
  const [sessionVerification, setSessionVerification] = useState<"idle" | "checking" | "unavailable">("idle");
  const user = currentUser.data ?? null;
  const loading = currentUser.isLoading && !currentUser.isError;

  const invalidateRevalidation = useCallback(() => {
    revalidationSequence.current += 1;
    revalidationController.current?.abort();
    revalidationController.current = null;
  }, []);

  const revalidateSession = useCallback(async (sessionEpochAdvanced = false): Promise<boolean> => {
    invalidateRevalidation();
    setSessionVerification("checking");
    const sequence = revalidationSequence.current;
    const controller = new AbortController();
    revalidationController.current = controller;
    try {
      await client.cancelQueries({ queryKey: queryKeys.auth.me, exact: true });
      if (sequence !== revalidationSequence.current) return false;
      const nextUser = await getCurrentUser(controller.signal);
      if (sequence !== revalidationSequence.current || controller.signal.aborted) return false;
      const previousUser = client.getQueryData<AuthUser | null>(queryKeys.auth.me) ?? null;
      const identityChanged = (previousUser?.id ?? null) !== (nextUser?.id ?? null);
      const permissionsChanged = authorizationChanged(previousUser, nextUser);
      if (identityChanged || permissionsChanged) {
        if (identityChanged && !sessionEpochAdvanced) advanceAuthSessionEpoch();
        await clearProtectedQueries(client);
        if (sequence !== revalidationSequence.current || controller.signal.aborted) return false;
        if (!identityChanged && permissionsChanged) sessionSync.notifyAuthorizationChange();
      }
      client.setQueryData(queryKeys.auth.me, nextUser);
      setSessionVerification("idle");
      return true;
    } catch {
      // A 401 response dispatches AUTH_UNAUTHORIZED_EVENT. Network failures keep the current session.
      if (sequence === revalidationSequence.current && !controller.signal.aborted) {
        setSessionVerification("unavailable");
      }
      return false;
    } finally {
      if (revalidationController.current === controller) revalidationController.current = null;
    }
  }, [client, invalidateRevalidation, sessionSync]);

  useEffect(() => {
    const handleUnauthorized = () => {
      invalidateRevalidation();
      setSessionVerification("checking");
      void clearSessionQueries(client).finally(() => setSessionVerification("idle"));
    };
    const handleForbidden = () => {
      setSessionVerification("checking");
      void (async () => {
        await clearProtectedQueries(client);
        await revalidateSession();
      })();
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener(AUTH_FORBIDDEN_EVENT, handleForbidden);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener(AUTH_FORBIDDEN_EVENT, handleForbidden);
    };
  }, [client, invalidateRevalidation, revalidateSession]);

  const revalidateAfterFocus = useCallback(async () => {
    if (focusRevalidation.current) return focusRevalidation.current;
    invalidateRevalidation();
    const sequence = revalidationSequence.current;
    const operation = (async () => {
      setSessionVerification("checking");
      await cancelProtectedQueries(client);
      if (sequence !== revalidationSequence.current) return;
      if (await revalidateSession()) await refetchStaleProtectedQueries(client);
    })();
    focusRevalidation.current = operation;
    try {
      await operation;
    } finally {
      if (focusRevalidation.current === operation) focusRevalidation.current = null;
    }
  }, [client, invalidateRevalidation, revalidateSession]);

  useEffect(() => {
    const handleSessionChange = (change: "session" | "authorization") => {
      if (change === "authorization") {
        void (async () => {
          invalidateRevalidation();
          setSessionVerification("checking");
          await clearProtectedQueries(client);
          await revalidateSession();
        })();
        return;
      }
      void (async () => {
        advanceAuthSessionEpoch();
        invalidateRevalidation();
        setSessionVerification("checking");
        await clearSessionQueries(client);
        await revalidateSession(true);
      })();
    };
    return sessionSync.subscribe(handleSessionChange);
  }, [client, invalidateRevalidation, revalidateSession, sessionSync]);

  useEffect(() => {
    const handleFocus = () => {
      void revalidateAfterFocus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidateAfterFocus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [revalidateAfterFocus]);

  const login = useCallback(async (username: string, password: string) => {
    invalidateRevalidation();
    setSessionVerification("checking");
    try {
      const nextUser = await loginMutation.mutateAsync({ username, password });
      sessionSync.notify();
      setSessionVerification("idle");
      return nextUser;
    } catch (error) {
      setSessionVerification("idle");
      throw error;
    }
  }, [invalidateRevalidation, loginMutation, sessionSync]);

  const logout = useCallback(async () => {
    invalidateRevalidation();
    setSessionVerification("checking");
    try {
      await logoutMutation.mutateAsync();
      sessionSync.notify();
      setSessionVerification("idle");
    } catch (error) {
      setSessionVerification("idle");
      throw error;
    }
  }, [invalidateRevalidation, logoutMutation, sessionSync]);

  const retrySessionVerification = useCallback(() => revalidateAfterFocus(), [revalidateAfterFocus]);

  const can = useCallback(
    (capability: string) => Boolean(user?.capabilities?.includes(capability)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, authenticated: user !== null, can, login, logout, sessionVerification, retrySessionVerification }),
    [user, loading, can, login, logout, sessionVerification, retrySessionVerification],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
