import { useQuery } from "@tanstack/react-query";
import { fetchClassOverview, type ClassOverviewFilters } from "../api/classOverview";
import { queryKeys } from "../lib/query/queryKeys";

export function useClassOverviewQuery(classId: string | null, filters: ClassOverviewFilters, enabled = true) {
  return useQuery({
    queryKey: classId ? queryKeys.classes.overview(classId, filters) : ["classes", "overview", "idle"],
    queryFn: () => fetchClassOverview(classId as string, filters),
    enabled: enabled && classId !== null,
  });
}
