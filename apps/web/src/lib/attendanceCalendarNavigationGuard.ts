let guard: ((event: PopStateEvent) => boolean) | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => {
    if (guard?.(event)) event.stopImmediatePropagation();
  }, true);
}

export function registerAttendanceCalendarNavigationGuard(next: (event: PopStateEvent) => boolean): () => void {
  guard = next;
  return () => { if (guard === next) guard = null; };
}
