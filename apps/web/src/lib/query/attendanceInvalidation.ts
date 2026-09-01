import type { QueryClient } from "@tanstack/react-query";

/** Invalidate every current consumer of canonical attendance state after a mutation. */
export function invalidateAttendanceQueries(queryClient: Pick<QueryClient, "invalidateQueries">) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    queryClient.invalidateQueries({ queryKey: ["analytics"] }),
    queryClient.invalidateQueries({ queryKey: ["students"] }),
    queryClient.invalidateQueries({ queryKey: ["classes"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["assignedClasses"] }),
    queryClient.invalidateQueries({ queryKey: ["classAttendanceRoster"] }),
  ]);
}
