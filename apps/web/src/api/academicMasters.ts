import { apiRequest } from "../lib/api/client";
import type {
  AcademicMasterGrade as AcademicMasterGradeDto,
  CreateAcademicGradesBulkRequest,
  CreateAcademicGradesBulkResponse,
} from "@operatoros/contracts/academic-masters";

export type AcademicMasterJenjang = { id: number; code: string; name: string; level: string; active: boolean };
export type AcademicMasterProgram = { id: number; jenjang_id: number; name: string; active: boolean };
export type AcademicMasterGrade = AcademicMasterGradeDto;
export type AcademicMasterClass = { id: number; academic_year_id: number; grade_id: number; class_name: string; section_code: string; active: boolean };
type CreateAcademicGradeInput = { jenjang_id: number; program_id: number; name: string; sequence_number: number };

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await apiRequest<T>({ path: `/api/academic-masters/${path}`, method: "POST", body });
  return response.data;
}

export function createAcademicJenjang(payload: Omit<AcademicMasterJenjang, "id" | "active">): Promise<AcademicMasterJenjang> {
  return request("jenjangs", { ...payload, active: true });
}

export function createAcademicProgram(payload: Omit<AcademicMasterProgram, "id" | "active">): Promise<AcademicMasterProgram> {
  return request("programs", { ...payload, active: true });
}

export function createAcademicGrade(payload: CreateAcademicGradeInput): Promise<AcademicMasterGrade> {
  return request("grades", { ...payload, active: true });
}

export function createAcademicGrades(payload: CreateAcademicGradesBulkRequest): Promise<CreateAcademicGradesBulkResponse> {
  return request("grades/bulk", payload);
}

export function createAcademicClass(payload: Omit<AcademicMasterClass, "id" | "active">): Promise<AcademicMasterClass> {
  return request("classes", { ...payload, active: true });
}

export async function fetchAcademicMasters(): Promise<{
  jenjangs: AcademicMasterJenjang[];
  programs: AcademicMasterProgram[];
  grades: AcademicMasterGrade[];
  classes: AcademicMasterClass[];
}> {
  const [jenjangs, programs, grades, classes] = await Promise.all([
    apiRequest<AcademicMasterJenjang[]>({ path: "/api/academic-masters/jenjangs", method: "GET" }),
    apiRequest<AcademicMasterProgram[]>({ path: "/api/academic-masters/programs", method: "GET" }),
    apiRequest<AcademicMasterGrade[]>({ path: "/api/academic-masters/grades", method: "GET" }),
    apiRequest<AcademicMasterClass[]>({ path: "/api/academic-masters/classes", method: "GET" }),
  ]);
  return { jenjangs: jenjangs.data, programs: programs.data, grades: grades.data, classes: classes.data };
}

export async function fetchAcademicPrograms(): Promise<AcademicMasterProgram[]> {
  return (await apiRequest<AcademicMasterProgram[]>({ path: "/api/academic-masters/programs", method: "GET" })).data;
}
