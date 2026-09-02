import { apiRequest } from "../lib/api/client";

export type AcademicMasterJenjang = { id: number; code: string; name: string; level: string; active: boolean };
export type AcademicMasterProgram = { id: number; jenjang_id: number; name: string; active: boolean };
export type AcademicMasterGrade = { id: number; jenjang_id: number; program_id: number; name: string; sequence_number: number; active: boolean };
export type AcademicMasterClass = { id: number; academic_year_id: number; grade_id: number; class_name: string; section_code: string; active: boolean };

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

export function createAcademicGrade(payload: Omit<AcademicMasterGrade, "id" | "active">): Promise<AcademicMasterGrade> {
  return request("grades", { ...payload, active: true });
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
