import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceReconciliationQuery, AttendanceReviewMutation, AttendanceReviewReopen } from "@operatoros/contracts/analytics";
import { getAttendanceReconciliation, reopenAttendanceReview, submitAttendanceReview } from "../api/attendanceReconciliation";
import { queryKeys } from "../lib/query/queryKeys";

export function useAttendanceReconciliationQuery(query: AttendanceReconciliationQuery | null) {
  return useQuery({
    queryKey: query ? queryKeys.attendance.reconciliation(query) : ["attendance", "reconciliation", "idle"],
    queryFn: () => getAttendanceReconciliation(query as AttendanceReconciliationQuery),
    enabled: query !== null,
  });
}

export function useAttendanceReviewMutations() {
  const client = useQueryClient();
  const refresh = (data: Awaited<ReturnType<typeof submitAttendanceReview>>) => client.invalidateQueries({ queryKey: queryKeys.attendance.reconciliation({
    academic_year_id: String(data.academic_year.id), class_id: String(data.class.id), month: data.month, scope: data.scope,
  }) });
  const decision = useMutation({ mutationFn: (payload: AttendanceReviewMutation) => submitAttendanceReview(payload), onSuccess: refresh });
  const reopen = useMutation({ mutationFn: (payload: AttendanceReviewReopen) => reopenAttendanceReview(payload), onSuccess: refresh });
  return { decision, reopen };
}
