import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceCorrectionReview, type AttendanceCorrectionReviewFilters } from "../api/attendanceCorrectionReview";
import { queryKeys } from "../lib/query/queryKeys";

export function useAttendanceCorrectionReviewQuery(filters: AttendanceCorrectionReviewFilters | null, enabled = true) {
  return useQuery({
    queryKey: filters ? queryKeys.attendance.correctionReview(filters) : ["attendance", "correction-review", "idle"],
    queryFn: () => fetchAttendanceCorrectionReview(filters as AttendanceCorrectionReviewFilters),
    enabled: enabled && filters !== null,
  });
}
