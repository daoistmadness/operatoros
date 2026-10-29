import { describe, expect, it } from "vitest";
import { queryFreshness } from "./queryConfig";
import { createAppQueryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

describe("application query freshness", () => {
  const client = createAppQueryClient();

  it("applies freshness by domain key prefix", () => {
    expect(client.defaultQueryOptions({ queryKey: queryKeys.auth.me }).staleTime).toBe(queryFreshness.auth);
    expect(client.defaultQueryOptions({ queryKey: queryKeys.attendance.classRoster(7, "2026-10-29") }).staleTime).toBe(queryFreshness.operational);
    expect(client.defaultQueryOptions({ queryKey: queryKeys.students.detail("student-1") }).staleTime).toBe(queryFreshness.records);
    expect(client.defaultQueryOptions({ queryKey: queryKeys.teacherClassAssignments.subjects }).staleTime).toBe(queryFreshness.reference);
    expect(client.defaultQueryOptions({ queryKey: queryKeys.analytics.overview({ academic_year_id: 4 }) }).staleTime).toBe(queryFreshness.analytics);
  });

  it("allows an explicit query option to override the domain default", () => {
    expect(client.defaultQueryOptions({ queryKey: queryKeys.attendance.classRoster(7, "2026-10-29"), staleTime: 0 }).staleTime).toBe(0);
  });
});
