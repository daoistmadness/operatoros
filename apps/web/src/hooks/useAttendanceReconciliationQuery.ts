import { useQuery } from "@tanstack/react-query";
import type { AttendanceReconciliationQuery } from "@operatoros/contracts/analytics";
import { getAttendanceReconciliation } from "../api/attendanceReconciliation";
import { queryKeys } from "../lib/query/queryKeys";

export function useAttendanceReconciliationQuery(query: AttendanceReconciliationQuery | null) {
  return useQuery({
    queryKey: query ? queryKeys.attendance.reconciliation(query) : ["attendance", "reconciliation", "idle"],
    queryFn: () => getAttendanceReconciliation(query as AttendanceReconciliationQuery),
    enabled: query !== null,
  });
}
