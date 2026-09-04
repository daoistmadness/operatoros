import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitRoster, commitStudentUpdate, createEnrollment, createStudent, endEnrollment, exportStudentTemplate,
  fetchStudent, fetchStudentOverview, fetchStudentEnrollments, fetchStudentHistory, fetchStudentQuality, fetchStudents, exportStudentsCsv, updateStudentHealth, updateStudentDocuments, addStudentGuardian, updateStudentGuardian, deleteStudentGuardian,
  previewRoster, previewStudentUpdate, reassignDeviceIdentity, replaceDeviceIdentity, retireDeviceIdentity, StudentFilters, transferEnrollment,
  updateStudent,
  fetchLegacyLinkStatus, linkLegacyStudent,
} from "../api/students";
import { queryKeys } from "../lib/query/queryKeys";
import { invalidateReadiness } from "../features/readiness";
import { invalidateEnrollmentQueries } from "../lib/query/enrollmentInvalidation";

export const useStudents = (filters: StudentFilters) => useQuery({ queryKey: queryKeys.students.list(filters), queryFn: () => fetchStudents(filters), placeholderData: (previous) => previous });
export const useStudent = (id?: string) => useQuery({ queryKey: queryKeys.students.detail(id || ""), queryFn: () => fetchStudent(id!), enabled: Boolean(id) });
export const useStudentOverview = (id?: string) => useQuery({ queryKey: queryKeys.students.overview(id || ""), queryFn: () => fetchStudentOverview(id!), enabled: Boolean(id) });
export const useLegacyLinkStatus = (id?: string) => useQuery({ queryKey: queryKeys.students.legacyLink(id || ""), queryFn: () => fetchLegacyLinkStatus(id!), enabled: Boolean(id) });
export const useStudentQuality = () => useQuery({ queryKey: queryKeys.students.quality, queryFn: fetchStudentQuality });
export const useStudentHistory = (id?: string) => useQuery({ queryKey: queryKeys.students.history(id || ""), queryFn: () => fetchStudentHistory(id!), enabled: Boolean(id) });
export const useStudentEnrollments = (id?: string) => useQuery({ queryKey: queryKeys.students.enrollments(id || ""), queryFn: () => fetchStudentEnrollments(id!), enabled: Boolean(id) });

function useStudentDomainInvalidation(id?: string) {
  const client = useQueryClient();
  return async () => {
    await invalidateReadiness(client);
    await client.invalidateQueries({ queryKey: queryKeys.students.lists });
    await client.invalidateQueries({ queryKey: queryKeys.students.quality });
    if (id) {
      await client.invalidateQueries({ queryKey: queryKeys.students.detail(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.overview(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.history(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.enrollments(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.legacyLink(id) });
    }
    await client.invalidateQueries({ queryKey: queryKeys.analytics.all });
  };
}

export function useCreateStudent() { const client = useQueryClient(); return useMutation({ mutationFn: createStudent, onSuccess: () => invalidateEnrollmentQueries(client) }); }
export function useUpdateStudent(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => updateStudent(id, payload), onSuccess: invalidate }); }
export function useReplaceDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => replaceDeviceIdentity(id, payload), onSuccess: invalidate }); }
export function useReassignDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => reassignDeviceIdentity(id, payload), onSuccess: invalidate }); }
export function useRetireDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: ({ identityId, payload }: { identityId: number; payload: unknown }) => retireDeviceIdentity(id, identityId, payload), onSuccess: invalidate }); }
export function useTransferEnrollment(studentId: string) { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: number; payload: unknown }) => transferEnrollment(id, payload), onSuccess: () => invalidateEnrollmentQueries(client) }); }
export function useCreateEnrollment(studentId: string) { const client = useQueryClient(); return useMutation({ mutationFn: (payload: unknown) => createEnrollment(studentId, payload), onSuccess: () => invalidateEnrollmentQueries(client) }); }
export function useEndEnrollment(studentId: string) { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: number; payload: unknown }) => endEnrollment(id, payload), onSuccess: () => invalidateEnrollmentQueries(client) }); }
export function useRosterPreview() { return useMutation({ mutationFn: ({ file, owner, received }: { file: File; owner: string; received: string }) => previewRoster(file, owner, received) }); }
export function useRosterCommit() { const client = useQueryClient(); return useMutation({ mutationFn: commitRoster, onSuccess: () => invalidateEnrollmentQueries(client) }); }
export function useStudentUpdatePreview() { return useMutation({ mutationFn: previewStudentUpdate }); }
export function useStudentUpdateCommit() { const invalidate = useStudentDomainInvalidation(); return useMutation({ mutationFn: ({ batchId, payload }: { batchId: string; payload: unknown }) => commitStudentUpdate(batchId, payload), onSuccess: invalidate }); }
export function useStudentTemplateExport() { return useMutation({ mutationFn: exportStudentTemplate }); }
export function useStudentsCsvExport() { return useMutation({ mutationFn: exportStudentsCsv }); }
export function useUpdateStudentHealth(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => updateStudentHealth(id, payload), onSuccess: invalidate }); }
export function useUpdateStudentDocuments(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => updateStudentDocuments(id, payload), onSuccess: invalidate }); }
export function useAddStudentGuardian(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => addStudentGuardian(id, payload), onSuccess: invalidate }); }
export function useUpdateStudentGuardian(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: ({ guardianId, payload }: { guardianId: number; payload: unknown }) => updateStudentGuardian(id, guardianId, payload), onSuccess: invalidate }); }
export function useDeleteStudentGuardian(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (guardianId: number) => deleteStudentGuardian(id, guardianId), onSuccess: invalidate }); }
export function useLinkLegacyStudent(id: string) {
  const invalidate = useStudentDomainInvalidation(id);
  return useMutation({ mutationFn: (payload: { legacy_student_id: number; reason: string; confirmation: "LINK_LEGACY_STUDENT" }) => linkLegacyStudent(id, payload), onSuccess: invalidate });
}
