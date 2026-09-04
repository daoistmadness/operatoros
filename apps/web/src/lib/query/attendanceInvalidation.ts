import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Invalidate every current consumer of canonical attendance state after a mutation. */
export function invalidateAttendanceQueries(queryClient: Pick<QueryClient, "invalidateQueries">) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.students.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.classes.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.assignedClasses }),
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.classRosters }),
  ]);
}
