import { QueryClient } from "@tanstack/react-query";
import { appQueryConfig, queryFreshness, testQueryConfig } from "./queryConfig";
import { queryKeys } from "./queryKeys";

const freshnessDefaults: ReadonlyArray<readonly [readonly unknown[], number]> = [
  [queryKeys.auth.all, queryFreshness.auth],
  [queryKeys.setup.all, queryFreshness.reference],
  [queryKeys.system.all, queryFreshness.operational],
  [queryKeys.readiness.all, queryFreshness.operational],
  [queryKeys.backups.all, queryFreshness.operational],
  [queryKeys.operator.all, queryFreshness.operational],
  [queryKeys.attendance.all, queryFreshness.operational],
  [queryKeys.attendance.assignedClasses, queryFreshness.operational],
  [queryKeys.attendance.classRosters, queryFreshness.operational],
  [queryKeys.students.all, queryFreshness.records],
  [queryKeys.staff.all, queryFreshness.records],
  [queryKeys.grades.all, queryFreshness.records],
  [queryKeys.teacherClassAssignments.all, queryFreshness.records],
  [queryKeys.operationsAudit.all, queryFreshness.records],
  [queryKeys.machineImport.all, queryFreshness.records],
  [queryKeys.uploads.all, queryFreshness.operational],
  [queryKeys.academicMasters.all, queryFreshness.reference],
  [queryKeys.teacherClassAssignments.users, queryFreshness.reference],
  [queryKeys.teacherClassAssignments.academicYears, queryFreshness.reference],
  [queryKeys.teacherClassAssignments.academicClasses, queryFreshness.reference],
  [queryKeys.teacherClassAssignments.subjects, queryFreshness.reference],
];

export const createAppQueryClient = () => {
  const client = new QueryClient(appQueryConfig);
  for (const [queryKey, staleTime] of freshnessDefaults) {
    client.setQueryDefaults(queryKey, { staleTime });
  }
  return client;
};
export const createTestQueryClient = () => new QueryClient(testQueryConfig);
export const queryClient = createAppQueryClient();
