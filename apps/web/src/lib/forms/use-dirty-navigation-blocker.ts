import { useCallback, useEffect, useRef } from "react";
import { useBlocker, useRouter } from "@tanstack/react-router";

export function useDirtyNavigationBlocker({
  isDirty,
  isPending = false,
  message,
}: {
  isDirty: boolean;
  isPending?: boolean;
  message: string;
}) {
  const router = useRouter();
  const allowNextNavigationRef = useRef(false);
  const allowNextNavigation = useCallback(() => {
    allowNextNavigationRef.current = true;
  }, []);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (allowNextNavigationRef.current) {
        allowNextNavigationRef.current = false;
        return false;
      }
      return (isDirty || isPending) && current.pathname !== next.pathname;
    },
    enableBeforeUnload: isDirty || isPending,
    withResolver: true,
  });
  const handledBlocker = useRef(false);

  useEffect(() => {
    if (blocker.status !== "blocked") {
      handledBlocker.current = false;
      return;
    }
    if (handledBlocker.current) return;
    handledBlocker.current = true;

    const mayLeave = !isPending && window.confirm(message);
    if (mayLeave) blocker.proceed();
    else blocker.reset();
  }, [blocker, isPending, message]);

  useEffect(() => {
    if (!isDirty && !isPending) return undefined;
    return router.history.block({
      blockerFn: ({ currentLocation, nextLocation }) => {
        if (allowNextNavigationRef.current) {
          allowNextNavigationRef.current = false;
          return false;
        }
        const hashOnlyNavigation = currentLocation.pathname === nextLocation.pathname
          && currentLocation.search === nextLocation.search
          && currentLocation.hash !== nextLocation.hash;
        if (!hashOnlyNavigation) return false;
        return isPending || !window.confirm(message);
      },
    });
  }, [isDirty, isPending, message, router.history]);

  return allowNextNavigation;
}
