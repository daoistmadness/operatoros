import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

type InvalidatingClient = Pick<QueryClient, "invalidateQueries">;

export function invalidateAcademicFoundationQueries(queryClient: InvalidatingClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.academicMasters.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.filtersAll }),
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.academicAll }),
  ]);
}

export function invalidateAcademicResultQueries(queryClient: InvalidatingClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.grades.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.academicAll }),
    queryClient.invalidateQueries({ queryKey: queryKeys.students.overviews }),
    queryClient.invalidateQueries({ queryKey: queryKeys.classes.overviews }),
  ]);
}
