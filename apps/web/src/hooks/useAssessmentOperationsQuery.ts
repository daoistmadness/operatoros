import { useQuery } from "@tanstack/react-query";
import { fetchAssessmentOperations, type AssessmentOperationsFilters } from "../api/grades";
import { queryKeys } from "../lib/query/queryKeys";

export function useAssessmentOperationsQuery(filters: AssessmentOperationsFilters | null, enabled = true) {
  return useQuery({
    queryKey: filters ? queryKeys.grades.assessmentOperations(filters) : queryKeys.grades.assessmentOperationsIdle,
    queryFn: () => fetchAssessmentOperations(filters as AssessmentOperationsFilters),
    enabled: enabled && filters !== null,
  });
}
