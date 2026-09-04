import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Invalidate current consumers whose canonical context includes enrollment. */
export function invalidateEnrollmentQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.students.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.classes.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.assignedClasses }),
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.classRosters }),
    queryClient.invalidateQueries({ queryKey: queryKeys.grades.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  ]);
}
