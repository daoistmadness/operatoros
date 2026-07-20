import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitRoster, commitStudentUpdate, createEnrollment, createStudent, endEnrollment, exportStudentTemplate,
  fetchStudent, fetchStudentEnrollments, fetchStudentHistory, fetchStudentQuality, fetchStudents,
  previewRoster, previewStudentUpdate, reassignDeviceIdentity, replaceDeviceIdentity, retireDeviceIdentity, StudentFilters, transferEnrollment,
  updateStudent,
} from "../api/students";
import { queryKeys } from "../lib/query/queryKeys";

export const useStudents = (filters: StudentFilters) => useQuery({ queryKey: queryKeys.students.list(filters), queryFn: () => fetchStudents(filters), placeholderData: (previous) => previous });
export const useStudent = (id?: string) => useQuery({ queryKey: queryKeys.students.detail(id || ""), queryFn: () => fetchStudent(id!), enabled: Boolean(id) });
export const useStudentQuality = () => useQuery({ queryKey: queryKeys.students.quality, queryFn: fetchStudentQuality });
export const useStudentHistory = (id?: string) => useQuery({ queryKey: queryKeys.students.history(id || ""), queryFn: () => fetchStudentHistory(id!), enabled: Boolean(id) });
export const useStudentEnrollments = (id?: string) => useQuery({ queryKey: queryKeys.students.enrollments(id || ""), queryFn: () => fetchStudentEnrollments(id!), enabled: Boolean(id) });

function useStudentDomainInvalidation(id?: string) {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: queryKeys.students.lists });
    await client.invalidateQueries({ queryKey: queryKeys.students.quality });
    if (id) {
      await client.invalidateQueries({ queryKey: queryKeys.students.detail(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.history(id) });
      await client.invalidateQueries({ queryKey: queryKeys.students.enrollments(id) });
    }
  };
}

export function useCreateStudent() { const invalidate = useStudentDomainInvalidation(); return useMutation({ mutationFn: createStudent, onSuccess: invalidate }); }
export function useUpdateStudent(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => updateStudent(id, payload), onSuccess: invalidate }); }
export function useReplaceDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => replaceDeviceIdentity(id, payload), onSuccess: invalidate }); }
export function useReassignDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: (payload: unknown) => reassignDeviceIdentity(id, payload), onSuccess: invalidate }); }
export function useRetireDevice(id: string) { const invalidate = useStudentDomainInvalidation(id); return useMutation({ mutationFn: ({ identityId, payload }: { identityId: number; payload: unknown }) => retireDeviceIdentity(id, identityId, payload), onSuccess: invalidate }); }
export function useTransferEnrollment(studentId: string) { const invalidate = useStudentDomainInvalidation(studentId); return useMutation({ mutationFn: ({ id, payload }: { id: number; payload: unknown }) => transferEnrollment(id, payload), onSuccess: invalidate }); }
export function useCreateEnrollment(studentId: string) { const invalidate = useStudentDomainInvalidation(studentId); return useMutation({ mutationFn: (payload: unknown) => createEnrollment(studentId, payload), onSuccess: invalidate }); }
export function useEndEnrollment(studentId: string) { const invalidate = useStudentDomainInvalidation(studentId); return useMutation({ mutationFn: ({ id, payload }: { id: number; payload: unknown }) => endEnrollment(id, payload), onSuccess: invalidate }); }
export function useRosterPreview() { return useMutation({ mutationFn: ({ file, owner, received }: { file: File; owner: string; received: string }) => previewRoster(file, owner, received) }); }
export function useRosterCommit() { const invalidate = useStudentDomainInvalidation(); return useMutation({ mutationFn: commitRoster, onSuccess: invalidate }); }
export function useStudentUpdatePreview() { return useMutation({ mutationFn: previewStudentUpdate }); }
export function useStudentUpdateCommit() { const invalidate = useStudentDomainInvalidation(); return useMutation({ mutationFn: ({ batchId, payload }: { batchId: string; payload: unknown }) => commitStudentUpdate(batchId, payload), onSuccess: invalidate }); }
export function useStudentTemplateExport() { return useMutation({ mutationFn: exportStudentTemplate }); }
