import type { QueryClient } from "@tanstack/react-query";
import type { DataResetScope } from "@operatoros/contracts/system";
import { invalidateAcademicFoundationQueries, invalidateAcademicResultQueries } from "./academicInvalidation";
import { invalidateAttendanceQueries } from "./attendanceInvalidation";
import { invalidateEnrollmentQueries } from "./enrollmentInvalidation";
import { queryKeys } from "./queryKeys";

type InvalidatingClient = Pick<QueryClient, "invalidateQueries">;

export function invalidateDataResetQueries(client: InvalidatingClient, scope: DataResetScope) {
  const resetEffects = [
    client.invalidateQueries({ queryKey: queryKeys.backups.all }),
    client.invalidateQueries({ queryKey: queryKeys.operationsAudit.all }),
  ];
  if (scope === "ATTENDANCE") return Promise.all([
    ...resetEffects,
    invalidateAttendanceQueries(client),
    client.invalidateQueries({ queryKey: queryKeys.operator.all }),
  ]);
  if (scope === "ACADEMIC_RESULTS") return Promise.all([
    ...resetEffects,
    invalidateAcademicResultQueries(client),
    client.invalidateQueries({ queryKey: queryKeys.analytics.managementOverviewAll }),
    client.invalidateQueries({ queryKey: queryKeys.analytics.managementReviewProfileAll }),
  ]);
  if (scope === "STUDENTS") return Promise.all([
    ...resetEffects,
    invalidateEnrollmentQueries(client),
    client.invalidateQueries({ queryKey: queryKeys.operator.all }),
  ]);
  return Promise.all([
    ...resetEffects,
    invalidateEnrollmentQueries(client),
    invalidateAcademicFoundationQueries(client),
    client.invalidateQueries({ queryKey: queryKeys.uploads.all }),
    client.invalidateQueries({ queryKey: queryKeys.reports.all }),
    client.invalidateQueries({ queryKey: queryKeys.managementReports.all }),
    client.invalidateQueries({ queryKey: queryKeys.operator.all }),
    client.invalidateQueries({ queryKey: queryKeys.staff.all }),
    client.invalidateQueries({ queryKey: queryKeys.teacherClassAssignments.all }),
    client.invalidateQueries({ queryKey: queryKeys.analytics.managementOverviewAll }),
    client.invalidateQueries({ queryKey: queryKeys.analytics.managementReviewProfileAll }),
  ]);
}
